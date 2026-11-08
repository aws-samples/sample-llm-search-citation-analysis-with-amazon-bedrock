"""
The view jobs of the mention routes (track S3, design 2.45.0 §2.4): what a job computes for a large scope.

A large scope is served from its snapshot build; a request the build does not
hold (another run than each keyword's latest via ``timestamp``, or a scope
with no build yet) answers 202 while a view job computes it
(``shared.scope_snapshot_serve.view_job_response``). The job calls
``compute_mention_view`` with the route, the request's parameters and the
scope's keywords, under its own deadline:

1. each keyword's selected run is read raw (``JobReaders.selected_run``) and
   turned into its ``mentions`` partial, exactly as the KeywordLatest writer
   does for the latest run;
2. the partials are folded by the same builders the snapshot uses
   (``artifact_mentions.MentionsBuilder``, ``artifact_sentiment.SentimentIndexBuilder``)
   into an in-memory build (``MemoryArtifacts``);
3. the route's ``serve`` answers from it, so a job's result equals the
   snapshot answer over the same runs (and both equal the live answer).

An appearances page or a sentiment-examples page is one job per page: its
``next_token`` is a keyword cursor whose fingerprint names the job build
(``job_build_id``), so a cursor outlives neither a change of the scope's
keywords nor of the selected run. Exports go through the export service (``shared.export_steps``).
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Final

from shared.api_response import success_response, validation_error
from shared.artifact_mentions import MentionReaders, MentionsBuilder, PreviewRows, appearances_fingerprint
from shared.artifact_registry import fold_scope
from shared.artifact_sentiment import SentimentIndexBuilder, SentimentReaders, snapshot_fingerprint
from shared.brand_mention_views import RUN_LISTING_DEEP_KEYWORDS, RUN_LISTING_LIMIT
from shared.cursors import CURSOR_ERROR_MESSAGE
from shared.keyword_major_pages import list_fingerprint
from shared.partial_contract import KeywordLatest, PartialConfig
from shared.partial_mentions import build
from shared.request_deadline import current_deadline
from shared.scope_params import ReportScope
from shared.scope_snapshot_serve import view_job_response
from shared.sentiment_examples import AnswerTexts
from shared.snapshot_artifacts import (
    CURSOR_EXPIRED_CODE,
    MemoryArtifacts,
    SnapshotScope,
    coverage,
    cursor_expired_body,
    cursor_expired_response,
    decode_keyword_cursor,
    keyword_page_start,
    snapshot_envelope,
    with_scope_contract,
)

ROUTE_SUMMARY: Final = 'brand-mentions'
ROUTE_APPEARANCES: Final = 'brand-mentions-appearances'
ROUTE_SENTIMENT: Final = 'sentiment-examples'

#: The routes ``compute_mention_view`` answers.
MENTION_JOB_ROUTES: tuple[str, ...] = (ROUTE_SUMMARY, ROUTE_APPEARANCES, ROUTE_SENTIMENT)

#: What a job reads of each row: everything the ``mentions`` partial, the pages and the sentiment examples use.
JOB_PROJECTION: Final = 'keyword, #ts, timestamp_provider, provider, #st, query_prompt_id, query_prompt_name, brands, citations, metadata'
JOB_ATTRIBUTE_NAMES: Mapping[str, str] = {'#ts': 'timestamp', '#st': 'status'}

SelectedRun = Callable[[str, str | None], tuple[str | None, Sequence[Mapping[str, Any]]]]
"""One keyword's run (its latest when ``None``): ``(timestamp, rows)`` projected with ``JOB_PROJECTION``, in sort-key order."""


RunListing = Callable[[str, int], Sequence[str]]
"""A keyword's newest runs (at most the given number), newest first."""


@dataclass(frozen=True)
class JobReaders:
    """The reads of a mention view job (DynamoDB in the worker, fakes in tests)."""

    selected_run: SelectedRun
    preview_rows: PreviewRows
    answer_texts: AnswerTexts
    run_listing: RunListing | None = None
    """Lists runs for a summary's ``available_runs`` (``None``: only the run asked)."""


def available_runs(keywords: Sequence[str], listing: RunListing) -> list[str]:
    """The runs a live summary lists: up to ``RUN_LISTING_LIMIT`` of the first ``RUN_LISTING_DEEP_KEYWORDS`` keywords, the latest of the others."""
    runs: set[str] = set()
    for index, keyword in enumerate(keywords):
        if current_deadline().stop_reading('a mention job run listing'):
            break
        runs.update(listing(keyword, RUN_LISTING_LIMIT if index < RUN_LISTING_DEEP_KEYWORDS else 1))
    return sorted(runs, reverse=True)[:RUN_LISTING_LIMIT]


def job_build_id(keywords: Sequence[str], timestamp: str | None) -> str:
    """The id of a job build over ``keywords`` at ``timestamp`` (cursor fingerprints name it)."""
    return 'job-' + list_fingerprint('mention-job', list(keywords), timestamp)


@dataclass
class _JobRead:
    latests: list[KeywordLatest] = field(default_factory=list)
    rows: dict[str, Sequence[Mapping[str, Any]]] = field(default_factory=dict)
    read: int = 0
    """Keywords read (with or without a run); the time budget may leave the others unread."""


def _job_latests(keywords: Sequence[str], timestamp: str | None, readers: JobReaders) -> _JobRead:
    """Each keyword's selected run as a KeywordLatest holding only its ``mentions`` partial, and the rows read."""
    deadline = current_deadline()
    found = _JobRead()
    for keyword in keywords:
        if deadline.stop_reading('a mention view job'):
            break
        found.read += 1
        selected, rows = readers.selected_run(keyword, timestamp)
        if selected is None:
            continue
        found.rows[keyword] = rows
        found.latests.append({
            'v': 1, 'keyword': keyword, 'keyword_id': '', 'config': '',
            'latest': {'timestamp': selected, 'parts': {'mentions': build(rows, PartialConfig())}}, 'previous': None,
        })
    return found


def job_artifacts(keywords: Sequence[str], timestamp: str | None, readers: JobReaders, built_at: str) -> tuple[MemoryArtifacts, Callable[[str, str], Sequence[Mapping[str, Any]]]]:
    """The in-memory build of ``keywords`` at ``timestamp`` and a reader of the rows it was built from."""
    found = _job_latests(keywords, timestamp, readers)
    scope = SnapshotScope(scope_dir='job', kind='all', group_id=None, market_id=None, keywords_total=len(keywords))
    artifacts = fold_scope([MentionsBuilder(), SentimentIndexBuilder()], found.latests, scope)

    def run_rows(keyword: str, _timestamp: str) -> Sequence[Mapping[str, Any]]:
        return found.rows.get(keyword, ())

    build_id = job_build_id(keywords, timestamp)
    return MemoryArtifacts(artifacts, build_id, built_at, found.read), run_rows


def _page_cursor(params: Mapping[str, Any], fingerprint: str) -> Any:
    cursor, rejected = keyword_page_start(params.get('next_token'), fingerprint)
    return cursor if rejected is None else None


def compute_mention_view(
    route: str,
    params: Mapping[str, Any],
    keywords: Sequence[str],
    readers: JobReaders,
    *,
    built_at: str,
) -> dict[str, Any]:
    """The stored result of a mention view job: the body ``serve`` gives over the job build (plus ``as_of``).

    A page whose ``next_token`` belongs to another build answers the
    ``cursor_expired`` body (the handler turns it into the 400).
    """
    if route not in MENTION_JOB_ROUTES:
        raise ValueError(f'not a mention view route: {route!r}')
    artifacts, run_rows = job_artifacts(keywords, params.get('timestamp'), readers, built_at)
    serve_params = {key: value for key, value in params.items() if key != 'timestamp'}
    if route == ROUTE_SENTIMENT:
        cursor = _page_cursor(params, snapshot_fingerprint(artifacts.build_id, params))
        if cursor is None:
            return cursor_expired_body()
        body = SentimentIndexBuilder().serve(artifacts, {
            **serve_params, 'cursor': cursor, 'readers': SentimentReaders(run_rows=run_rows, answer_texts=readers.answer_texts),
        })
    else:
        mention_readers = MentionReaders(run_rows=run_rows, preview_rows=readers.preview_rows)
        serve_params['readers'] = mention_readers
        if route == ROUTE_APPEARANCES:
            cursor = _page_cursor(params, appearances_fingerprint(artifacts.build_id, params))
            if cursor is None:
                return cursor_expired_body()
            serve_params['view'] = 'appearances'
            serve_params['cursor'] = cursor
        body = MentionsBuilder().serve(artifacts, serve_params)
        if body is not None and route == ROUTE_SUMMARY and params.get('timestamp'):
            # The live summary names the run asked for even when no keyword of the scope holds rows of it.
            body['timestamp'] = params['timestamp']
        if body is not None and route == ROUTE_SUMMARY and params.get('view') != 'brands' and readers.run_listing is not None:
            body['available_runs'] = available_runs(keywords, readers.run_listing)
    return {**(body or {}), 'as_of': built_at}


Finish = Callable[[dict[str, Any]], dict[str, Any]]
"""Turns a job's stored result into the 200 body (the scope contract, a fresh download URL ...)."""


def job_scope_contract(report_scope: ReportScope, extra: Mapping[str, Any] | None = None) -> Finish:
    """The ``finish`` of a summary or page computed by a view job: ``scope``, ``extra`` and the scope contract.

    ``coverage`` counts the keywords the job read (``keywords_analyzed`` of a
    summary; a page job reads every keyword unless its deadline cut it,
    which its ``truncated`` says).
    """
    def finish(result: dict[str, Any]) -> dict[str, Any]:
        total = len(report_scope.keywords)
        analyzed = result.get('keywords_analyzed')
        read = min(total, analyzed) if isinstance(analyzed, int) else total
        envelope = snapshot_envelope(str(result.get('as_of') or ''))
        return with_scope_contract({'scope': report_scope.describe(), **result, **(extra or {})}, coverage(total, read), envelope)

    return finish


def mention_job_answer(route: str, params: Mapping[str, Any], report_scope: ReportScope, event: dict[str, Any], finish: Finish) -> dict[str, Any]:
    """``view_job_response`` of a mention route: 202 / ``failed`` untouched, a stored ``cursor_expired`` as the 400, else ``finish(result)``.

    A malformed ``next_token`` is refused (400) before any job starts.
    """
    token = params.get('next_token')
    if isinstance(token, str) and decode_keyword_cursor(token) is None:
        return validation_error(CURSOR_ERROR_MESSAGE, event, field='next_token')
    response = view_job_response(route, params, report_scope, event)
    if response.get('statusCode') != 200:
        return response
    result = json.loads(response.get('body') or '{}')
    if not isinstance(result, dict) or 'status' in result:
        return response
    if result.get('code') == CURSOR_EXPIRED_CODE:
        return cursor_expired_response(event)
    return success_response(finish(result), event)


__all__ = [
    'JOB_ATTRIBUTE_NAMES',
    'JOB_PROJECTION',
    'MENTION_JOB_ROUTES',
    'ROUTE_APPEARANCES',
    'ROUTE_SENTIMENT',
    'ROUTE_SUMMARY',
    'Finish',
    'JobReaders',
    'RunListing',
    'available_runs',
    'compute_mention_view',
    'job_artifacts',
    'job_build_id',
    'job_scope_contract',
    'mention_job_answer',
]
