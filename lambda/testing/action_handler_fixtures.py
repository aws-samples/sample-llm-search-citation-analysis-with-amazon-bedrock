"""Fakes for the S4 action-list handlers (``/prompt-insights``, ``/citation-gaps``, ``/recommendations``,
``/reports/competitor``, ``/reports/insights``, Content Studio ideas).

``action_tables`` wires a Keywords table listing active keywords and a
SearchResults table answering their rows (``testing.search_results_fixtures``).
``snapshot_route`` routes every scope to the snapshot and stands in for
track S1's store (``open_snapshot``) and view jobs (``view_job_response``,
answered with a 202 ``computing`` body), recording what they were asked.
"""

from __future__ import annotations

import itertools
from collections.abc import Generator, Mapping, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import MagicMock, patch

from shared import action_scope_serve, scope_snapshot_serve
from shared.artifact_registry import fold_scope
from shared.request_deadline import Deadline
from shared.snapshot_artifacts import ArtifactBuilder, SnapshotScope, computing_response
from testing.action_rule_fixtures import scope_latests
from testing.events import api_gateway_event, parse_response
from testing.search_results_fixtures import (
    active_keywords_table,
    report_dynamodb,
    search_result_row,
    search_results_table,
)
from testing.snapshot_fakes import FakeSnapshotArtifacts

RUN = '2026-10-01T06:00:00Z'
EARLIER = '2026-09-24T06:00:00Z'
JOB_STARTED = '2026-10-05T07:15:00Z'

ACTION_BRAND_CONFIG: dict[str, Any] = {
    'tracked_brands': {'first_party': ['Hotel Sol'], 'competitors': ['Parador']},
    'first_party_domains': ['hotel-sol.com'],
    'industry': 'hotels',
    'updated_at': '2026-09-30T10:00:00Z',
}


def fp(rank: int, **fields: Any) -> dict[str, Any]:
    """A first-party mention at ``rank``."""
    return {'name': 'Hotel Sol', 'classification': 'first_party', 'rank': rank, **fields}


def rival(rank: int, **fields: Any) -> dict[str, Any]:
    """A competitor mention at ``rank``."""
    return {'name': 'Parador', 'classification': 'competitor', 'rank': rank, **fields}


def answer(keyword: str, provider: str, *brands: Mapping[str, Any], timestamp: str = RUN, citations: Sequence[str] = ()) -> dict[str, Any]:
    """One stored SearchResults row of ``keyword``'s run at ``timestamp``."""
    return search_result_row(keyword, provider, brands, timestamp=timestamp, status='success', citations=list(citations))


def active(keywords: Sequence[str]) -> list[dict[str, Any]]:
    """Keywords-table rows of active keywords, each in group ``g1``."""
    return [{'id': f'k{index}', 'keyword': keyword, 'status': 'active', 'group_ids': {'g1'}} for index, keyword in enumerate(keywords)]


def action_tables(
    rows_by_keyword: Mapping[str, Sequence[Mapping[str, Any]] | Exception], search_table_name: str = 'test-search-results',
) -> MagicMock:
    """A DynamoDB resource listing ``rows_by_keyword``'s keywords as active and answering their SearchResults rows.

    ``search_table_name`` is the SearchResults table's name in the handler's environment.
    """
    keywords = list(rows_by_keyword)
    search = search_results_table(rows_by_keyword)
    return report_dynamodb(search, active_keywords_table(active(keywords)), {search_table_name: search})


def snapshot_of(
    builders: Sequence[ArtifactBuilder[Any]], rows: Sequence[Mapping[str, Any]], brand_config: Mapping[str, Any], keywords_total: int,
) -> FakeSnapshotArtifacts:
    """A stored build of a scope whose keywords' latest runs are ``rows``, folded by ``builders``."""
    scope = SnapshotScope(scope_dir='all', kind='all', group_id=None, market_id=None, keywords_total=keywords_total)
    return FakeSnapshotArtifacts(fold_scope(builders, scope_latests(rows, brand_config), scope), keywords_total=keywords_total)


def run_rows(rows_by_keyword: Mapping[str, Sequence[Mapping[str, Any]]]) -> list[Mapping[str, Any]]:
    """Every row of ``rows_by_keyword``, keyword after keyword."""
    return [row for rows in rows_by_keyword.values() for row in rows]


def get_action(
    module: Any, rows: Mapping[str, Any], query: Mapping[str, str] | None = None, config: Mapping[str, Any] = ACTION_BRAND_CONFIG, *, path: str,
) -> tuple[int, Any]:
    """``GET path`` with ``query`` on ``module``'s handler over ``action_tables(rows)``: ``(status, decoded body)``."""
    event = api_gateway_event('GET', path, query=dict(query) if query is not None else None)
    with patch.object(module, 'dynamodb', action_tables(rows)), patch.object(module, 'get_brand_config', return_value=dict(config)):
        return parse_response(module.handler(event, None))


def rows_by_keyword(items: Sequence[Mapping[str, Any]]) -> dict[str, list[Mapping[str, Any]]]:
    """``items`` grouped by their ``keyword``, keywords in first-seen order."""
    grouped: dict[str, list[Mapping[str, Any]]] = {}
    for item in items:
        grouped.setdefault(str(item['keyword']), []).append(item)
    return grouped


def served_from_snapshot(
    module: Any, builder: ArtifactBuilder[Any], rows: Mapping[str, Sequence[Mapping[str, Any]]], query: Mapping[str, str],
    config: Mapping[str, Any] = ACTION_BRAND_CONFIG, *, path: str,
) -> Any:
    """The body ``GET path`` answers when every scope is served from a build ``builder`` folded over ``rows``."""
    stored = snapshot_of([builder], run_rows(rows), config, keywords_total=len(rows))
    with snapshot_route(stored):
        return get_action(module, rows, query, config, path=path)[1]


def computing_jobs(
    module: Any, rows: Mapping[str, Any], query: Mapping[str, str], config: Mapping[str, Any] = ACTION_BRAND_CONFIG, *, path: str,
) -> tuple[int, Any, list[tuple[str, dict[str, Any]]]]:
    """``(status, body, view jobs started)`` of ``GET path`` when no build holds the scope."""
    with snapshot_route(None) as calls:
        status, body = get_action(module, rows, query, config, path=path)
    return status, body, calls.jobs


@contextmanager
def ticking_budget(checks: int = 3) -> Generator[None]:
    """A request time budget spent after ``checks`` clock reads, with one keyword read at a time (the cut lands mid-scope)."""
    ticks = itertools.count()
    with patch('shared.request_deadline.Deadline', lambda _seconds: Deadline(checks, lambda: next(ticks))), patch('shared.scope_params.SCOPE_MAX_WORKERS', 1):
        yield


def cut_short(module: Any, query: Mapping[str, str] | None, *brands: Mapping[str, Any], path: str, citations: Sequence[str] = ()) -> tuple[int, bool, bool]:
    """``(status, keywords_truncated, coverage complete)`` of ``GET path`` over six keywords (each naming ``brands``) when the budget ends mid-read."""
    rows = {f'kw {index:02d}': [answer(f'kw {index:02d}', 'openai', *brands, citations=citations)] for index in range(6)}
    with ticking_budget():
        status, body = get_action(module, rows, query, path=path)
    return status, bool(body['keywords_truncated']), bool(body['coverage']['complete'])


def partitions_read_at_scale(module: Any, path: str, query: Mapping[str, str], keywords: int = 500) -> tuple[int, int]:
    """``GET path`` over a scope of ``keywords`` active keywords with no snapshot built: ``(status, SearchResults queries sent)``."""
    resource = action_tables({f'kw {index:04d}': [] for index in range(keywords)})
    event = api_gateway_event('GET', path, query=dict(query))
    with snapshot_route(None, every_scope=False), patch.object(module, 'dynamodb', resource), patch.object(module, 'get_brand_config', return_value=ACTION_BRAND_CONFIG):
        status, _body = parse_response(module.handler(event, None))
    return status, resource.Table('test-search-results').query.call_count


@dataclass
class SnapshotCalls:
    """What the stand-ins for track S1 were asked."""

    opened: list[Any] = field(default_factory=list)
    jobs: list[tuple[str, dict[str, Any]]] = field(default_factory=list)


@contextmanager
def snapshot_route(artifacts: FakeSnapshotArtifacts | None, *, every_scope: bool = True) -> Generator[SnapshotCalls]:
    """Scopes served from ``artifacts`` (``None``: no build holds it); view jobs answer 202.

    ``every_scope`` routes every scope to the snapshot; without it the real
    routing rule decides (``action_route``).
    """
    calls = SnapshotCalls()

    def open_snapshot(report_scope: Any, updated_at: str | None) -> FakeSnapshotArtifacts | None:
        calls.opened.append((report_scope.kind, updated_at))
        return artifacts

    def view_job_response(route: str, params: Mapping[str, Any], report_scope: Any, event: Any) -> dict[str, Any]:
        del report_scope
        calls.jobs.append((route, dict(params)))
        return computing_response('job-0001', JOB_STARTED, event)

    route = action_scope_serve.action_route
    with (
        patch.object(action_scope_serve, 'action_route', side_effect=lambda *_args: 'snapshot' if every_scope else route(*_args)),
        patch.object(scope_snapshot_serve, 'open_snapshot', side_effect=open_snapshot),
        patch.object(scope_snapshot_serve, 'view_job_response', side_effect=view_job_response),
        patch.object(scope_snapshot_serve, 'view_job_artifacts', side_effect=lambda *args: (None, view_job_response(*args))),
    ):
        yield calls


__all__ = [
    'ACTION_BRAND_CONFIG',
    'EARLIER',
    'RUN',
    'SnapshotCalls',
    'action_tables',
    'active',
    'answer',
    'computing_jobs',
    'cut_short',
    'fp',
    'get_action',
    'partitions_read_at_scale',
    'rival',
    'rows_by_keyword',
    'run_rows',
    'served_from_snapshot',
    'snapshot_of',
    'snapshot_route',
    'ticking_budget',
]
