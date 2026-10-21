"""
Volume tests for get-searches.py (GET /api/searches).

Before pagination, the dashboard's unfiltered request read 50 rows from each
of the ten providers and returned up to 500 whole rows; a row carries the full
answer text (10-15 KB, Spanish), so the response was an estimated 5-9 MB, past
the 6 MiB Lambda cap. These tests feed that data set through
``PagedTable`` (which pages like DynamoDB) and pin that every page stays
within the page budget and that following ``next_token`` returns every row
exactly once, newest first.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import patch

import pytest

from shared.config import PROVIDERS
from testing.events import api_gateway_event, parse_response
from testing.paging import INVALID_NEXT_TOKEN, follow_next_token
from testing.partition_tables import PagedTable
from testing.response_size import assert_within_page_budget, long_text, response_bytes
from testing.searches_fixtures import SEARCH_RESULTS_INDEXES, searches_handler

searches_module = searches_handler('get_searches_volume_under_test')

_KEYWORD = 'hoteles con encanto en galicia'
_ROWS_PER_PROVIDER = 60
_ANSWER = long_text(12_000)
_START = datetime(2026, 9, 1, tzinfo=UTC)


def _row(provider_index: int, run: int) -> dict[str, Any]:
    provider = PROVIDERS[provider_index]
    timestamp = (_START + timedelta(minutes=run, seconds=provider_index)).isoformat()
    keyword = _KEYWORD if run % 2 == 0 else f'{_KEYWORD} {run}'
    return {
        'keyword': keyword, 'timestamp_provider': f'{timestamp}#{provider}#default', 'timestamp': timestamp,
        'provider': provider, 'provider_type': 'llm', 'query_prompt_id': 'default', 'status': 'success',
        'response': _ANSWER, 'citations': [f'https://ejemplo.es/guía/{run}/{index}' for index in range(8)],
        'brands': [{'name': 'Parador', 'context': _ANSWER[:400]}], 'brand_count': 1,
    }


_ROWS = [_row(provider_index, run) for provider_index in range(len(PROVIDERS)) for run in range(_ROWS_PER_PROVIDER)]


def _newest_first(rows: list[dict[str, Any]]) -> list[str]:
    return [row['timestamp_provider'] for row in sorted(rows, key=lambda row: row['timestamp'], reverse=True)]


def _get(module: Any, query: dict[str, str], max_page_rows: int | None = None) -> tuple[dict[str, Any], tuple[int, Any]]:
    """The raw proxy response and its decoded ``(status, body)``; ``max_page_rows`` stands for DynamoDB's 1 MB cut."""
    table = PagedTable([dict(row) for row in _ROWS], SEARCH_RESULTS_INDEXES, max_page_rows=max_page_rows)
    with patch.object(module, 'table', table):
        response = module.handler(api_gateway_event('GET', '/api/searches', query=query), None)
    return response, parse_response(response)


def _follow(module: Any, query: dict[str, str], max_page_rows: int | None = None) -> list[str]:
    """Every row's sort key over every page, in page order."""
    return follow_next_token(
        lambda page_query: _get(module, page_query, max_page_rows)[0],
        query,
        lambda body: [row['timestamp_provider'] for row in body['searches']],
        max_pages=len(_ROWS) + 1, within_page_budget=True,
    )


def test_old_shape_of_the_data_set_was_past_the_lambda_cap():
    whole_rows = sorted(_ROWS, key=lambda row: row['timestamp'], reverse=True)[:500]

    assert response_bytes({'body': whole_rows}) > 6 * 1024 * 1024


def test_stays_within_page_budget_when_the_dashboard_lists_every_provider(searches_module):
    response, _ = _get(searches_module, {'limit': '500'})

    assert_within_page_budget(response)


def test_stays_within_page_budget_when_whole_rows_of_one_keyword_are_asked_for(searches_module):
    response, _ = _get(searches_module, {'keyword': _KEYWORD, 'include_response': 'true', 'limit': '500'})

    assert_within_page_budget(response)


def test_stays_within_page_budget_when_whole_rows_of_every_provider_are_asked_for(searches_module):
    response, _ = _get(searches_module, {'include_response': 'true', 'limit': '500'})

    assert_within_page_budget(response)


@pytest.mark.parametrize('limit', ['7', '50', '500'])
def test_following_next_token_returns_every_row_once_newest_first_across_providers(searches_module, limit):
    assert _follow(searches_module, {'limit': limit, 'include_response': 'true'}) == _newest_first(_ROWS)


def test_following_next_token_keeps_the_order_when_dynamodb_cuts_provider_pages_short(searches_module):
    assert _follow(searches_module, {'limit': '50'}, max_page_rows=4) == _newest_first(_ROWS)


@pytest.mark.parametrize('limit', ['3', '500'])
def test_following_next_token_returns_every_row_of_a_keyword_once_newest_first(searches_module, limit):
    keyword_rows = [row for row in _ROWS if row['keyword'] == _KEYWORD]
    expected = sorted((row['timestamp_provider'] for row in keyword_rows), reverse=True)

    assert _follow(searches_module, {'keyword': _KEYWORD, 'limit': limit, 'include_response': 'true'}) == expected


@pytest.mark.parametrize('query', [{}, {'keyword': _KEYWORD}, {'provider': 'openai'}], ids=['merged', 'keyword', 'provider'])
def test_rejects_a_malformed_next_token_with_400(searches_module, query):
    _, (status, body) = _get(searches_module, {**query, 'next_token': 'not-a-token'})

    assert (status, body) == INVALID_NEXT_TOKEN
