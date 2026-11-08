"""The scope contract every KPI route of track S2 keeps over a scope larger than the live budget (2.45.0).

One parametrised suite over ``/visibility``, ``/trends`` and ``/reports/group-kpis``:
a stored build labels the body (``source``, ``as_of``, ``stale``,
``refreshing``) and is read without a SearchResults partition; a list token
of another build is ``cursor_expired``; no build answers 202 from a view job;
a scope within the budget rejects a snapshot token. The route-specific
equality with the live path is in each route's ``*_sources`` suite.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import pytest

from shared.artifact_group_kpis import GROUP_KPIS_BUILDER, group_kpis_artifacts
from shared.artifact_trends import TRENDS_BUILDER, trends_artifacts
from shared.snapshot_artifacts import CURSOR_EXPIRED_CODE, encode_snapshot_cursor
from testing.handler_fixtures import handler_fixture
from testing.kpi_route_fixtures import from_build, kpi_route, latest_build, window_build
from testing.kpi_scope_fixtures import JOB_ID, scope_keywords
from testing.report_scope_fixtures import REPORT_TABLES_ENV

_API_DIR = os.path.dirname(os.path.abspath(__file__))
_BUILT = datetime(2026, 10, 5, 7, 12, tzinfo=UTC)

visibility_route = handler_fixture(_API_DIR, 'get-visibility-metrics.py', 'visibility_scope_contract_under_test', env=REPORT_TABLES_ENV)
trends_route = handler_fixture(_API_DIR, 'get-historical-trends.py', 'trends_scope_contract_under_test', env=REPORT_TABLES_ENV)
group_kpis_route = handler_fixture(_API_DIR, 'get-group-kpi-history.py', 'group_kpis_scope_contract_under_test', env=REPORT_TABLES_ENV)



@dataclass(frozen=True)
class Route:
    """One KPI route: its handler fixture, path, the query of its paged list and how its build is made."""

    fixture: str
    path: str
    name: str
    page_query: dict[str, str]
    build: Callable[..., Any]


ROUTES = [
    Route('visibility_route', '/api/visibility', 'visibility', {'view': 'keywords'}, latest_build),
    Route(
        'trends_route', '/api/trends', 'trends', {'view': 'keyword_trends'},
        lambda keywords, **options: window_build(keywords, TRENDS_BUILDER, trends_artifacts, _BUILT, **options),
    ),
    Route(
        'group_kpis_route', '/api/reports/group-kpis', 'group-kpis', {'view': 'keywords', 'days': '30'},
        lambda keywords, **options: window_build(keywords, GROUP_KPIS_BUILDER, group_kpis_artifacts, _BUILT, **options),
    ),
]
_IDS = [route.name for route in ROUTES]
_ALL = {'scope': 'all'}


@pytest.fixture
def handlers(visibility_route, trends_route, group_kpis_route) -> dict[str, Any]:
    """Each route's handler module, by ``Route.fixture``."""
    return {'visibility_route': visibility_route, 'trends_route': trends_route, 'group_kpis_route': group_kpis_route}


@pytest.fixture(params=ROUTES, ids=_IDS)
def large(request, handlers) -> Any:
    spec: Route = request.param
    with kpi_route(handlers[spec.fixture], spec.path, scope_keywords(150), frozen=_BUILT) as route:
        yield spec, route


@pytest.fixture(params=ROUTES, ids=_IDS)
def small(request, handlers) -> Any:
    spec: Route = request.param
    with kpi_route(handlers[spec.fixture], spec.path, scope_keywords(3), frozen=_BUILT) as route:
        yield spec, route


def test_labels_the_body_with_a_stale_build(large) -> None:
    spec, route = large
    _status, body, _job = from_build(route, spec.build(route.keywords, stale=True, refreshing=True), {**_ALL, 'days': '30'})

    assert (body['source'], body['as_of'], body['stale'], body['refreshing'], body['coverage']) == (
        'snapshot', '2026-10-05T07:12:00Z', True, True, {'keywords_total': 150, 'keywords_analyzed': 150, 'complete': True},
    )


def test_reads_no_search_results_partition_from_a_build(large) -> None:
    spec, route = large
    from_build(route, spec.build(route.keywords), {**_ALL, 'days': '30'})

    assert route.search.query.call_count == 0


def test_a_list_token_of_another_build_is_cursor_expired(large) -> None:
    spec, route = large
    token = encode_snapshot_cursor(100, 150, 'build-0042') or ''
    status, body, _job = from_build(route, spec.build(route.keywords), {**_ALL, **spec.page_query, 'next_token': token})

    assert (status, body['code']) == (400, CURSOR_EXPIRED_CODE)


def test_answers_202_from_a_view_job_without_a_build(large) -> None:
    spec, route = large
    status, body, job = from_build(route, None, {**_ALL, 'days': '30'})

    assert (status, body['job']['id'], job.call_args.args[0]) == (202, JOB_ID, spec.name)


def test_a_scope_within_the_budget_rejects_a_snapshot_token(small) -> None:
    spec, route = small
    token = encode_snapshot_cursor(100, 200, 'build-0001') or ''
    status, body, job = from_build(route, None, {**_ALL, **spec.page_query, 'next_token': token})

    assert (status, body['code'], job.call_count) == (400, CURSOR_EXPIRED_CODE, 0)


def test_a_malformed_list_token_is_a_400_on_next_token(large) -> None:
    spec, route = large
    status, body, _job = from_build(route, spec.build(route.keywords), {**_ALL, **spec.page_query, 'next_token': 'not-a-token'})

    assert (status, body['field']) == (400, 'next_token')
