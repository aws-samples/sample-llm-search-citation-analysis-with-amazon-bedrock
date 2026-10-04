"""Tests for get-group-kpi-history.py — GET /api/reports/group-kpis."""

from __future__ import annotations

import json
import logging
import os
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from testing.module_loader import load_handler_module
from testing.report_scope_fixtures import REPORT_TABLES_ENV
from testing.search_results_fixtures import (
    PartitionReadFailure,
    active_keywords_table,
    report_dynamodb,
    search_result_row,
    search_results_table,
)

_HERE = os.path.dirname(os.path.abspath(__file__))

with patch('boto3.resource', MagicMock()), patch.dict(os.environ, REPORT_TABLES_ENV):
    _mod = load_handler_module(_HERE, 'get-group-kpi-history.py', 'get_group_kpi_history_under_test')

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
    event = {'httpMethod': 'GET', 'path': '/api/reports/group-kpis', 'queryStringParameters': params, 'headers': {}}
    with (
        patch.object(_mod, 'dynamodb', resource),
        patch.object(_mod, 'get_brand_config', return_value=brand_config if brand_config is not None else {}),
        patch.object(_mod, 'history_since', return_value='2026-06-22T06:00:00.000000Z'),
    ):
        response = _mod.handler(event, None)
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
        with patch.object(_mod, 'build_group_kpi_history', side_effect=PartitionReadFailure('boom')):
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


class TestLoadRows:
    def test_reads_each_keyword_from_the_window_start(self):
        row = search_result_row('a', 'openai', [], timestamp=RUN)
        resource, search_table = _resource({'a': [row]})

        with patch.object(_mod, 'dynamodb', resource):
            rows = _mod.load_rows(['a', 'b'], '2026-09-01T00:00:00.000000Z')

        windows = [call.kwargs['KeyConditionExpression'].get_expression()['values'][1].get_expression()['values'][1] for call in search_table.query.call_args_list]
        assert (rows, windows) == ({'a': [row], 'b': []}, ['2026-09-01T00:00:00.000000Z'] * 2)

    def test_reads_nothing_for_no_keywords(self):
        assert _mod.load_rows([], '2026-09-01T00:00:00.000000Z') == {}

    def test_caps_the_report_at_one_hundred_keywords(self):
        many = [{'id': f'k{i}', 'keyword': f'kw {i:03}', 'status': 'active', 'group_ids': {'big'}} for i in range(101)]

        _, body = _call({'group_id': 'big'}, active=many)

        assert (len(body['keywords']), body['keywords_truncated']) == (100, True)
