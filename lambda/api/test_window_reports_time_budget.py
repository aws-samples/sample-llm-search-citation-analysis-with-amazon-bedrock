"""The windowed reports answer 200 with what they read when the request's time budget runs out.

``/trends``, ``/reports/overview``, ``/reports/group-kpis`` and
``/reports/insights`` read through ``shared.scoped_reports``, which stops at
the deadline ``@api_handler`` starts (``shared.request_deadline``). A spent
budget (``spent_request_budget``: the request begins with no time left) or a
window read stopped mid-keyword (``window_read_budget``) must still answer
200, with the truncation field each route already has set.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from shared.cursors import decode_offset_cursor
from testing.events import parse_response
from testing.search_results_fixtures import active_keywords_table, report_dynamodb
from testing.window_budget_fixtures import one_scope_worker, spent_request_budget, ticking_deadline, window_read_budget
from testing.window_rows_fixtures import (
    load_window_report,
    overview_with_trends,
    paged_search_results_table,
    report_event,
    run_timestamp,
    volume_group,
    windowed_report,
)

_trends = load_window_report('get-historical-trends.py', 'get_historical_trends_budget_under_test')
_overview = load_window_report('get-reports-overview.py', 'get_reports_overview_budget_under_test')
_group_kpis = load_window_report('get-group-kpi-history.py', 'get_group_kpi_history_budget_under_test')
_insights = load_window_report('get-reports-insights.py', 'get_reports_insights_budget_under_test')

RUN_COUNT = 6
ANSWERS_PER_RUN = 4
GROUP = volume_group(3, RUN_COUNT, ANSWERS_PER_RUN)
BRAND_CONFIG = {'first_party_domains': ['hotel-coruna-mar.es']}
RECOMMENDATION = {'type': 'gap', 'priority': 'high', 'title': 'Top rec', 'description': 'd', 'action': 'a', 'impact': 'i'}


def _resource(page_size: int = 400) -> MagicMock:
    return report_dynamodb(paged_search_results_table(GROUP.rows, page_size=page_size), active_keywords_table(GROUP.active))


def _call(module: Any, path: str, query: Mapping[str, str], page_size: int = 400) -> tuple[int, dict[str, Any]]:
    """``(status, body)`` of ``GET path?query`` on ``module`` over the group's window."""
    with (
        windowed_report(module, _resource(page_size), brand_config=BRAND_CONFIG),
        patch.object(module, 'load_narrative', return_value=None, create=True),
    ):
        return parse_response(module.handler(report_event(path, dict(query)), None))


def _overview_call() -> tuple[int, dict[str, Any]]:
    """``(status, body)`` of the group's overview with the real trend view and one stubbed recommendation."""
    with overview_with_trends(_overview, _trends, _resource(), brand_config=BRAND_CONFIG, recommendations=[RECOMMENDATION]):
        return parse_response(_overview.handler(report_event('/api/reports/overview', {'group_id': 'coruna'}), None))


@pytest.fixture
def spent() -> Any:
    with spent_request_budget():
        yield


@pytest.mark.parametrize(('module', 'path'), [
    pytest.param(_trends, '/api/trends', id='trends'),
    pytest.param(_insights, '/api/reports/insights', id='insights'),
])
def test_answers_200_without_the_unread_keywords_when_the_budget_is_spent(spent, module, path) -> None:
    status, body = _call(module, path, {'group_id': 'coruna'})

    assert (status, body['keywords_truncated'], body['keywords_analyzed']) == (200, True, 0)


class TestTrends:
    def test_keeps_the_newest_runs_of_a_keyword_the_budget_stops_mid_read(self) -> None:
        # Checks: the keyword's start, then after its first page of 5 rows (the newest run and one row of the one before).
        with window_read_budget(lambda: ticking_deadline(2)):
            status, body = _call(_trends, '/api/trends', {'keyword': GROUP.keywords[0]}, page_size=5)

        assert (status, body['truncated_before'], [point['period'] for point in body['trend_data']]) == (
            200, run_timestamp(RUN_COUNT - 2), [run_timestamp(RUN_COUNT - 1)[:10]],
        )

    def test_reads_the_whole_window_within_the_budget(self) -> None:
        _status, body = _call(_trends, '/api/trends', {'group_id': 'coruna'})

        assert (body['truncated_before'], body['keywords_truncated'], body['keywords_analyzed']) == (None, False, 3)


class TestOverview:
    def test_answers_200_without_recommendations_when_the_budget_is_spent(self, spent) -> None:
        status, body = _overview_call()

        assert (status, body['truncated'], body['top_recommendations'], body['keywords_truncated']) == (200, True, [], True)

    def test_carries_the_recommendations_within_the_budget(self) -> None:
        _status, body = _overview_call()

        assert (body['truncated'], body['top_recommendations'], body['keywords_truncated']) == (False, [RECOMMENDATION], False)


class TestGroupKpis:
    def test_summary_answers_200_without_the_unread_keywords_when_the_budget_is_spent(self, spent) -> None:
        status, body = _call(_group_kpis, '/api/reports/group-kpis', {'group_id': 'coruna'})

        assert (status, body['keywords_truncated'], body['keywords']) == (200, True, [])

    def test_summary_reads_every_keyword_within_the_budget(self) -> None:
        _status, body = _call(_group_kpis, '/api/reports/group-kpis', {'group_id': 'coruna'})

        assert (body['keywords_truncated'], len(body['keywords']), len(body['runs'])) == (False, 3, RUN_COUNT)

    def test_drivers_answer_200_flagged_when_the_budget_is_spent(self, spent) -> None:
        status, body = _call(_group_kpis, '/api/reports/group-kpis', {'group_id': 'coruna', 'view': 'drivers'})

        assert (status, body['keywords_truncated'], body['changes']) == (200, True, [])

    def test_keyword_page_stops_before_the_first_keyword_the_budget_left_unread(self) -> None:
        # Checks: the first keyword's start (one page), then the second keyword's start finds the budget spent.
        with one_scope_worker(), window_read_budget(lambda: ticking_deadline(2)):
            _status, body = _call(_group_kpis, '/api/reports/group-kpis', {'group_id': 'coruna', 'view': 'keywords'})

        assert ([entry['keyword'] for entry in body['keywords']], body['truncated'], decode_offset_cursor(body['next_token'])) == (
            [GROUP.keywords[0]], True, 1,
        )

    def test_keyword_page_is_not_truncated_within_the_budget(self) -> None:
        _status, body = _call(_group_kpis, '/api/reports/group-kpis', {'group_id': 'coruna', 'view': 'keywords'})

        assert (len(body['keywords']), body['truncated'], body['next_token']) == (3, False, None)


class TestInsights:
    def test_reads_every_keyword_within_the_budget(self) -> None:
        _status, body = _call(_insights, '/api/reports/insights', {'group_id': 'coruna'})

        assert (body['keywords_truncated'], body['keywords_analyzed'], body['history_truncated_before']) == (False, 3, None)
