"""A small tenant (``testing.scale_data``) with its mention snapshot build and the uncapped live oracle (track S3).

``MentionTenant`` holds each keyword's latest-run rows, the KeywordLatest
objects the S1 writer would store (``mentions`` partial only), the build
``fold_scope`` makes of them, the readers a snapshot answer uses (recording
every call) and the oracle: the live computations of ``shared.brand_mention_views``
and ``shared.sentiment_examples`` over every row of the scope, with no cap.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import patch

import pytest

from shared import mention_scope_answers, mention_view_jobs, partial_mentions
from shared.artifact_mentions import MentionReaders, MentionsBuilder
from shared.artifact_registry import fold_scope
from shared.artifact_sentiment import SentimentIndexBuilder, SentimentReaders
from shared.brand_mention_views import (
    brand_summary,
    collect_brands,
    filter_rows,
    keyword_appearances,
    rank_map,
    with_brands_cursor,
)
from shared.mention_view_jobs import JobReaders
from shared.partial_contract import KeywordLatest, KeywordLatestRun, PartialConfig
from shared.sentiment_examples import ExampleClassification, sentiment_examples
from shared.snapshot_artifacts import SnapshotScope, computing_response, decode_keyword_cursor, keyword_page_start
from testing.paging import follow_next_token
from testing.scale_data import ScaleSpec, keyword_text, run_timestamp, search_result_rows
from testing.snapshot_fakes import FakeSnapshotArtifacts

RowKey = tuple[str, str]

#: An answer text far past every page budget, so the oracle and the pages are compared whole.
UNBOUNDED_BYTES = 1 << 40


def _spec_rows(spec: ScaleSpec, run_index: int) -> dict[str, list[dict[str, Any]]]:
    return {
        keyword_text(index): sorted(search_result_rows(spec, index, run_index), key=lambda row: row['timestamp_provider'])
        for index in range(spec.keywords)
    }


@dataclass
class MentionTenant:
    """``spec``'s keywords at their latest run (``spec.runs - 1``), the build of them and the oracle."""

    spec: ScaleSpec
    rows: dict[str, list[dict[str, Any]]] = field(init=False)
    previous_rows: dict[str, list[dict[str, Any]]] = field(init=False)
    run_reads: list[tuple[str, str]] = field(default_factory=list)
    preview_reads: list[list[RowKey]] = field(default_factory=list)
    text_reads: list[list[RowKey]] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.rows = _spec_rows(self.spec, self.spec.runs - 1)
        self.previous_rows = _spec_rows(self.spec, self.spec.runs - 2) if self.spec.runs > 1 else {}

    # -- the build ---------------------------------------------------------

    @property
    def keywords(self) -> list[str]:
        """The scope's keywords in scope order (case-insensitive, as the live path reads them)."""
        return sorted(self.rows, key=lambda keyword: (keyword.casefold(), keyword))

    @property
    def latest_timestamp(self) -> str:
        return run_timestamp(self.spec.runs - 1)

    @property
    def previous_timestamp(self) -> str:
        return run_timestamp(self.spec.runs - 2)

    def latests(self) -> list[KeywordLatest]:
        """What the KeywordLatest writer stores per keyword (the mentions partial of the latest run)."""
        found: list[KeywordLatest] = []
        for keyword in self.rows:
            previous: KeywordLatestRun | None = None
            if self.previous_rows:
                previous = {'timestamp': self.previous_timestamp, 'parts': {}}
            latest: KeywordLatestRun = {'timestamp': self.latest_timestamp, 'parts': {'mentions': partial_mentions.build(self.rows[keyword], PartialConfig())}}
            found.append({'v': 1, 'keyword': keyword, 'keyword_id': f'id-{keyword}', 'config': 'config-fp', 'latest': latest, 'previous': previous})
        return found

    def artifacts(self, build_id: str = 'build-0001', *, stale: bool = False, refreshing: bool = False) -> FakeSnapshotArtifacts:
        scope = SnapshotScope('all', 'all', None, None, self.spec.keywords)
        built = fold_scope([MentionsBuilder(), SentimentIndexBuilder()], self.latests(), scope)
        return FakeSnapshotArtifacts(built, self.spec.keywords, build_id=build_id, stale=stale, refreshing=refreshing)

    # -- readers -----------------------------------------------------------

    def _all_rows(self) -> dict[RowKey, dict[str, Any]]:
        every = [*self.rows.values(), *self.previous_rows.values()]
        return {(row['keyword'], row['timestamp_provider']): row for rows in every for row in rows}

    def run_rows(self, keyword: str, timestamp: str) -> list[dict[str, Any]]:
        self.run_reads.append((keyword, timestamp))
        source = self.rows if timestamp == self.latest_timestamp else self.previous_rows
        return [dict(row) for row in source.get(keyword, [])]

    def preview_rows(self, keys: list[RowKey]) -> dict[RowKey, dict[str, Any]]:
        self.preview_reads.append(list(keys))
        rows = self._all_rows()
        return {key: rows[key] for key in keys if key in rows}

    def answer_texts(self, keys: list[RowKey]) -> dict[RowKey, str]:
        self.text_reads.append(list(keys))
        rows = self._all_rows()
        return {key: rows[key]['response'] for key in keys if key in rows}

    def selected_run(self, keyword: str, timestamp: str | None) -> tuple[str | None, list[dict[str, Any]]]:
        selected = timestamp or self.latest_timestamp
        rows = self.run_rows(keyword, selected)
        return (selected, rows) if rows or timestamp else (None, [])

    def mention_readers(self) -> MentionReaders:
        return MentionReaders(run_rows=self.run_rows, preview_rows=self.preview_rows)

    def sentiment_readers(self) -> SentimentReaders:
        return SentimentReaders(run_rows=self.run_rows, answer_texts=self.answer_texts)

    def job_readers(self) -> JobReaders:
        return JobReaders(selected_run=self.selected_run, preview_rows=self.preview_rows, answer_texts=self.answer_texts)

    # -- the oracle (uncapped live path) -----------------------------------

    def _scope_rows(self, query_prompt_id: str | None, provider: str | None, *, previous: bool = False) -> list[list[dict[str, Any]]]:
        source = self.previous_rows if previous else self.rows
        return [filter_rows([dict(row) for row in source[keyword]], query_prompt_id, provider) for keyword in self.keywords]

    def oracle_summary(self, query_prompt_id: str | None, provider: str | None, classification: str | None, *, previous: bool = False) -> dict[str, Any]:
        """The uncapped live ``aggregated`` block, with ``brands_total`` (these tenants list fewer than ``BRAND_LIMIT`` brands, so no brand token)."""
        rows = [row for keyword_rows in self._scope_rows(query_prompt_id, provider, previous=previous) for row in keyword_rows]
        return with_brands_cursor(brand_summary(rows, classification), 'oracle')

    def oracle_appearances(
        self, query_prompt_id: str | None, provider: str | None, classification: str | None, brand: str | None, *, previous: bool = False,
    ) -> list[dict[str, Any]]:
        per_keyword = self._scope_rows(query_prompt_id, provider, previous=previous)
        ranks = rank_map(collect_brands([row for rows in per_keyword for row in rows]))
        return [appearance for rows in per_keyword for appearance in keyword_appearances(rows, ranks, classification, brand)]

    def oracle_examples(self, sentiment: str, provider: str | None, classification: ExampleClassification) -> tuple[int, list[dict[str, Any]]]:
        rows = [dict(row) for keyword in self.keywords for row in self.rows[keyword]]
        return sentiment_examples(
            rows, sentiment, provider=provider, classification=classification, limit=1 << 30, max_bytes=UNBOUNDED_BYTES,
        )


def follow_pages(serve: Callable[[str | None], Mapping[str, Any]], items: str, max_pages: int = 10_000) -> list[Any]:
    """Every ``items`` of every page ``serve(next_token)`` answers, from the first to the last ``next_token``."""
    collected: list[Any] = []
    token: str | None = None
    for _page in range(max_pages):
        body = serve(token)
        collected.extend(body[items])
        token = body['next_token']
        if token is None:
            return collected
        if decode_keyword_cursor(token) is None:
            raise AssertionError(f'unreadable next_token {token!r}')
    raise AssertionError('next_token never ran out')


def tenant_fixture(spec: ScaleSpec) -> Any:
    """A module-scoped ``tenant`` fixture over ``spec`` (assign it to ``tenant`` in the test module)."""
    @pytest.fixture(scope='module')
    def tenant() -> MentionTenant:
        return MentionTenant(spec)

    return tenant


def served(builder: Any, artifacts: Any, params: Mapping[str, Any]) -> dict[str, Any]:
    """``builder.serve(artifacts, params)``, which must answer (``None`` means the build lacks the view)."""
    body = builder.serve(artifacts, params)
    if body is None:
        raise AssertionError(f'{builder.name} answered no view for {sorted(params)}')
    return body


@dataclass(frozen=True)
class PagedView:
    """A paged snapshot view: its builder, the build, the filters and the cursor fingerprint of a build id."""

    builder: Any
    artifacts: Any
    params: Mapping[str, Any]
    fingerprint: Callable[[str, Mapping[str, Any]], str]

    def page(self, token: str | None, limit: int) -> dict[str, Any]:
        cursor, rejected = keyword_page_start(token, self.fingerprint(self.artifacts.build_id, self.params))
        if rejected is not None:
            raise AssertionError(f'cursor refused: {rejected}')
        return served(self.builder, self.artifacts, {**self.params, 'limit': limit, 'cursor': cursor})

    def follow(self, items: str, limit: int) -> list[Any]:
        """Every ``items`` of every page of ``limit``."""
        return follow_pages(lambda token: self.page(token, limit), items)


def status_and_code(response: Mapping[str, Any]) -> tuple[int, Any]:
    """A proxy response's status and its body's ``code`` (``cursor_expired`` ...), ``None`` without one."""
    return response['statusCode'], json.loads(response.get('body') or '{}').get('code')


@dataclass
class LargeScopeHandler:
    """A mention handler whose scope is routed to the snapshot: ``build`` is what ``open_snapshot`` answers, ``job`` what a view job does."""

    module: Any
    readers: Any
    build: Any
    call_handler: Callable[[dict[str, str]], dict[str, Any]]
    job: dict[str, Any] = field(default_factory=lambda: computing_response('job-1', '2026-10-05T07:40:00Z', {}))

    def call(self, params: dict[str, str]) -> dict[str, Any]:
        with (
            patch.object(self.module, 'latest_run_source', return_value='snapshot'),
            patch.object(mention_scope_answers, 'open_snapshot', side_effect=lambda _scope, _updated: self.build),
            patch.object(self.module, 'READERS', self.readers),
            patch.object(mention_view_jobs, 'view_job_response', side_effect=lambda *_args: self.job),
        ):
            return self.call_handler(params)

    def body(self, params: dict[str, str]) -> Any:
        return json.loads(self.call(params)['body'])

    def pages(self, params: dict[str, str], items: str) -> list[Any]:
        """Every ``items`` of every page from ``params`` on, following ``next_token``."""
        return follow_next_token(lambda query: self.call(dict(query)), params, lambda body: body[items])

    def after_rebuild(self, params: dict[str, str], rebuilt: Any) -> dict[str, Any]:
        """The second page of ``params`` asked for once ``rebuilt`` replaced the build the first page came from."""
        token = self.body(params)['next_token']
        self.build = rebuilt
        return self.call({**params, 'next_token': token})


__all__ = [
    'UNBOUNDED_BYTES',
    'LargeScopeHandler',
    'MentionTenant',
    'PagedView',
    'follow_pages',
    'served',
    'status_and_code',
    'tenant_fixture',
]
