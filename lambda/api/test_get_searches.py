"""
Tests for get-searches.py (GET /api/searches).

They pin the three read shapes -- one keyword's partition, one provider's
``ProviderIndex`` slice, and the unfiltered newest-first merge over every
configured provider -- plus the after-read filters (provider, persona), the
list projection without the answer text, and the ``next_token`` contract.

Call-shape tests use ``MagicMock`` tables; behaviour tests use
``testing.partition_tables.PagedTable``, which pages like DynamoDB.
"""

from __future__ import annotations

import os
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from boto3.dynamodb.conditions import Key

from shared.config import PROVIDERS
from shared.partition_pages import projection_params
from testing.client_errors import throttled
from testing.dynamodb_stubs import fake_table
from testing.events import api_gateway_event, parse_response
from testing.handler_fixtures import handler_fixture
from testing.partition_tables import PagedTable

_API_DIR = os.path.dirname(os.path.abspath(__file__))

searches_module = handler_fixture(
    _API_DIR,
    'get-searches.py',
    'get_searches_under_test',
    env={'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-search-results', 'CORS_ORIGIN_PARAM': ''},
)

_KEYWORD = 'best running shoes'
_OLDER = '2026-05-01T08:00:00Z'
_LATEST = '2026-05-02T08:00:00Z'
_INDEXES = {None: ('keyword', 'timestamp_provider'), 'ProviderIndex': ('provider', 'timestamp')}


def _row(provider: str, timestamp: str, keyword: str = _KEYWORD, **fields: Any) -> dict[str, Any]:
    """One SearchResults row: what ``provider`` answered for ``keyword`` at ``timestamp``."""
    persona = fields.get('query_prompt_id', 'default')
    return {
        'keyword': keyword, 'timestamp_provider': f'{timestamp}#{provider}#{persona}',
        'provider': provider, 'timestamp': timestamp, **fields,
    }


def _get_searches(module: Any, table: Any, query: dict[str, str] | None = None) -> tuple[int, Any]:
    """GET /api/searches with ``query`` against ``table``: ``(status, decoded body)``."""
    event = api_gateway_event('GET', '/api/searches', query=query)
    with patch.object(module, 'table', table):
        return parse_response(module.handler(event, None))


def _paged(*rows: dict[str, Any], **options: Any) -> PagedTable:
    return PagedTable(list(rows), _INDEXES, **options)


@pytest.fixture
def empty_table() -> MagicMock:
    return fake_table(query={'Items': []})


class TestKeywordReads:
    def test_queries_the_keyword_partition_newest_first_projected_up_to_the_limit(self, searches_module, empty_table):
        _get_searches(searches_module, empty_table, {'keyword': _KEYWORD, 'limit': '2'})

        empty_table.query.assert_called_once_with(
            KeyConditionExpression=Key('keyword').eq(_KEYWORD), ScanIndexForward=False, Limit=2,
            **projection_params(searches_module.LIST_ATTRIBUTES),
        )

    def test_reads_whole_rows_when_the_response_text_is_asked_for(self, searches_module, empty_table):
        _get_searches(searches_module, empty_table, {'keyword': _KEYWORD, 'include_response': 'true'})

        empty_table.query.assert_called_once_with(
            KeyConditionExpression=Key('keyword').eq(_KEYWORD), ScanIndexForward=False, Limit=50,
        )

    def test_returns_the_keyword_rows_newest_first_with_their_count(self, searches_module):
        older, newer = _row('openai', _OLDER), _row('gemini', _LATEST)

        status, body = _get_searches(searches_module, _paged(older, newer), {'keyword': _KEYWORD})

        assert (status, body) == (200, {'searches': [newer, older], 'count': 2, 'next_token': None})

    def test_leaves_the_answer_text_out_of_list_rows(self, searches_module):
        table = _paged(_row('openai', _LATEST, response='La respuesta completa', status='success'))

        _, body = _get_searches(searches_module, table, {'keyword': _KEYWORD})

        assert body['searches'] == [_row('openai', _LATEST, status='success')]

    def test_keeps_the_answer_text_when_it_is_asked_for(self, searches_module):
        row = _row('openai', _LATEST, response='La respuesta completa')

        _, body = _get_searches(searches_module, _paged(row), {'keyword': _KEYWORD, 'include_response': 'true'})

        assert body['searches'] == [row]

    def test_keeps_only_the_named_providers_rows_matched_case_insensitively(self, searches_module):
        table = _paged(_row('openai', _LATEST), _row('gemini', _OLDER))

        _, body = _get_searches(searches_module, table, {'keyword': _KEYWORD, 'provider': 'Gemini'})

        assert body['searches'] == [_row('gemini', _OLDER)]


class TestProviderReads:
    def test_queries_the_provider_index_with_the_lowercased_provider(self, searches_module, empty_table):
        _get_searches(searches_module, empty_table, {'provider': 'OpenAI', 'limit': '3'})

        empty_table.query.assert_called_once_with(
            IndexName='ProviderIndex', KeyConditionExpression=Key('provider').eq('openai'),
            ScanIndexForward=False, Limit=3, **projection_params(searches_module.LIST_ATTRIBUTES),
        )

    def test_returns_the_providers_rows_newest_first(self, searches_module):
        older, newer = _row('openai', _OLDER), _row('openai', _LATEST, keyword='hotel')

        _, body = _get_searches(searches_module, _paged(older, newer), {'provider': 'openai'})

        assert body['searches'] == [newer, older]


class TestUnfilteredMerge:
    def test_queries_the_provider_index_once_per_configured_provider(self, searches_module):
        table = MagicMock(wraps=_paged())

        _get_searches(searches_module, table)

        assert sorted(call.kwargs['KeyConditionExpression'].get_expression()['values'][1]
                      for call in table.query.call_args_list) == sorted(PROVIDERS)

    def test_reads_the_page_limit_from_every_provider(self, searches_module):
        table = MagicMock(wraps=_paged())

        _get_searches(searches_module, table, {'limit': '20'})

        assert {call.kwargs['Limit'] for call in table.query.call_args_list} == {20}

    def test_merges_every_providers_rows_newest_first(self, searches_module):
        older, newer = _row('openai', _OLDER), _row('gemini', _LATEST)

        _, body = _get_searches(searches_module, _paged(older, newer))

        assert body == {'searches': [newer, older], 'count': 2, 'next_token': None}

    def test_skips_a_provider_whose_query_fails_and_returns_the_others(self, searches_module):
        gemini_row = _row('gemini', _LATEST)
        table = _paged(_row('openai', _OLDER), gemini_row, failures={'openai': throttled()})

        status, body = _get_searches(searches_module, table)

        assert (status, body['searches']) == (200, [gemini_row])

    def test_retries_a_failed_provider_on_the_next_page(self, searches_module):
        table = _paged(_row('openai', _OLDER), _row('gemini', _LATEST), failures={'openai': throttled()})

        _, body = _get_searches(searches_module, table)

        assert body['next_token'] is not None

    def test_stops_at_the_limit_and_hands_out_a_token_for_the_rest(self, searches_module):
        older, newer = _row('openai', _OLDER), _row('gemini', _LATEST)
        table = _paged(older, newer)

        _, first = _get_searches(searches_module, table, {'limit': '1'})
        _, second = _get_searches(searches_module, table, {'limit': '1', 'next_token': first['next_token']})

        assert (first['searches'], second['searches'], second['next_token']) == ([newer], [older], None)


class TestPersonaFilter:
    def test_keeps_only_the_rows_of_the_requested_persona(self, searches_module):
        rows = [_row('openai', _LATEST, query_prompt_id='traveller'), _row('gemini', _OLDER, query_prompt_id='planner')]

        _, body = _get_searches(searches_module, _paged(*rows), {'keyword': _KEYWORD, 'query_prompt_id': 'planner'})

        assert body['searches'] == [rows[1]]

    def test_treats_rows_without_a_persona_as_the_default_persona(self, searches_module):
        unlabelled = _row('openai', _LATEST)
        labelled = _row('gemini', _OLDER, query_prompt_id='planner')

        _, body = _get_searches(searches_module, _paged(unlabelled, labelled), {'query_prompt_id': 'default'})

        assert body['searches'] == [unlabelled]


class TestValidation:
    def test_rejects_a_limit_above_five_hundred_with_400_before_reading(self, searches_module):
        table = fake_table(query={'Items': []})

        status, body = _get_searches(searches_module, table, {'limit': '501'})

        assert (status, body) == (400, {'error': 'limit must be at most 500', 'field': 'limit'})
        table.query.assert_not_called()

    def test_rejects_a_keyword_over_five_hundred_characters_with_400(self, searches_module):
        status, body = _get_searches(searches_module, fake_table(), {'keyword': 'k' * 501})

        assert (status, body) == (400, {'error': 'keyword too long (max 500 characters)', 'field': 'keyword'})
