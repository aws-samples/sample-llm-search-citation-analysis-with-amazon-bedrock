"""
Where the action and insight lists of a scope come from (track S4): computed live, or served from the scope snapshot.

The handlers of ``/citation-gaps``, ``/prompt-insights``, ``/recommendations``,
``/reports/competitor``, ``/reports/insights`` and the Content Studio ideas
ask ``action_route`` first (``shared.scope_source.route_scope`` over the
scope's latest run: every keyword x enabled persona x AI engine). A scope
that fits ``LIVE_ROWS_BUDGET`` is read whole for the request
(``read_live_latests``: every keyword's latest run, no keyword cap; the time
budget stays a safety net and is reported as ``keywords_truncated``) and
served by the same artifact builder over the folded live partials
(``serve_live``), so both paths answer one body for one set of answers. A
larger scope is served from its stored build (``serve_snapshot``), or with a
view job (202) when the build does not hold it.

Lists are paged with ``{o, b}`` tokens either way: a snapshot page names
its build; a live page names ``live-<fingerprint of the scope's keywords>``,
so a membership change between two pages expires the cursor instead of
mixing two keyword sets.
"""

from __future__ import annotations

import hashlib
import os
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from shared import partial_actions, partial_insights, scope_snapshot_serve, scoped_reports
from shared.analysis_runs import MAX_QUERY_PROMPTS_PER_RUN, fetch_enabled_query_prompts
from shared.answer_queries import query_latest_run_rows
from shared.api_response import validation_error
from shared.artifact_registry import artifact_builders, fold_scope
from shared.cursors import CURSOR_QUERY_PARAM
from shared.decorators import validate
from shared.partial_contract import KeywordLatest, KeywordLatestRun, PartialConfig, PartialModule, RunRows
from shared.scope_params import (
    SCOPE_QUERY_PARAMS,
    ReportScope,
    all_active_scope,
    keywords_table_name,
    scope_from_request,
)
from shared.scope_snapshot_serve import Answer, SnapshotRequest
from shared.scope_source import PERSONA_ENGINES, PLAIN_ENGINES, route_scope
from shared.snapshot_artifacts import (
    MemoryArtifacts,
    ScopeSource,
    SnapshotScope,
    coverage,
    live_envelope,
    snapshot_page_start,
    with_scope_contract,
)

#: The action lists read only each keyword's latest run.
LATEST_RUN_ONLY = 1

#: The partials a live request can build, by name.
LIVE_PARTIALS: dict[str, PartialModule] = {'actions': partial_actions, 'insights': partial_insights}


def enabled_personas(resource: Any) -> int:
    """The enabled personas; the most a run asks when the QueryPrompts table is not configured for this function."""
    table_name = os.environ.get('DYNAMODB_TABLE_QUERY_PROMPTS')
    if not table_name:
        return MAX_QUERY_PROMPTS_PER_RUN
    return len(fetch_enabled_query_prompts(resource.Table(table_name)))


def action_route(report_scope: ReportScope, resource: Any, runs_needed: int = LATEST_RUN_ONLY) -> ScopeSource:
    """``'live'`` or ``'snapshot'`` for ``report_scope``."""
    return route_scope(
        report_scope.kind, len(report_scope.keywords), personas=enabled_personas(resource), engines=PERSONA_ENGINES,
        runs_needed=runs_needed, plain_engines=PLAIN_ENGINES,
    )


def resolve_scope(event: dict[str, Any], scope_params: dict[str, Any], keywords_table: Any) -> tuple[ReportScope | None, dict[str, Any] | None]:
    """The requested scope, or every active keyword without one; ``(None, 400)`` for a malformed scope or one without active keywords.

    A scope that resolves to no active keyword (an unknown group, or one whose
    members are all paused) is refused rather than answered as empty.
    """
    report_scope, rejected = scope_from_request(event, scope_params, keywords_table)
    if rejected is not None:
        return None, rejected
    if report_scope is None:
        return all_active_scope(keywords_table), None
    if not report_scope.keywords:
        return None, validation_error(f'No active keywords match the selected scope ({report_scope.label}).', event, 'scope')
    return report_scope, None


# ---------------------------------------------------------------------------
# Live
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class LiveLatests:
    """The KeywordLatest objects of a scope's keywords read for this request, and the keywords the time budget left unread."""

    latests: list[KeywordLatest]
    skipped: tuple[str, ...]


def live_latest(keyword: str, rows: RunRows, config: PartialConfig, parts: Sequence[str]) -> KeywordLatest:
    """The KeywordLatest object (``parts`` only) of a keyword whose latest run is ``rows``."""
    built = {name: LIVE_PARTIALS[name].build(rows, config) for name in parts} if rows else {}
    timestamp = max((str(row.get('timestamp') or '') for row in rows), default='')
    run: KeywordLatestRun | None = {'timestamp': timestamp, 'parts': built} if rows else None
    return {'v': 1, 'keyword': keyword, 'keyword_id': '', 'config': '', 'latest': run, 'previous': None}


def read_live_latests(
    keywords: Sequence[str],
    search_results: Any,
    config: PartialConfig,
    parts: Sequence[str],
    read: Callable[[Any, str], RunRows] = query_latest_run_rows,
) -> LiveLatests:
    """Every keyword's latest run, read in parallel and turned into its ``parts``.

    A keyword whose read fails has no run (logged by ``map_scope_keywords``);
    one the time budget left unread is ``skipped``.
    """
    read_rows = scoped_reports.read_scope_keywords(
        keywords,
        lambda keyword: live_latest(keyword, read(search_results, keyword), config, parts),
        lambda keyword: live_latest(keyword, [], config, parts),
    )
    return LiveLatests(list(read_rows.values.values()), read_rows.skipped)


def live_build_id(report_scope: ReportScope) -> str:
    """The build id live pages carry: the fingerprint of the scope's keywords."""
    digest = hashlib.sha256('\n'.join(report_scope.keywords).encode('utf-8')).hexdigest()[:16]
    return f'live-{digest}'


def _snapshot_scope(report_scope: ReportScope) -> SnapshotScope:
    """The scope a live fold folds into (a keyword list folds like ``all``: no group history)."""
    total = len(report_scope.keywords)
    if report_scope.kind == 'group':
        group_id = str((report_scope.scope.get('group_ids') or [''])[0])
        return SnapshotScope(scope_dir='live', kind='group', group_id=group_id, market_id=report_scope.market_id, keywords_total=total)
    return SnapshotScope(scope_dir='live', kind='all', group_id=None, market_id=report_scope.market_id, keywords_total=total)


def live_body(builder: str, read: LiveLatests, report_scope: ReportScope, params: Mapping[str, Any]) -> dict[str, Any]:
    """The body ``builder`` serves over this request's partials, with the live coverage and envelope."""
    chosen = artifact_builders()[builder]
    folded = fold_scope([chosen], read.latests, _snapshot_scope(report_scope))
    total = len(report_scope.keywords)
    body = chosen.serve(MemoryArtifacts(folded, live_build_id(report_scope), '', total), params) or {}
    analyzed = min(len(read.latests), total)
    return with_scope_contract({**body, 'keywords_truncated': bool(read.skipped)}, coverage(total, analyzed), live_envelope())


# ---------------------------------------------------------------------------
# Snapshot
# ---------------------------------------------------------------------------

def page_offset(next_token: str | None, build_id: str, event: dict[str, Any] | None) -> tuple[int, dict[str, Any] | None]:
    """The offset a page token asks for in the list of ``build_id`` (0 without one), or the 400 a bad or expired one gets."""
    cursor, rejected = snapshot_page_start(next_token, build_id, (), event)
    if rejected is not None or cursor is None:
        return 0, rejected
    return cursor.offset, None


def complete_body(body: Mapping[str, Any]) -> dict[str, Any]:
    """A body served from every keyword's partials: ``keywords_truncated`` false (kept for one release), as a live read that was not cut."""
    return {'keywords_truncated': False, **body}


def serve_snapshot(request: SnapshotRequest) -> Answer:
    """The body the scope's build (or, when it holds none, a view job) serves for the request, or the response to send instead (202, failed job, 400)."""
    answered = scope_snapshot_serve.serve_snapshot_request(request)
    return Answer(body=complete_body(answered[0])) if isinstance(answered, tuple) else Answer(response=answered)


def serve_scope(
    request: SnapshotRequest,
    resource: Any,
    live_read: Callable[[], LiveLatests],
    runs_needed: int = LATEST_RUN_ONLY,
) -> Answer:
    """Live or snapshot (``action_route``), the page ``request.next_token`` asks for either way."""
    if action_route(request.report_scope, resource, runs_needed) == 'snapshot':
        return serve_snapshot(request)
    offset, rejected = page_offset(request.next_token, live_build_id(request.report_scope), request.event)
    if rejected is not None:
        return Answer(response=rejected)
    return Answer(body=live_body(request.builder, live_read(), request.report_scope, {**request.params, 'offset': offset}))


def action_request(
    route: str, builder: str, params: Mapping[str, Any], report_scope: ReportScope, brand_config: Mapping[str, Any],
    event: dict[str, Any] | None, next_token: str | None = None, job_params: Mapping[str, Any] | None = None,
) -> SnapshotRequest:
    """The request of an action list: ``route`` names its view jobs, ``builder`` its artifact (``job_params``: ``SnapshotRequest.job_params``)."""
    return SnapshotRequest(route, builder, params, report_scope, brand_config.get('updated_at'), event, next_token, job_params)


def serve_action_list(request: SnapshotRequest, resource: Any, search_results: Any, brand_config: Mapping[str, Any]) -> Answer:
    """``serve_scope`` for a list built from the ``actions`` partial: live, every keyword's latest run of ``search_results``."""
    config = PartialConfig(brand_config=brand_config)
    return serve_scope(request, resource, lambda: read_live_latests(request.report_scope.keywords, search_results, config, ('actions',)))


def action_scope(resource: Callable[[], Any]) -> Callable[[Callable[..., dict[str, Any]]], Callable[..., dict[str, Any] | None]]:
    """Resolve the scope parameters ``@validate`` injected (``resolve_scope``) into the handler's third argument.

    Place it under ``@validate({**SCOPE_QUERY_PARAMS, ...})``. ``resource``
    answers the handler's DynamoDB resource per request (tests swap it); the
    scope resolves against its Keywords table. Without a scope the handler gets
    every active keyword; a malformed scope, or one without an active keyword,
    is answered with its 400 without calling the handler.
    """
    return scoped_reports.scope_decorator(lambda: resource().Table(keywords_table_name()), resolve_scope)


def limit_param(default: int, maximum: int) -> dict[str, Any]:
    """The ``@validate`` rule of a list's ``limit`` (page size or list length)."""
    return {'type': int, 'min': 1, 'max': maximum, 'default': default}


def action_list_endpoint(
    params: Mapping[str, Any], resource: Callable[[], Any], *, paged: bool = False,
) -> Callable[[Callable[..., dict[str, Any]]], Callable[..., Any]]:
    """``@validate`` of ``params``, the report scope parameters and (``paged``) ``next_token``, then ``action_scope(resource)``."""
    validated = validate({**params, **(CURSOR_QUERY_PARAM if paged else {}), **SCOPE_QUERY_PARAMS})
    scoped = action_scope(resource)
    return lambda handler: validated(scoped(handler))


__all__ = [
    'Answer',
    'LiveLatests',
    'SnapshotRequest',
    'action_list_endpoint',
    'action_request',
    'action_route',
    'action_scope',
    'complete_body',
    'enabled_personas',
    'limit_param',
    'live_body',
    'live_build_id',
    'live_latest',
    'page_offset',
    'read_live_latests',
    'resolve_scope',
    'serve_action_list',
    'serve_scope',
    'serve_snapshot',
]
