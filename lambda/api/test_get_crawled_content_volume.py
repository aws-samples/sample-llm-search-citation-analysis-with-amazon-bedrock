"""
Volume tests for get-crawled-content.py (GET /api/crawled-content).

A crawled row carries up to 50,000 characters of page text. Before the page
budget, ``keyword=`` returned ``limit`` (up to 500) whole rows in one
response: for a keyword with 200 crawled Spanish pages that was an estimated
12 MB (each row about 60 KB once JSON-escaped), past the 6 MiB Lambda cap.
These tests feed that data set through ``PagedTable`` and pin that every page
stays within the budget and that ``next_token`` hands out every row once.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from testing.dynamodb_stubs import fake_dynamodb_resource
from testing.events import api_gateway_event, parse_response
from testing.handler_fixtures import handler_fixture
from testing.partition_tables import PagedTable
from testing.response_size import assert_within_page_budget, long_text, response_bytes

_API_DIR = os.path.dirname(os.path.abspath(__file__))

crawled_content_module = handler_fixture(
    _API_DIR,
    'get-crawled-content.py',
    'get_crawled_content_volume_under_test',
    env={'DYNAMODB_TABLE_CRAWLED_CONTENT': 'test-crawled-content'},
)

_KEYWORD = 'hotel coruña'
_URL = 'https://ejemplo.es/hoteles/coruña'
_PAGE_TEXT = long_text(50_000)
_INDEXES = {None: ('normalized_url', 'crawled_at'), 'KeywordIndex': ('keyword', 'crawled_at')}
_START = datetime(2026, 9, 1, tzinfo=UTC)


def _crawl(index: int) -> dict[str, Any]:
    return {
        'normalized_url': _URL if index % 4 == 0 else f'https://ejemplo.es/página/{index}',
        'crawled_at': (_START + timedelta(hours=index)).isoformat(),
        'keyword': _KEYWORD, 'title': f'Guía {index}', 'summary': _PAGE_TEXT[:600],
        'content': _PAGE_TEXT, 'content_length': len(_PAGE_TEXT), 'status': 'success',
    }


_ROWS = [_crawl(index) for index in range(200)]


def _get(module: Any, query: dict[str, str]) -> tuple[dict[str, Any], tuple[int, Any]]:
    table = PagedTable([dict(row) for row in _ROWS], _INDEXES)
    event = api_gateway_event('GET', '/api/crawled-content', query={**query, 'include_screenshot_url': 'false'})
    with patch.object(module, 'dynamodb', fake_dynamodb_resource(MagicMock(wraps=table))):
        response = module.handler(event, None)
    return response, parse_response(response)


def _follow(module: Any, query: dict[str, str]) -> list[str]:
    stamps: list[str] = []
    token: str | None = None
    for _ in range(len(_ROWS) + 1):
        response, (status, body) = _get(module, {**query, **({'next_token': token} if token else {})})
        assert status == 200
        assert_within_page_budget(response)
        stamps += [row['crawled_at'] for row in body['items']]
        token = body['next_token']
        if token is None:
            return stamps
    raise AssertionError('next_token never ran out')


def test_old_shape_of_the_data_set_was_past_the_lambda_cap():
    assert response_bytes({'body': {'items': _ROWS}}) > 6 * 1024 * 1024


def test_stays_within_page_budget_when_a_keyword_has_hundreds_of_long_crawls(crawled_content_module):
    response, _ = _get(crawled_content_module, {'keyword': _KEYWORD, 'limit': '500'})

    assert_within_page_budget(response)


def test_stays_within_page_budget_when_a_url_history_is_asked_for(crawled_content_module):
    response, _ = _get(crawled_content_module, {'url': _URL, 'include_history': 'true', 'limit': '500'})

    assert_within_page_budget(response)


def test_returns_the_whole_history_on_one_page_without_the_page_text(crawled_content_module):
    _, (_, body) = _get(crawled_content_module, {'url': _URL, 'include_history': 'true', 'include_content': 'false'})

    assert (body['count'], body['next_token']) == (50, None)


@pytest.mark.parametrize('query', [
    pytest.param({'keyword': _KEYWORD, 'limit': '500'}, id='keyword'),
    pytest.param({'keyword': _KEYWORD, 'limit': '7'}, id='keyword-small-pages'),
    pytest.param({'url': _URL, 'include_history': 'true'}, id='url-history'),
])
def test_following_next_token_returns_every_crawl_once_newest_first(crawled_content_module, query):
    expected = sorted(
        (row['crawled_at'] for row in _ROWS if 'url' not in query or row['normalized_url'] == _URL), reverse=True,
    )

    assert _follow(crawled_content_module, query) == expected


def test_following_next_token_over_the_unfiltered_scan_returns_every_crawl_once(crawled_content_module):
    assert sorted(_follow(crawled_content_module, {'limit': '500'})) == sorted(row['crawled_at'] for row in _ROWS)


@pytest.mark.parametrize('query', [{'keyword': _KEYWORD}, {'url': _URL, 'include_history': 'true'}], ids=['keyword', 'url'])
def test_rejects_a_malformed_next_token_with_400(crawled_content_module, query):
    _, (status, body) = _get(crawled_content_module, {**query, 'next_token': 'bm90LWEtdG9rZW4'})

    assert (status, body) == (400, {'error': 'Invalid next_token', 'field': 'next_token'})
