"""Tests for the server-side sort, filters and pages of get-citations.py (``GET /api/citations``).

The table is a ``MagicMock`` answering one scan page; the brand config is
stubbed out. Totals cover the whole scope on every page, whatever the filters.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest

from shared.cursors import encode_offset_cursor
from testing.citations_fixtures import VIDEO_URL, citation_row, citations_handler
from testing.dynamodb_stubs import fake_table
from testing.events import api_gateway_event, parse_response

citations_module = citations_handler('get_citations_pages_under_test')


# a.example: 5 citations, 1 keyword; zeta.example: 3 citations, 2 keywords;
# m.example: 3 citations, 1 keyword; the video: 1 citation, 1 keyword.
_ROWS = [
    citation_row('https://a.example/guide', 'hotels', 5),
    citation_row('https://zeta.example/list', 'hotels', 2),
    citation_row('https://zeta.example/list', 'spa', 1),
    citation_row('https://m.example/page', 'spa', 3),
    citation_row(VIDEO_URL, 'spa', 1),
]


def _get(module, query: dict[str, str] | None = None) -> tuple[int, Any]:
    with (
        patch.object(module, 'citations_table', fake_table(scan={'Items': list(_ROWS)})),
        patch.object(module, '_get_tracked_brands', return_value=[]),
    ):
        return parse_response(module.handler(api_gateway_event('GET', '/api/citations', query=query), None))


def _urls(module, query: dict[str, str] | None = None) -> list[str]:
    _, body = _get(module, query)
    return [entry['url'] for entry in body['top_urls']]


class TestOrder:
    def test_lists_most_cited_first_then_most_keywords_by_default(self, citations_module):
        assert _urls(citations_module) == [
            'https://a.example/guide', 'https://zeta.example/list', 'https://m.example/page', VIDEO_URL,
        ]

    def test_lists_least_cited_first_keeping_the_base_order_of_ties(self, citations_module):
        assert _urls(citations_module, {'order': 'asc'}) == [
            VIDEO_URL, 'https://zeta.example/list', 'https://m.example/page', 'https://a.example/guide',
        ]

    def test_lists_most_keywords_first_when_sorting_by_keywords(self, citations_module):
        assert _urls(citations_module, {'sort': 'keywords'})[0] == 'https://zeta.example/list'

    def test_lists_domains_alphabetically_when_sorting_by_domain_ascending(self, citations_module):
        assert _urls(citations_module, {'sort': 'domain', 'order': 'asc'}) == [
            'https://a.example/guide', 'https://m.example/page', VIDEO_URL, 'https://zeta.example/list',
        ]


class TestFilters:
    def test_keeps_urls_containing_the_text_case_insensitively(self, citations_module):
        assert _urls(citations_module, {'url_contains': 'ZETA'}) == ['https://zeta.example/list']

    def test_keeps_urls_with_at_least_the_minimum_citations(self, citations_module):
        assert _urls(citations_module, {'min_citations': '3'}) == [
            'https://a.example/guide', 'https://zeta.example/list', 'https://m.example/page',
        ]

    def test_keeps_only_videos_when_filtering_by_content_type(self, citations_module):
        assert _urls(citations_module, {'content_type': 'video'}) == [VIDEO_URL]

    def test_counts_the_matching_urls_while_totals_cover_the_whole_scope(self, citations_module):
        _, body = _get(citations_module, {'content_type': 'video'})

        assert (body['matched_urls'], body['total_urls'], body['total_citation_count'], body['total_citations']) == (1, 4, 12, 5)


class TestPages:
    def test_returns_the_first_limit_urls_with_a_token_for_the_rest(self, citations_module):
        _, body = _get(citations_module, {'limit': '2'})

        assert (len(body['top_urls']), body['next_token']) == (2, encode_offset_cursor(2, 4))

    def test_returns_the_page_the_token_points_at(self, citations_module):
        assert _urls(citations_module, {'limit': '2', 'next_token': encode_offset_cursor(2, 4) or ''}) == [
            'https://m.example/page', VIDEO_URL,
        ]

    def test_returns_the_page_at_an_offset(self, citations_module):
        assert _urls(citations_module, {'limit': '1', 'offset': '3'}) == [VIDEO_URL]

    def test_ends_with_a_null_token_on_the_last_page(self, citations_module):
        _, body = _get(citations_module, {'limit': '2', 'offset': '2'})

        assert body['next_token'] is None

    def test_leaves_the_keyword_texts_out_of_list_rows(self, citations_module):
        _, body = _get(citations_module, {'limit': '1'})

        assert body['top_urls'] == [{
            'url': 'https://a.example/guide', 'citation_count': 5, 'by_provider': {'openai': 1},
            'keyword_count': 1, 'content_type': 'page',
        }]

    def test_includes_the_keyword_texts_when_asked_for(self, citations_module):
        _, body = _get(citations_module, {'limit': '2', 'include_keywords': 'true'})

        assert body['top_urls'][1]['keywords'] == ['hotels', 'spa']

    def test_reports_an_untruncated_read(self, citations_module):
        assert _get(citations_module)[1]['truncated'] is False

    @pytest.mark.parametrize('token', ['not-a-token', encode_offset_cursor(-1, 4) or '', 'eyJvZmZzZXQiOnRydWV9'])
    def test_rejects_a_malformed_next_token_with_400(self, citations_module, token):
        assert _get(citations_module, {'next_token': token}) == (400, {'error': 'Invalid next_token', 'field': 'next_token'})

    def test_rejects_an_unknown_sort_column_with_400(self, citations_module):
        status, body = _get(citations_module, {'sort': 'title'})

        assert (status, body['field']) == (400, 'sort')
