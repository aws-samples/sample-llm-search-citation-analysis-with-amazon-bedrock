"""Tests for get-group-kpi-history.py — GET /api/reports/group-kpis."""

from __future__ import annotations

import json
import logging
import os
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from testing.module_loader import load_handler_module

_HERE = os.path.dirname(os.path.abspath(__file__))
_ENV = {
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-search-results',
    'DYNAMODB_TABLE_KEYWORDS': 'test-keywords',
    'CORS_ORIGIN_PARAM': '',
}

with patch('boto3.resource', MagicMock()), patch.dict(os.environ, _ENV):
    _mod = load_handler_module(_HERE, 'get-group-kpi-history.py', 'get_group_kpi_history_under_test')

ACTIVE_KEYWORDS = [
    {'id': 'k1', 'keyword': 'hotel sol spa', 'status': 'active', 'group_ids': {'sol'}},
    {'id': 'k2', 'keyword': 'hotel sol beach', 'status': 'active', 'group_ids': {'sol'}},
    {'id': 'k3', 'keyword': 'hotel mar views', 'status': 'active', 'group_ids': {'mar'}},
]

RUN = '2026-09-20T06:00:00.000000Z'


def _answer(keyword: str) -> dict[str, Any]:
    return {
        'keyword': keyword,
        'timestamp': RUN,
        'provider': 'openai',
        'query_prompt_id': 'default',
        'brands': [{'name': 'Hotel Sol', 'classification': 'first_party', 'rank': 1, 'mention_count': 1}],
        'citations': ['https://www.hotel-sol.com/spa'],
        'metadata': {'model': 'gpt-5.2'},
    }


class ReadFailure(Exception):
    """A SearchResults partition that cannot be read."""


def _resource(search_rows: dict[str, Any]) -> tuple[MagicMock, MagicMock]:
    """A boto3 resource: the keywords table lists ACTIVE_KEYWORDS, search answers per keyword."""
    keywords_table = MagicMock(name='keywords')
    keywords_table.query.return_value = {'Items': ACTIVE_KEYWORDS}

    def search_query(**kwargs: Any) -> dict[str, Any]:
        keyword = kwargs['KeyConditionExpression'].get_expression()['values'][0].get_expression()['values'][1]
        rows = search_rows.get(keyword, [])
        if isinstance(rows, Exception):
            raise rows
        return {'Items': rows}

    search_table = MagicMock(name='search')
    search_table.query.side_effect = search_query
    resource = MagicMock()
    resource.Table.side_effect = lambda name: {'test-keywords': keywords_table, 'test-search-results': search_table}[name]
    return resource, search_table


def _call(
    params: dict[str, str] | None,
    search_rows: dict[str, Any] | None = None,
    brand_config: dict[str, Any] | None = None,
) -> tuple[int, dict[str, Any]]:
    resource, _ = _resource(search_rows or {})
    event = {'httpMethod': 'GET', 'path': '/api/reports/group-kpis', 'queryStringParameters': params, 'headers': {}}
    with (
        patch.object(_mod, 'dynamodb', resource),
        patch.object(_mod, 'get_brand_config', return_value=brand_config if brand_config is not None else {}),
        patch.object(_mod, 'history_since', return_value='2026-06-22T06:00:00.000000Z'),
    ):
        response = _mod.handler(event, None)
    return response['statusCode'], json.loads(response['body'])


class TestHistorySince:
    def test_formats_the_window_start_like_run_timestamps(self):
        now = datetime(2026, 9, 28, 12, 30, 15, 123456, tzinfo=UTC)

        assert _mod.history_since(90, now) == '2026-06-30T12:30:15.123456Z'

    def test_defaults_to_the_current_time(self):
        assert _mod.history_since(0) <= datetime.now(UTC).strftime('%Y-%m-%dT%H:%M:%S.%fZ')


class TestGroupKpiHistoryRoute:
    def test_requires_a_scope(self):
        status, body = _call(None)

        assert (status, body['field']) == (400, 'keyword')

    def test_covers_the_active_keywords_of_the_group(self):
        _, body = _call({'group_id': 'sol'}, {'hotel sol spa': [_answer('hotel sol spa')]})

        assert [entry['keyword'] for entry in body['keywords']] == ['hotel sol beach', 'hotel sol spa']

    def test_answers_each_run_with_its_kpis(self):
        _, body = _call({'group_id': 'sol'}, {'hotel sol spa': [_answer('hotel sol spa')], 'hotel sol beach': [_answer('hotel sol beach')]})

        run = body['runs'][0]
        assert (run['timestamp'], run['kpis']['mention_rate'], run['is_group_run'], run['models']) == (
            RUN, 100.0, True, {'openai': ['gpt-5.2']},
        )

    def test_measures_the_citation_kpis_against_the_owned_domains_of_the_brand_configuration(self):
        _, body = _call(
            {'group_id': 'sol'},
            {'hotel sol spa': [_answer('hotel sol spa')]},
            {'first_party_domains': ['hotel-sol.com']},
        )

        assert (body['citations_configured'], body['runs'][0]['kpis']['citation_rate']) == (True, 100.0)

    def test_leaves_the_citation_kpis_empty_without_owned_domains(self):
        _, body = _call({'group_id': 'sol'}, {'hotel sol spa': [_answer('hotel sol spa')]})

        assert (body['citations_configured'], body['runs'][0]['kpis']['citation_rate']) == (False, None)

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
        with patch.object(_mod, 'build_group_kpi_history', side_effect=ReadFailure('boom')):
            status, _ = _call({'group_id': 'sol'})

        assert status == 500

    def test_keeps_a_group_report_when_one_keyword_cannot_be_read(self, caplog):
        with caplog.at_level(logging.ERROR):
            status, body = _call({'group_id': 'sol'}, {
                'hotel sol spa': [_answer('hotel sol spa')],
                'hotel sol beach': ReadFailure('throttled'),
            })

        assert (status, body['runs'][0]['keywords_with_data']) == (200, 1)
        assert "Scoped report failed for 'hotel sol beach'" in [record.getMessage() for record in caplog.records]


class TestLoadRows:
    def test_reads_each_keyword_from_the_window_start(self):
        resource, search_table = _resource({'a': [{'timestamp': RUN}]})

        with patch.object(_mod, 'dynamodb', resource):
            rows = _mod.load_rows(['a', 'b'], '2026-09-01T00:00:00.000000Z')

        windows = [call.kwargs['KeyConditionExpression'].get_expression()['values'][1].get_expression()['values'][1] for call in search_table.query.call_args_list]
        assert (rows, windows) == ({'a': [{'timestamp': RUN}], 'b': []}, ['2026-09-01T00:00:00.000000Z'] * 2)

    def test_reads_nothing_for_no_keywords(self):
        assert _mod.load_rows([], '2026-09-01T00:00:00.000000Z') == {}

    def test_caps_the_report_at_one_hundred_keywords(self):
        many = [{'id': f'k{i}', 'keyword': f'kw {i:03}', 'status': 'active', 'group_ids': {'big'}} for i in range(101)]
        keywords_table = MagicMock()
        keywords_table.query.return_value = {'Items': many}
        search_table = MagicMock()
        search_table.query.return_value = {'Items': []}
        resource = MagicMock()
        resource.Table.side_effect = lambda name: keywords_table if name == 'test-keywords' else search_table
        event = {'httpMethod': 'GET', 'path': '/api/reports/group-kpis', 'queryStringParameters': {'group_id': 'big'}, 'headers': {}}

        with (
            patch.object(_mod, 'dynamodb', resource),
            patch.object(_mod, 'get_brand_config', return_value={}),
        ):
            body = json.loads(_mod.handler(event, None)['body'])

        assert (len(body['keywords']), body['keywords_truncated']) == (100, True)
