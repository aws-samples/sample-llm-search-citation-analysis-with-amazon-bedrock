"""
Volume tests for get-citations.py (GET /api/citations), the customer's 502.

The route used to return every distinct URL of the scope with its full keyword
list. A 100-keyword group with 600 citations per keyword (60,000 Citations
rows, 30,000 distinct URLs) gave an estimated 8-18 MB response, past the
6 MiB Lambda cap. These tests read that data set through ``PagedTable``
(which pages like DynamoDB) and pin that every page stays within the page
budget, that following ``next_token`` returns every URL exactly once in order,
and that the per-keyword reads run in parallel under a shared page cap.
"""

from __future__ import annotations

import os
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from testing.dynamodb_stubs import fake_dynamodb_resource, fake_table
from testing.events import api_gateway_event, parse_response
from testing.handler_fixtures import handler_fixture
from testing.partition_tables import PagedTable
from testing.response_size import assert_within_page_budget, response_bytes

_API_DIR = os.path.dirname(os.path.abspath(__file__))

citations_module = handler_fixture(
    _API_DIR,
    'get-citations.py',
    'get_citations_volume_under_test',
    env={'DYNAMODB_TABLE_CITATIONS': 'test-citations', 'DYNAMODB_TABLE_KEYWORDS': 'test-keywords'},
)

_KEYWORD_COUNT = 100
_URLS_PER_KEYWORD = 600
_DISTINCT_URLS = 30_000
_GROUP = 'galicia'
_KEYWORDS = [f'hoteles con encanto en galicia número {index}' for index in range(_KEYWORD_COUNT)]
_ACTIVE = [{'id': f'k{index}', 'keyword': text, 'status': 'active', 'group_ids': {_GROUP}} for index, text in enumerate(_KEYWORDS)]


def _citation(keyword_index: int, slot: int) -> dict[str, Any]:
    url_index = (keyword_index * (_DISTINCT_URLS // _KEYWORD_COUNT) + slot) % _DISTINCT_URLS
    return {
        'keyword': _KEYWORDS[keyword_index],
        'normalized_url': f'https://guía-{url_index % 97}.ejemplo.es/artículo/{url_index}/reseñas',
        'citation_count': 1 + (url_index * 7 + keyword_index) % 13,
        'citing_providers': ['openai', 'perplexity', 'gemini', 'claude'][: 1 + url_index % 4],
        'content_type': 'video' if url_index % 10 == 0 else 'page',
    }


_ROWS = [_citation(keyword_index, slot) for keyword_index in range(_KEYWORD_COUNT) for slot in range(_URLS_PER_KEYWORD)]


@pytest.fixture(scope='module')
def citations_table() -> PagedTable:
    return PagedTable(_ROWS, {None: ('keyword', 'normalized_url')}, max_page_rows=2_000)


def _get(module: Any, table: Any, query: dict[str, str]) -> tuple[dict[str, Any], tuple[int, Any]]:
    resource = fake_dynamodb_resource(fake_table(query={'Items': []}), by_name={'test-keywords': fake_table(query={'Items': _ACTIVE})})
    with (
        patch.object(module, 'dynamodb', resource),
        patch.object(module, 'citations_table', table),
        patch.object(module, '_get_tracked_brands', return_value=[]),
    ):
        response = module.handler(api_gateway_event('GET', '/api/citations', query={'group_id': _GROUP, **query}), None)
    return response, parse_response(response)


def test_old_shape_of_the_data_set_was_past_the_lambda_cap(citations_module):
    url_data, _, _ = citations_module._aggregate_citations(_ROWS, [])

    assert response_bytes({'body': {'top_urls': citations_module._top_urls(url_data)}}) > 6 * 1024 * 1024


def test_stays_within_page_budget_when_a_group_has_thirty_thousand_urls(citations_module, citations_table):
    response, _ = _get(citations_module, citations_table, {'limit': '1000', 'include_keywords': 'true'})

    assert_within_page_budget(response)


def test_stays_within_page_budget_when_the_dashboard_asks_for_its_first_page(citations_module, citations_table):
    response, (_, body) = _get(citations_module, citations_table, {'limit': '25'})

    assert_within_page_budget(response, budget=50_000)
    assert body['total_urls'] == _DISTINCT_URLS


def test_following_next_token_returns_every_url_once_in_order(citations_module, citations_table):
    _, (_, first) = _get(citations_module, citations_table, {'limit': '1000', 'sort': 'domain', 'order': 'asc'})
    urls = [entry['url'] for entry in first['top_urls']]
    token = first['next_token']
    while token is not None:
        response, (_, body) = _get(citations_module, citations_table, {'limit': '1000', 'sort': 'domain', 'order': 'asc', 'next_token': token})
        assert_within_page_budget(response)
        urls += [entry['url'] for entry in body['top_urls']]
        token = body['next_token']

    domains = [url.split('/')[2] for url in urls]
    assert (len(urls), len(set(urls)), domains == sorted(domains)) == (_DISTINCT_URLS, _DISTINCT_URLS, True)


def test_reads_every_keyword_partition_of_the_group(citations_module, citations_table):
    table = MagicMock(wraps=citations_table)

    _get(citations_module, table, {'limit': '1'})

    queried = {call.kwargs['KeyConditionExpression'].get_expression()['values'][1] for call in table.query.call_args_list}
    assert queried == set(_KEYWORDS)


def test_reports_a_truncated_read_when_a_keyword_partition_passes_its_share_of_the_cap(citations_module):
    table = PagedTable(_ROWS, {None: ('keyword', 'normalized_url')}, max_page_rows=100)

    _, (_, body) = _get(citations_module, table, {'limit': '1'})

    assert (body['truncated'], body['total_citations']) == (True, _KEYWORD_COUNT * 100)
