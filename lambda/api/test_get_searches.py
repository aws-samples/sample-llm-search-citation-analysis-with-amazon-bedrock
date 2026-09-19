"""
Characterization tests for get-searches.py (GET /api/searches).

The handler had no tests. These pin the three read shapes -- one keyword's
partition, one provider's ``ProviderIndex`` slice, and the unfiltered fan-out
over every configured provider -- plus the in-memory filters (provider,
persona), the newest-first ordering and the ``count`` / ``limit`` contract.

The SearchResults table is a ``MagicMock`` from ``testing.dynamodb_stubs``;
tests swap it in for the module-level ``table`` the handler queries.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Any
from unittest.mock import MagicMock, patch

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from shared.config import PROVIDERS
from testing.dynamodb_stubs import fake_table
from testing.events import api_gateway_event, parse_response
from testing.handler_fixtures import handler_fixture

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


def _row(provider: str, timestamp: str, **fields: Any) -> dict[str, Any]:
    """One SearchResults row for ``_KEYWORD``: what ``provider`` answered at ``timestamp``."""
    return {'keyword': _KEYWORD, 'provider': provider, 'timestamp': timestamp, **fields}


def _throttled() -> ClientError:
    return ClientError({'Error': {'Code': 'ProvisionedThroughputExceededException', 'Message': 'throttled'}}, 'Query')


def _fan_out_table(answers: Mapping[str, Any]) -> MagicMock:
    """A table answering the unfiltered per-provider queries, in ``PROVIDERS`` order.

    ``answers`` maps a provider to its query response, or to an exception to
    raise; providers left out answer an empty page.
    """
    table = MagicMock()
    table.query.side_effect = [answers.get(provider, {'Items': []}) for provider in PROVIDERS]
    return table


def _get_searches(module: Any, table: MagicMock, query: Mapping[str, str] | None = None) -> tuple[int, Any]:
    """GET /api/searches with ``query`` against ``table``: ``(status, decoded body)``."""
    event = api_gateway_event('GET', '/api/searches', query=query)
    with patch.object(module, 'table', table):
        return parse_response(module.handler(event, None))


class TestKeywordReads:
    def test_queries_the_keyword_partition_newest_first_up_to_the_limit(self, searches_module):
        table = fake_table(query={'Items': []})

        _get_searches(searches_module, table, {'keyword': _KEYWORD, 'limit': '2'})

        table.query.assert_called_once_with(
            KeyConditionExpression=Key('keyword').eq(_KEYWORD), ScanIndexForward=False, Limit=2
        )

    def test_returns_the_keyword_rows_newest_first_with_their_count(self, searches_module):
        older, newer = _row('openai', _OLDER), _row('gemini', _LATEST)
        table = fake_table(query={'Items': [older, newer]})

        status, body = _get_searches(searches_module, table, {'keyword': _KEYWORD})

        assert (status, body) == (200, {'searches': [newer, older], 'count': 2})

    def test_keeps_only_the_named_providers_rows_matched_case_insensitively(self, searches_module):
        table = fake_table(query={'Items': [_row('openai', _LATEST), _row('gemini', _OLDER)]})

        _, body = _get_searches(searches_module, table, {'keyword': _KEYWORD, 'provider': 'Gemini'})

        assert body == {'searches': [_row('gemini', _OLDER)], 'count': 1}


class TestProviderReads:
    def test_queries_the_provider_index_with_the_lowercased_provider(self, searches_module):
        table = fake_table(query={'Items': []})

        _get_searches(searches_module, table, {'provider': 'OpenAI', 'limit': '3'})

        table.query.assert_called_once_with(
            IndexName='ProviderIndex', KeyConditionExpression=Key('provider').eq('openai'), ScanIndexForward=False, Limit=3
        )

    def test_returns_the_providers_rows_newest_first(self, searches_module):
        older, newer = _row('openai', _OLDER), _row('openai', _LATEST)
        table = fake_table(query={'Items': [older, newer]})

        _, body = _get_searches(searches_module, table, {'provider': 'openai'})

        assert body == {'searches': [newer, older], 'count': 2}


class TestUnfilteredFanOut:
    def test_queries_the_provider_index_once_per_configured_provider(self, searches_module):
        table = _fan_out_table({})

        _get_searches(searches_module, table)

        assert [call.kwargs['IndexName'] for call in table.query.call_args_list] == ['ProviderIndex'] * len(PROVIDERS)
        assert [call.kwargs['KeyConditionExpression'] for call in table.query.call_args_list] == [
            Key('provider').eq(provider) for provider in PROVIDERS
        ]

    def test_spreads_the_default_limit_of_five_hundred_across_the_providers(self, searches_module):
        table = _fan_out_table({})

        _get_searches(searches_module, table)

        assert {call.kwargs['Limit'] for call in table.query.call_args_list} == {500 // len(PROVIDERS)}

    def test_reads_at_least_fifty_rows_per_provider_when_the_limit_is_small(self, searches_module):
        table = _fan_out_table({})

        _get_searches(searches_module, table, {'limit': '100'})

        assert {call.kwargs['Limit'] for call in table.query.call_args_list} == {50}

    def test_merges_every_providers_rows_newest_first(self, searches_module):
        openai_row, gemini_row = _row('openai', _OLDER), _row('gemini', _LATEST)
        table = _fan_out_table({'openai': {'Items': [openai_row]}, 'gemini': {'Items': [gemini_row]}})

        _, body = _get_searches(searches_module, table)

        assert body == {'searches': [gemini_row, openai_row], 'count': 2}

    def test_skips_a_provider_whose_query_fails_and_returns_the_others(self, searches_module):
        gemini_row = _row('gemini', _LATEST)
        table = _fan_out_table({'openai': _throttled(), 'gemini': {'Items': [gemini_row]}})

        status, body = _get_searches(searches_module, table)

        assert (status, body) == (200, {'searches': [gemini_row], 'count': 1})

    def test_truncates_the_merged_rows_to_the_limit_while_counting_them_all(self, searches_module):
        openai_row, gemini_row = _row('openai', _OLDER), _row('gemini', _LATEST)
        table = _fan_out_table({'openai': {'Items': [openai_row]}, 'gemini': {'Items': [gemini_row]}})

        _, body = _get_searches(searches_module, table, {'limit': '1'})

        assert body == {'searches': [gemini_row], 'count': 2}


class TestPersonaFilter:
    def test_keeps_only_the_rows_of_the_requested_persona(self, searches_module):
        rows = [_row('openai', _LATEST, query_prompt_id='traveller'), _row('gemini', _OLDER, query_prompt_id='planner')]
        table = fake_table(query={'Items': rows})

        _, body = _get_searches(searches_module, table, {'keyword': _KEYWORD, 'query_prompt_id': 'planner'})

        assert body == {'searches': [rows[1]], 'count': 1}

    def test_treats_rows_without_a_persona_as_the_default_persona(self, searches_module):
        unlabelled, labelled = _row('openai', _LATEST), _row('gemini', _OLDER, query_prompt_id='planner')
        table = fake_table(query={'Items': [unlabelled, labelled]})

        _, body = _get_searches(searches_module, table, {'keyword': _KEYWORD, 'query_prompt_id': 'default'})

        assert body == {'searches': [unlabelled], 'count': 1}


class TestValidation:
    def test_rejects_a_limit_above_one_thousand_with_400_before_reading(self, searches_module):
        table = fake_table(query={'Items': []})

        status, body = _get_searches(searches_module, table, {'limit': '1001'})

        assert (status, body) == (400, {'error': 'limit must be at most 1000', 'field': 'limit'})
        table.query.assert_not_called()

    def test_rejects_a_keyword_over_five_hundred_characters_with_400(self, searches_module):
        status, body = _get_searches(searches_module, fake_table(), {'keyword': 'k' * 501})

        assert (status, body) == (400, {'error': 'keyword too long (max 500 characters)', 'field': 'keyword'})
