"""
Where the KPI views of a scope come from (track S2): computed live, or served from the scope snapshot.

The handlers of ``/visibility``, ``/trends``, ``/reports/overview``,
``/reports/group-kpis`` and ``/stats`` ask ``kpi_route`` first
(``shared.scope_source.route_scope`` with this tenant's enabled personas and
the AI engines): a scope whose live read fits ``LIVE_ROWS_BUDGET`` is
computed for the request, whole (no keyword cap; the time budget stays as a
safety net and is reported as ``keywords_truncated``). A larger one is served
by ``serve_from_snapshot``: the stored build (``open_snapshot``), the
builder's ``serve``, and a view job (202) when the build does not hold the
view. Either way the body carries the scope contract (``scoped_body``).

The live visibility view folds the same ``kpi`` partials the snapshot
builder folds and serves them through the same ``serve`` over
``live_artifacts``, so both paths answer the same body for the same answers.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from boto3.dynamodb.conditions import Key
from botocore.exceptions import BotoCoreError, ClientError

from shared import partial_kpi, scope_snapshot_serve
from shared.api_response import validation_error
from shared.constants import MAX_QUERY_PROMPTS_DEFAULT
from shared.cursors import CURSOR_ERROR_MESSAGE, CURSOR_QUERY_PARAM
from shared.partial_contract import KeywordLatest, KeywordLatestRun, PartialConfig, RunRows
from shared.scope_params import ReportScope
from shared.scope_snapshot_serve import Answer, SnapshotRequest
from shared.scope_source import LATEST_RUNS, PERSONA_ENGINES, PLAIN_ENGINES, route_scope
from shared.snapshot_artifacts import (
    MemoryArtifacts,
    ScopeSource,
    SnapshotArtifacts,
    artifacts_coverage,
    artifacts_envelope,
    coverage,
    cursor_expired_response,
    decode_snapshot_cursor,
    live_envelope,
    with_scope_contract,
)

logger = logging.getLogger(__name__)

#: Format version of the KeywordLatest objects ``live_keyword_latest`` builds in memory.
LIVE_LATEST_VERSION = 1


# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------

def enabled_persona_count(resource: Any) -> int:
    """The enabled personas (QueryPrompts ``EnabledIndex``); the most a run may ask when the table is not configured or unreadable."""
    table_name = os.environ.get('DYNAMODB_TABLE_QUERY_PROMPTS')
    if not table_name:
        return MAX_QUERY_PROMPTS_DEFAULT
    try:
        response = resource.Table(table_name).query(
            IndexName='EnabledIndex', KeyConditionExpression=Key('enabled').eq('true'), Select='COUNT',
        )
    except (BotoCoreError, ClientError) as error:
        logger.warning('Could not count the enabled personas, assuming the most a run asks: %s', error)
        return MAX_QUERY_PROMPTS_DEFAULT
    return int(response.get('Count') or 0)


def kpi_route(report_scope: ReportScope, resource: Any, runs_needed: int = LATEST_RUNS) -> ScopeSource:
    """``'live'`` or ``'snapshot'`` for a view of ``report_scope``'s answers in its ``runs_needed`` newest runs."""
    return route_scope(
        report_scope.kind, len(report_scope.keywords), personas=enabled_persona_count(resource), engines=PERSONA_ENGINES,
        runs_needed=runs_needed, plain_engines=PLAIN_ENGINES,
    )


#: The rows a keyword's window of per-run rollups (KeywordRunKpis, up to a year of ~3 KB rows, ~1 MB) counts
#: as in the live budget: what its two newest runs at 10 personas x 4 engines weigh (80 answers, ~1.3 MB of heap),
#: so the windowed views go live for the same scopes as the latest-run ones (100 keywords).
WINDOW_ROWS_PER_KEYWORD = 80


def kpi_window_route(report_scope: ReportScope) -> ScopeSource:
    """``'live'`` or ``'snapshot'`` for a window view of ``report_scope`` read from its per-run rollups (``/trends``, ``/reports/group-kpis``)."""
    return keyword_count_route(report_scope.kind, len(report_scope.keywords))


def keyword_count_route(kind: str, keywords: int) -> ScopeSource:
    """``kpi_window_route`` of a scope of ``kind`` known only by its keyword count (``/stats?market_id``: 100 keywords live)."""
    return route_scope(kind, keywords, personas=1, engines=1, runs_needed=WINDOW_ROWS_PER_KEYWORD)


def view_query_params(views: tuple[str, ...]) -> dict[str, dict[str, Any]]:
    """The ``@validate`` rules of a paged KPI route: ``view`` (the first of ``views`` by default) and ``next_token``."""
    return {'view': {'type': str, 'choices': list(views), 'default': views[0]}, **CURSOR_QUERY_PARAM}


# ---------------------------------------------------------------------------
# The scope contract
# ---------------------------------------------------------------------------

def scoped_body(body: Mapping[str, Any], report_scope: ReportScope, keywords_analyzed: int, artifacts: SnapshotArtifacts | None = None) -> dict[str, Any]:
    """``body`` with ``coverage`` and the source envelope: live when ``artifacts`` is ``None``, else the build's."""
    total = len(report_scope.keywords)
    if artifacts is not None:
        return with_scope_contract(body, artifacts_coverage(artifacts, total), artifacts_envelope(artifacts))
    return with_scope_contract(body, coverage(total, min(keywords_analyzed, total)), live_envelope())


# ---------------------------------------------------------------------------
# Live artifacts
# ---------------------------------------------------------------------------

#: The build id of artifacts folded for one request: no snapshot cursor names it.
LIVE_BUILD_ID = 'live'


def live_artifacts(artifacts: Mapping[str, Any], keywords_total: int) -> MemoryArtifacts:
    """Artifacts folded for this request, served by the same ``serve`` as a stored build; never stale (computed now)."""
    return MemoryArtifacts(artifacts, LIVE_BUILD_ID, '', keywords_total)


def _run(rows: RunRows, config: PartialConfig) -> KeywordLatestRun | None:
    part = partial_kpi.build(rows, config)
    if part is None:
        return None
    return {'timestamp': part['timestamp'], 'parts': {'kpi': part}}


def live_keyword_latest(keyword: str, latest_rows: RunRows, previous_rows: RunRows, config: PartialConfig) -> KeywordLatest:
    """The KeywordLatest object (``kpi`` parts only) of a keyword's two newest runs read for this request."""
    return {
        'v': LIVE_LATEST_VERSION, 'keyword': keyword, 'keyword_id': '', 'config': '',
        'latest': _run(latest_rows, config), 'previous': _run(previous_rows, config),
    }


# ---------------------------------------------------------------------------
# Serving from the snapshot
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Served:
    """A body a builder served, and the build it came from."""

    body: dict[str, Any]
    artifacts: SnapshotArtifacts


def live_page_rejection(next_token: str | None, event: dict[str, Any] | None) -> dict[str, Any] | None:
    """The 400 a ``next_token`` gets on a scope served live (``None`` without one).

    A live body holds every row, so no live token exists: a token is either
    malformed or minted by a snapshot of a scope that has since shrunk to the
    live budget (``cursor_expired``: the client restarts the list).
    """
    if next_token is None:
        return None
    if decode_snapshot_cursor(next_token) is None:
        return validation_error(CURSOR_ERROR_MESSAGE, event, 'next_token')
    return cursor_expired_response(event)


def live_list_offset(next_token: str | None, event: dict[str, Any] | None) -> int | dict[str, Any]:
    """Where a live list page starts: 0 without a token, the offset of a token a live answer minted, else ``live_page_rejection``'s 400.

    A live list too long for one page (``view=brands`` …) pages with
    ``encode_snapshot_cursor`` tokens naming ``LIVE_BUILD_ID``; a snapshot
    token on a scope now served live is ``cursor_expired``.
    """
    if next_token is None:
        return 0
    cursor = decode_snapshot_cursor(next_token)
    if cursor is not None and cursor.build_id == LIVE_BUILD_ID:
        return cursor.offset
    rejected = live_page_rejection(next_token, event)
    return rejected if rejected is not None else 0


def serve_from_snapshot(request: SnapshotRequest) -> Served | dict[str, Any]:
    """The body the scope's build (or, when it holds none, a view job) serves for the request (``Served``), or the response to send instead (202, failed job, 400)."""
    answered = scope_snapshot_serve.serve_snapshot_request(request)
    return Served(*answered) if isinstance(answered, tuple) else answered


@dataclass(frozen=True)
class ScopedAnswer(Answer):
    """A view's body with the scope contract and the keywords it covers, or the response (400, 202, failed job) to send instead."""

    analyzed: int = 0


def answer_scoped(
    live: bool,
    request: SnapshotRequest,
    compute: Callable[[], ScopedAnswer],
    shape: Callable[[dict[str, Any]], dict[str, Any]] = dict,
) -> ScopedAnswer:
    """The view of ``request``: ``compute()`` for a ``live`` scope, else the snapshot's body as ``shape`` frames it; with the scope contract.

    ``compute`` answers the view's fields (``body``) and the keywords it read
    (``analyzed``), or a ``response``. A live scope rejects ``request.next_token``
    (``live_page_rejection``): pass only a snapshot list's token.
    """
    scope = request.report_scope
    if not live:
        served = serve_from_snapshot(request)
        if not isinstance(served, Served):
            return ScopedAnswer(response=served)
        return ScopedAnswer(scoped_body(shape(served.body), scope, len(scope.keywords), served.artifacts), analyzed=len(scope.keywords))
    rejected = live_page_rejection(request.next_token, request.event)
    if rejected is not None:
        return ScopedAnswer(response=rejected)
    result = compute()
    if result.body is None:
        return result
    return ScopedAnswer(scoped_body(result.body, scope, result.analyzed), analyzed=result.analyzed)


__all__ = [
    'LIVE_BUILD_ID',
    'WINDOW_ROWS_PER_KEYWORD',
    'ScopedAnswer',
    'Served',
    'SnapshotRequest',
    'answer_scoped',
    'enabled_persona_count',
    'keyword_count_route',
    'kpi_route',
    'kpi_window_route',
    'live_artifacts',
    'live_keyword_latest',
    'live_list_offset',
    'live_page_rejection',
    'scoped_body',
    'serve_from_snapshot',
    'view_query_params',
]
