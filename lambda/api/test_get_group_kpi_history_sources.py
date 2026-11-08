"""GET /api/reports/group-kpis over a scope larger than the live budget (2.45.0): summary and drivers from the presets, drill-down O(page).

The stored build is the ``group-kpis`` builder's fold of the same runs at a
frozen clock; each served view is compared with the live one (the oracle).
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from typing import Any

import pytest

from shared.artifact_group_kpis import GROUP_KPIS_BUILDER, group_kpis_artifacts
from shared.snapshot_artifacts import CURSOR_EXPIRED_CODE, KeywordCursor, encode_keyword_cursor
from testing.handler_fixtures import handler_fixture
from testing.kpi_route_fixtures import drained, from_build, kpi_route, served_and_live, window_build
from testing.kpi_scope_fixtures import JOB_ID, scope_keywords, snapshot_store, without
from testing.report_scope_fixtures import REPORT_TABLES_ENV

group_kpis_handler = handler_fixture(
    os.path.dirname(os.path.abspath(__file__)), 'get-group-kpi-history.py', 'get_group_kpi_history_sources_under_test', env=REPORT_TABLES_ENV,
)

_BUILT = datetime(2026, 10, 5, 7, 12, tzinfo=UTC)
_LARGE = 150
_SUMMARY = {'scope': 'all', 'days': '30'}
_DRILL_DOWN = {**_SUMMARY, 'view': 'keywords'}


@pytest.fixture
def large(group_kpis_handler) -> Any:
    with kpi_route(group_kpis_handler, '/api/reports/group-kpis', scope_keywords(_LARGE), frozen=_BUILT) as route:
        yield route


@pytest.fixture
def stored(large) -> Any:
    return window_build(large.keywords, GROUP_KPIS_BUILDER, group_kpis_artifacts, _BUILT)


@pytest.fixture
def summary(large, stored) -> tuple[dict[str, Any], dict[str, Any]]:
    return served_and_live(large, _SUMMARY, stored, 'kpi_window_route')


class TestSnapshotSummary:
    def test_serves_the_fields_the_live_path_computes(self, summary) -> None:
        served, live = summary

        assert without(served, 'keywords', 'keywords_next_token', 'coverage', 'source', 'as_of') == without(live, 'keywords', 'keywords_next_token', 'coverage', 'source', 'as_of')

    def test_pages_join_into_the_live_keyword_rows(self, large, stored, summary) -> None:
        served, live = summary
        with snapshot_store(stored):
            rows = drained(served, 'keywords', 'keywords_next_token', lambda token: large.call({**_DRILL_DOWN, 'next_token': token})[1])

        assert rows == live['keywords']

    def test_answers_202_for_days_that_are_not_a_preset(self, large, stored) -> None:
        status, body, job = from_build(large, stored, {'scope': 'all', 'days': '45'})

        assert (status, body['job']['id'], job.call_args.args[1]['days']) == (202, JOB_ID, 45)

class TestSnapshotDrivers:
    def test_serves_the_drivers_the_live_path_computes(self, large, stored) -> None:
        served, live = served_and_live(large, {**_SUMMARY, 'view': 'drivers'}, stored, 'kpi_window_route')

        assert without(served, 'coverage', 'source', 'as_of') == without(live, 'coverage', 'source', 'as_of')


class TestDrillDown:
    def test_reads_only_the_page_keywords_of_a_scope_over_the_budget(self, large) -> None:
        status, body, job = from_build(large, None, {**_DRILL_DOWN, 'limit': '5'})

        assert (status, len(body['keywords']), large.search.query.call_count, job.call_count) == (200, 5, 5, 0)

    def test_pages_cover_every_keyword_once_in_scope_order(self, large) -> None:
        query = {**_DRILL_DOWN, 'limit': '25'}
        _status, first = large.call(query)
        rows = drained(first, 'keywords', 'next_token', lambda token: large.call({**query, 'next_token': token})[1])

        assert [entry['keyword'] for entry in rows] == large.keywords

    def test_a_cursor_of_other_scope_keywords_is_cursor_expired(self, large) -> None:
        token = encode_keyword_cursor(KeywordCursor(keyword_index=25, row_offset=0, fingerprint='kwfp-gone'), _LARGE) or ''
        status, body = large.call({**_DRILL_DOWN, 'next_token': token})

        assert (status, body['code']) == (400, CURSOR_EXPIRED_CODE)
