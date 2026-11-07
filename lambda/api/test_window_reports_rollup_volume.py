"""Volume tests: a year of daily runs of a 100-keyword group, read from the per-run KPI rollups.

2.42.0 read every answer of the window: 100 keywords x 365 runs x 8 answers
= 292,000 SearchResults rows (~2.6 GB projected at the worst row shape), so a
365-day window was always cut (``truncated_before``). With one rollup row per
keyword run the same window is 36,500 small rows. These tests run the real
handlers over that table, inside the request's real time budget, and prove
the window is answered whole: no ``truncated_before``, no keyword skipped,
every run and answer counted, and no SearchResults row read.
"""

from __future__ import annotations

import json
from typing import Any

import pytest

from shared.keyword_run_kpis import BRANDS_PER_RUN, tally_item
from shared.kpi_engine import answers_from_rows
from shared.kpi_tally import run_tally
from testing.keyword_run_kpis_fixtures import ROLLUP_TABLE_NAME, as_stored, rollup_table, rollups_deployed
from testing.search_results_fixtures import active_keywords_table, report_dynamodb
from testing.window_rows_fixtures import (
    group_window_rows,
    load_window_report,
    paged_search_results_table,
    record_rows_read,
    report_event,
    run_timestamp,
    volume_keyword,
    windowed_report,
)

KEYWORD_COUNT = 100
RUN_COUNT = 365
ANSWERS_PER_RUN = 8
OWNED = ['hotel-coruna-mar.es']
#: Rollup rows a page: a 1 MB DynamoDB page holds about this many ~2.5 KB rows.
ROLLUP_PAGE = 400

_trends = load_window_report('get-historical-trends.py', 'get_historical_trends_rollup_volume_under_test')
_group_kpis = load_window_report('get-group-kpi-history.py', 'get_group_kpi_history_rollup_volume_under_test')


def _year_of_rollups() -> dict[str, list[dict[str, Any]]]:
    """Every keyword's rollup row of every daily run; the four position patterns of ``group_window_rows`` repeat."""
    sample = group_window_rows(KEYWORD_COUNT, 4, ANSWERS_PER_RUN)
    items: dict[str, list[dict[str, Any]]] = {}
    for index in range(KEYWORD_COUNT):
        keyword = volume_keyword(index)
        answers = answers_from_rows(sample[keyword])
        patterns = [
            as_stored(tally_item(run_tally(keyword, run_timestamp(run), [a for a in answers if a.timestamp == run_timestamp(run)], OWNED, brand_cap=BRANDS_PER_RUN)))
            for run in range(4)
        ]
        items[keyword] = [{**patterns[run % 4], 'run_timestamp': run_timestamp(run)} for run in range(RUN_COUNT)]
    return items


def _call(module: Any, path: str, params: dict[str, str]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """The decoded body of ``GET path`` over a year of rollups, and the SearchResults rows it read."""
    search = paged_search_results_table({})
    rows_read = record_rows_read(search)
    active = [{'id': f'k{index}', 'keyword': volume_keyword(index), 'status': 'active', 'group_ids': {'coruna'}} for index in range(KEYWORD_COUNT)]
    resource = report_dynamodb(search, active_keywords_table(active), {ROLLUP_TABLE_NAME: rollup_table(_year_of_rollups(), ROLLUP_PAGE)})
    with rollups_deployed(), windowed_report(module, resource, brand_config={'first_party_domains': OWNED}):
        response = module.handler(report_event(path, {'group_id': 'coruna', **params}), None)
    return json.loads(response['body']), rows_read


@pytest.fixture(scope='module')
def trends() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    return _call(_trends, '/api/trends', {'days': '365', 'period': 'day'})


@pytest.fixture(scope='module')
def group_kpis() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    return _call(_group_kpis, '/api/reports/group-kpis', {'days': '365'})


class TestTrendsOverAYearOfRollups:
    def test_reads_the_whole_year_within_the_request_budget(self, trends):
        body, _rows = trends

        assert (body['truncated_before'], body['keywords_truncated'], body['keywords_analyzed']) == (None, False, KEYWORD_COUNT)

    def test_has_one_point_per_daily_run(self, trends):
        assert [point['runs'] for point in trends[0]['trend_data']] == [1] * RUN_COUNT

    def test_counts_every_answer_of_every_keyword_in_each_point(self, trends):
        assert {point['kpis']['answers'] for point in trends[0]['trend_data']} == {KEYWORD_COUNT * ANSWERS_PER_RUN}

    def test_reads_no_search_results_row(self, trends):
        assert trends[1] == []


class TestGroupKpisOverAYearOfRollups:
    def test_reads_the_whole_year_within_the_request_budget(self, group_kpis):
        body, _rows = group_kpis

        assert (body['truncated_before'], body.get('keywords_truncated', False)) == (None, False)

    def test_lists_every_keywords_runs(self, group_kpis):
        assert {entry['runs_count'] for entry in group_kpis[0]['keywords']} == {RUN_COUNT}

    def test_every_group_run_pools_every_keywords_answers(self, group_kpis):
        assert {run['kpis']['answers'] for run in group_kpis[0]['runs']} == {KEYWORD_COUNT * ANSWERS_PER_RUN}

    def test_reads_no_search_results_row(self, group_kpis):
        assert group_kpis[1] == []
