"""Tests for get-group-kpi-history.py — GET /api/reports/group-kpis."""

from __future__ import annotations

import json
import logging
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from shared.cursors import encode_offset_cursor
from testing.search_results_fixtures import (
    PartitionReadFailure,
    active_keywords_table,
    report_dynamodb,
    search_result_row,
    search_results_table,
    sort_condition,
)
from testing.window_rows_fixtures import load_window_report, report_event, windowed_report

_mod = load_window_report('get-group-kpi-history.py', 'get_group_kpi_history_under_test')

ACTIVE_KEYWORDS = [
    {'id': 'k1', 'keyword': 'hotel sol spa', 'status': 'active', 'group_ids': {'sol'}},
    {'id': 'k2', 'keyword': 'hotel sol beach', 'status': 'active', 'group_ids': {'sol'}},
    {'id': 'k3', 'keyword': 'hotel mar views', 'status': 'active', 'group_ids': {'mar'}},
]

RUN = '2026-09-20T06:00:00.000000Z'


def _answer(keyword: str) -> dict[str, Any]:
    return search_result_row(
        keyword, 'openai', [{'name': 'Hotel Sol', 'classification': 'first_party', 'rank': 1, 'mention_count': 1}],
        timestamp=RUN, citations=['https://www.hotel-sol.com/spa'], metadata={'model': 'gpt-5.2'},
    )


# One answered keyword of the 'sol' group; its sibling 'hotel sol beach' has no rows.
SPA_ROWS = {'hotel sol spa': [_answer('hotel sol spa')]}


def _resource(search_rows: dict[str, Any], active: list[dict[str, Any]] = ACTIVE_KEYWORDS) -> tuple[MagicMock, MagicMock]:
    """A boto3 resource: the keywords table lists ``active``, search answers per keyword."""
    search_table = search_results_table(search_rows)
    return report_dynamodb(search_table, active_keywords_table(active)), search_table


def _call(
    params: dict[str, str] | None,
    search_rows: dict[str, Any] | None = None,
    brand_config: dict[str, Any] | None = None,
    active: list[dict[str, Any]] = ACTIVE_KEYWORDS,
) -> tuple[int, dict[str, Any]]:
    resource, _ = _resource(search_rows or {}, active)
    with windowed_report(_mod, resource, brand_config=brand_config or {}, since='2026-06-22T06:00:00.000000Z'):
        response = _mod.handler(report_event('/api/reports/group-kpis', params), None)
    return response['statusCode'], json.loads(response['body'])


class TestGroupKpiHistoryRoute:
    @pytest.fixture
    def spa_only_body(self) -> dict[str, Any]:
        return _call({'group_id': 'sol'}, SPA_ROWS)[1]

    def test_requires_a_scope(self):
        status, body = _call(None)

        assert (status, body['field']) == (400, 'keyword')

    def test_covers_the_active_keywords_of_the_group(self, spa_only_body):
        assert [entry['keyword'] for entry in spa_only_body['keywords']] == ['hotel sol beach', 'hotel sol spa']

    def test_answers_each_run_with_its_kpis(self):
        _, body = _call({'group_id': 'sol'}, {**SPA_ROWS, 'hotel sol beach': [_answer('hotel sol beach')]})

        run = body['runs'][0]
        assert (run['timestamp'], run['kpis']['mention_rate'], run['is_group_run'], run['models']) == (
            RUN, 100.0, True, {'openai': ['gpt-5.2']},
        )

    def test_measures_the_citation_kpis_against_the_owned_domains_of_the_brand_configuration(self):
        _, body = _call(
            {'group_id': 'sol'},
            SPA_ROWS,
            {'first_party_domains': ['hotel-sol.com']},
        )

        assert (body['citations_configured'], body['runs'][0]['kpis']['citation_rate']) == (True, 100.0)

    def test_leaves_the_citation_kpis_empty_without_owned_domains(self, spa_only_body):
        assert (spa_only_body['citations_configured'], spa_only_body['runs'][0]['kpis']['citation_rate']) == (False, None)

    def test_describes_the_window_and_the_rules(self):
        _, body = _call({'group_id': 'sol', 'days': '30'})

        assert {key: body[key] for key in ('days', 'since', 'group_run_min_coverage', 'keywords_truncated')} == {
            'days': 30,
            'since': '2026-06-22T06:00:00.000000Z',
            'group_run_min_coverage': 50.0,
            'keywords_truncated': False,
        }

    def test_echoes_the_scope(self):
        _, body = _call({'group_id': 'sol'})

        assert (body['scope']['kind'], body['scope']['keyword_count']) == ('group', 2)

    def test_defaults_to_ninety_days(self):
        _, body = _call({'group_id': 'sol'})

        assert body['days'] == 90

    @pytest.mark.parametrize('days', ['0', '366'])
    def test_refuses_a_window_outside_one_to_365_days(self, days):
        assert _call({'group_id': 'sol', 'days': days})[0] == 400

    @pytest.mark.parametrize('days', ['1', '365'])
    def test_accepts_a_window_of_one_to_365_days(self, days):
        assert _call({'group_id': 'sol', 'days': days})[1]['days'] == int(days)

    def test_answers_an_unexpected_failure_with_a_500(self):
        with patch.object(_mod, 'group_kpi_history_from_answers', side_effect=PartitionReadFailure('boom')):
            status, _ = _call({'group_id': 'sol'})

        assert status == 500

    def test_keeps_a_group_report_when_one_keyword_cannot_be_read(self, caplog):
        with caplog.at_level(logging.ERROR):
            status, body = _call({'group_id': 'sol'}, {
                **SPA_ROWS,
                'hotel sol beach': PartitionReadFailure('throttled'),
            })

        assert (status, body['runs'][0]['keywords_with_data']) == (200, 1)
        assert "Scoped report failed for 'hotel sol beach'" in [record.getMessage() for record in caplog.records]


class TestSummaryRead:
    def test_reads_each_keyword_from_the_window_start_newest_first(self):
        row = search_result_row('hotel sol spa', 'openai', [], timestamp=RUN)
        resource, search_table = _resource({'hotel sol spa': [row]})

        with windowed_report(_mod, resource, brand_config={}, since='2026-09-01T00:00:00.000000Z'):
            _mod.handler(report_event('/api/reports/group-kpis', {'group_id': 'sol'}), None)

        windows = [
            (sort_condition(call.kwargs), call.kwargs['ScanIndexForward'])
            for call in search_table.query.call_args_list
        ]
        assert windows == [(('>=', '2026-09-01T00:00:00.000000Z'), False)] * 2

    def test_caps_the_report_at_one_hundred_keywords(self):
        many = [{'id': f'k{i}', 'keyword': f'kw {i:03}', 'status': 'active', 'group_ids': {'big'}} for i in range(101)]

        _, body = _call({'group_id': 'big'}, active=many)

        assert (len(body['keywords']), body['keywords_truncated']) == (100, True)


RUN_2 = '2026-09-27T06:00:00.000000Z'

# Both keywords answered in RUN; in RUN_2 'hotel sol spa' loses the hotel.
TWO_RUNS = {
    'hotel sol spa': [_answer('hotel sol spa'), search_result_row('hotel sol spa', 'openai', [], timestamp=RUN_2)],
    'hotel sol beach': [_answer('hotel sol beach'), {**_answer('hotel sol beach'), 'timestamp': RUN_2, 'timestamp_provider': f'{RUN_2}#openai#default'}],
}


class TestSummaryView:
    def test_answers_the_summary_by_default(self):
        assert _call({'group_id': 'sol'}, TWO_RUNS)[1]['view'] == 'summary'

    def test_counts_the_drivers_of_a_compared_run_instead_of_listing_them(self):
        change = _call({'group_id': 'sol'}, TWO_RUNS)[1]['runs'][1]['change']

        assert ('drivers' in change, change['drivers_count']) == (False, 1)

    def test_holds_each_keywords_run_count_and_latest_run(self):
        entry = _call({'group_id': 'sol'}, TWO_RUNS)[1]['keywords'][1]

        assert (entry['keyword'], entry['runs_count'], entry['latest']['timestamp'], 'runs' in entry) == ('hotel sol spa', 2, RUN_2, False)

    def test_reports_a_window_read_whole(self):
        body = _call({'group_id': 'sol'}, TWO_RUNS)[1]

        assert (body['truncated_before'], body['runs_truncated']) == (None, False)


class TestKeywordsView:
    @pytest.fixture
    def detail_body(self) -> dict[str, Any]:
        return _call({'group_id': 'sol', 'view': 'keywords', 'detail_keyword': 'hotel sol spa'}, TWO_RUNS)[1]

    def test_answers_one_keywords_runs_for_detail_keyword(self, detail_body):
        assert [(entry['keyword'], [run['timestamp'] for run in entry['runs']]) for entry in detail_body['keywords']] == [('hotel sol spa', [RUN, RUN_2])]

    def test_has_no_next_page_for_detail_keyword(self, detail_body):
        assert detail_body['next_token'] is None

    def test_refuses_a_detail_keyword_outside_the_scope(self):
        status, body = _call({'group_id': 'sol', 'view': 'keywords', 'detail_keyword': 'hotel mar views'}, TWO_RUNS)

        assert (status, body['field']) == (400, 'detail_keyword')

    def test_pages_the_keywords_by_limit(self):
        _, first = _call({'group_id': 'sol', 'view': 'keywords', 'limit': '1'}, TWO_RUNS)
        _, second = _call({'group_id': 'sol', 'view': 'keywords', 'limit': '1', 'next_token': first['next_token']}, TWO_RUNS)

        assert ([entry['keyword'] for entry in first['keywords'] + second['keywords']], second['next_token']) == (
            ['hotel sol beach', 'hotel sol spa'], None,
        )

    @pytest.mark.parametrize('limit', ['0', '26'])
    def test_refuses_a_page_size_outside_one_to_25(self, limit):
        assert _call({'group_id': 'sol', 'view': 'keywords', 'limit': limit})[0] == 400


class TestDriversView:
    def test_lists_the_drivers_of_each_compared_run(self):
        _, body = _call({'group_id': 'sol', 'view': 'drivers'}, TWO_RUNS)

        assert [(change['timestamp'], change['previous_timestamp'], [driver['keyword'] for driver in change['drivers']]) for change in body['changes']] == [
            (RUN_2, RUN, ['hotel sol spa']),
        ]

    def test_leaves_out_the_base_run_from_run(self):
        _, body = _call({'group_id': 'sol', 'view': 'drivers', 'from_run': RUN_2}, TWO_RUNS)

        assert body['changes'] == []

    def test_echoes_the_slice(self):
        _, body = _call({'group_id': 'sol', 'view': 'drivers', 'from_run': RUN, 'to_run': RUN_2}, TWO_RUNS)

        assert (body['from_run'], body['to_run'], body['next_token']) == (RUN, RUN_2, None)

    def test_refuses_a_cursor_of_another_view(self):
        status, body = _call({'group_id': 'sol', 'view': 'drivers', 'next_token': encode_offset_cursor(1, 2) or ''}, TWO_RUNS)

        assert (status, body['field']) == (400, 'next_token')

    def test_refuses_an_unknown_view(self):
        assert _call({'group_id': 'sol', 'view': 'everything'})[0] == 400
