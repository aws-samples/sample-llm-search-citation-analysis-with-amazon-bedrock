"""GET /api/trends and /api/reports/overview: complete for every scope (2.45.0), live under the budget, from the trend presets over it.

The S1 store functions are replaced by fakes; the stored build is the
``trends`` builder's fold of the same runs at a frozen clock, so a served
preset is compared with the uncapped live answer (the oracle).
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from typing import Any
from unittest.mock import patch

import pytest

from shared import artifact_registry
from shared.artifact_trends import TRENDS_BUILDER, trends_artifacts
from testing.handler_fixtures import handler_fixture
from testing.kpi_route_fixtures import drained, from_build, kpi_route, served_and_live, window_build
from testing.kpi_scope_fixtures import scope_keywords, snapshot_store, without
from testing.report_scope_fixtures import REPORT_TABLES_ENV
from testing.window_budget_fixtures import one_scope_worker, ticking_deadline, window_read_budget

_API_DIR = os.path.dirname(os.path.abspath(__file__))

trends_handler = handler_fixture(_API_DIR, 'get-historical-trends.py', 'get_historical_trends_sources_under_test', env=REPORT_TABLES_ENV)
overview_handler = handler_fixture(_API_DIR, 'get-reports-overview.py', 'get_reports_overview_sources_under_test', env=REPORT_TABLES_ENV)

#: The build, a week after the newer of ``two_run_rows``' runs: a 7-day window holds that run only.
_BUILT = datetime(2026, 10, 5, 7, 12, tzinfo=UTC)
#: 100 keywords fit the window budget (``kpi_window_route``), whatever ``days``.
_LIVE_MAX = 100
#: The fields only the snapshot path pages or labels differently.
_PAGING = ('keyword_trends', 'keyword_trends_next_token', 'coverage', 'source', 'as_of')
_ALL = {'scope': 'all'}


def _stored(keywords: list[str], **options: Any) -> Any:
    return window_build(keywords, TRENDS_BUILDER, trends_artifacts, _BUILT, **options)


@pytest.fixture
def live_scope(trends_handler) -> Any:
    with kpi_route(trends_handler, '/api/trends', scope_keywords(_LIVE_MAX), frozen=_BUILT) as route:
        yield route


@pytest.fixture
def large(trends_handler) -> Any:
    with kpi_route(trends_handler, '/api/trends', scope_keywords(_LIVE_MAX + 50), frozen=_BUILT) as route:
        yield route


class TestLive:
    def test_answers_every_keyword_of_a_scope_at_the_budget(self, live_scope) -> None:
        _status, body = live_scope.call(_ALL)

        assert (body['keywords_analyzed'], body['keyword_trends_total'], body['keywords_truncated']) == (_LIVE_MAX, _LIVE_MAX, False)

    def test_reports_complete_live_coverage(self, live_scope) -> None:
        _status, body = live_scope.call(_ALL)

        assert (body['coverage']['complete'], body['source'], body['keyword_trends_next_token']) == (True, 'live', None)

    def test_says_partial_coverage_when_the_budget_cut_the_read(self, live_scope) -> None:
        with one_scope_worker(), window_read_budget(lambda: ticking_deadline(2)):
            _status, body = live_scope.call(_ALL)

        assert (body['keywords_truncated'], body['coverage']['complete']) == (True, False)

class TestSnapshot:
    @pytest.mark.parametrize(('days', 'period'), [('7', 'day'), ('30', 'week'), ('30', 'month')])
    def test_serves_the_body_the_live_path_computes(self, large, days, period) -> None:
        served, live = served_and_live(large, {**_ALL, 'days': days, 'period': period}, _stored(large.keywords), 'kpi_window_route')

        assert without(served, *_PAGING) == without(live, *_PAGING)

    def test_pages_join_into_the_live_keyword_trends(self, large) -> None:
        served, live = served_and_live(large, _ALL, _stored(large.keywords), 'kpi_window_route')
        with snapshot_store(_stored(large.keywords)):
            rows = drained(served, 'keyword_trends', 'keyword_trends_next_token', lambda token: large.call({**_ALL, 'view': 'keyword_trends', 'next_token': token})[1])

        assert rows == live['keyword_trends']

    def test_answers_202_for_days_that_are_not_a_preset(self, large) -> None:
        status, _body, job = from_build(large, _stored(large.keywords), {**_ALL, 'days': '45'})

        assert (status, job.call_args.args[0], job.call_args.args[1]['days']) == (202, 'trends', 45)

_SERVE_VIEW = artifact_registry.serve_view


@pytest.fixture
def overview_without_stored_recommendations(overview_handler, trends_handler) -> Any:
    """The overview of a large scope whose build holds the trends only (the live recommendations are stubbed empty)."""
    with (
        kpi_route(trends_handler, '/api/trends', scope_keywords(_LIVE_MAX + 50), frozen=_BUILT) as trends,
        kpi_route(overview_handler, '/api/reports/overview', trends.keywords) as route,
        patch.dict(overview_handler._sibling_cache, {'trends': trends_handler.trends_for_scope, 'recs': lambda _config, **_scope: []}),
    ):
        yield route


@pytest.fixture
def overview(overview_without_stored_recommendations) -> Any:
    """The overview of a large scope whose build also holds its (empty) recommendations, as the live stub."""
    def serve_view(name: str, artifacts: Any, params: Any) -> Any:
        return {'recommendations': []} if name == 'recommendations' else _SERVE_VIEW(name, artifacts, params)

    with patch.object(artifact_registry, 'serve_view', side_effect=serve_view):
        yield overview_without_stored_recommendations


class TestOverview:
    def test_ranks_the_top_movers_over_every_keyword_of_the_preset(self, overview, trends_handler) -> None:
        with snapshot_store(_stored(overview.keywords)):
            _status, served = overview.call(_ALL)
        with patch.object(trends_handler, 'kpi_window_route', return_value='live'):
            _status, live = overview.call(_ALL)

        assert (served['top_improving'], served['top_declining']) == (live['top_improving'], live['top_declining'])

    def test_carries_the_trend_scope_contract(self, overview) -> None:
        _status, body, _job = from_build(overview, _stored(overview.keywords), _ALL)

        assert (body['source'], body['as_of'], body['coverage']['keywords_total']) == ('snapshot', '2026-10-05T07:12:00Z', len(overview.keywords))

    def test_answers_202_under_its_own_route_while_the_trend_is_computed(self, overview) -> None:
        status, _body, job = from_build(overview, None, _ALL)

        assert (status, job.call_args.args[0]) == (202, 'reports-overview')

    def test_answers_202_from_the_recommendations_job_when_the_build_holds_none(self, overview_without_stored_recommendations) -> None:
        status, _body, job = from_build(overview_without_stored_recommendations, _stored(overview_without_stored_recommendations.keywords), _ALL)

        assert (status, job.call_args.args[0], job.call_args.args[1]) == (202, 'recommendations', {'limit': 3})
