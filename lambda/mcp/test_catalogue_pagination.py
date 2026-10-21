"""
Paginated and size-bounded routes: the tools pass the cursor and the paging and filter arguments the API routes take.

Every route below answers one bounded page with ``next_token`` (``null`` on the
last page); the tool hands the cursor back unchanged, so a host can ask for the
next page with the same arguments plus ``next_token``.
"""

from __future__ import annotations

import re

import pytest
from catalogue import InvalidArguments, Route, find_operation, validate_arguments

TOKEN = 'eyJvZmZzZXQiOiAxMDB9'

#: (tool, arguments without the cursor, path the page comes from)
PAGINATED_CALLS = [
    ('get_citations', {'view': 'list'}, '/api/citations'),
    ('list_recent_searches', {}, '/api/searches'),
    ('get_crawled_page', {'url': 'https://e.com/p'}, '/api/crawled-content'),
    ('get_brand_mentions', {'keyword': 'hotel coruña', 'view': 'appearances'}, '/api/brand-mentions'),
    ('get_report', {'kind': 'group_kpis', 'group_id': 'grp_1', 'view': 'keywords'}, '/api/reports/group-kpis'),
    ('get_sentiment_examples', {'group_id': 'grp_1', 'sentiment': 'negative'}, '/api/visibility/sentiment-examples'),
    ('list_content_items', {}, '/api/content-studio/history'),
    ('list_research_jobs', {}, '/api/keyword-research/history'),
    ('list_schedules', {}, '/api/schedules'),
]


def _route(name: str, arguments: dict) -> Route:
    tool = find_operation(name)
    return tool.route(validate_arguments(tool.input_schema, arguments))


def _query(name: str, arguments: dict) -> dict[str, str]:
    return _route(name, arguments).query or {}


class TestCursor:
    @pytest.mark.parametrize(('name', 'arguments', 'path'), PAGINATED_CALLS, ids=[call[0] for call in PAGINATED_CALLS])
    def test_forwards_next_token_to_the_route_that_issued_it(self, name, arguments, path):
        route = _route(name, {**arguments, 'next_token': TOKEN})

        assert (route.path, (route.query or {}).get('next_token')) == (path, TOKEN)

    @pytest.mark.parametrize('name', sorted({call[0] for call in PAGINATED_CALLS}))
    def test_description_says_the_tool_is_paginated(self, name):
        assert re.search(r'paginated|paged', find_operation(name).description, re.IGNORECASE) is not None

    @pytest.mark.parametrize(('name', 'arguments', 'path'), PAGINATED_CALLS, ids=[call[0] for call in PAGINATED_CALLS])
    def test_rejects_a_cursor_that_is_not_a_string(self, name, arguments, path):
        with pytest.raises(InvalidArguments, match='next_token must be of type string'):
            _route(name, {**arguments, 'next_token': 100})


class TestCitationsList:
    def test_list_forwards_the_page_sort_and_filters(self):
        arguments = {'view': 'list', 'limit': 250, 'sort': 'domain', 'order': 'asc', 'url_contains': 'coruña',
                     'min_citations': 0, 'content_type': 'video'}

        assert _query('get_citations', arguments) == {
            'limit': '250', 'sort': 'domain', 'order': 'asc', 'url_contains': 'coruña', 'min_citations': '0',
            'content_type': 'video',
        }

    def test_list_accepts_a_page_of_1000_urls(self):
        assert _query('get_citations', {'view': 'list', 'limit': 1000}) == {'limit': '1000'}

    def test_list_rejects_a_page_over_1000_urls(self):
        with pytest.raises(InvalidArguments, match='limit must be between 1 and 1000'):
            _route('get_citations', {'view': 'list', 'limit': 1001})

    def test_gaps_receive_only_the_limit_and_scope(self):
        arguments = {'view': 'gaps', 'group_id': 'grp_1', 'limit': 20, 'sort': 'domain', 'next_token': TOKEN}

        assert _query('get_citations', arguments) == {'limit': '20', 'group_id': 'grp_1'}

    def test_rejects_a_negative_minimum_citation_count(self):
        with pytest.raises(InvalidArguments, match='min_citations must be at least 0'):
            _route('get_citations', {'view': 'list', 'min_citations': -1})

    def test_rejects_an_unknown_sort_column(self):
        with pytest.raises(InvalidArguments, match='sort must be one of: citations, keywords, domain'):
            _route('get_citations', {'view': 'list', 'sort': 'engine'})


class TestRecentSearchesAndCrawledPages:
    def test_recent_searches_forward_include_response_as_a_lower_case_boolean(self):
        assert _query('list_recent_searches', {'limit': 500, 'include_response': True}) == {
            'limit': '500', 'include_response': 'true',
        }

    def test_recent_searches_reject_more_than_500_rows(self):
        with pytest.raises(InvalidArguments, match='limit must be between 1 and 500'):
            _route('list_recent_searches', {'limit': 501})

    def test_crawled_page_forwards_include_content_false(self):
        assert _query('get_crawled_page', {'url': 'https://e.com/p', 'include_content': False}) == {
            'url': 'https://e.com/p', 'include_content': 'false',
        }


class TestBrandMentions:
    def test_appearances_view_forwards_brand_and_page_size(self):
        arguments = {'keyword': 'hotel coruña', 'view': 'appearances', 'brand': 'Hotel Coruña', 'limit': 2000}

        assert _query('get_brand_mentions', arguments) == {
            'view': 'appearances', 'brand': 'Hotel Coruña', 'limit': '2000', 'keyword': 'hotel coruña',
        }

    def test_rejects_more_than_2000_appearances_per_page(self):
        with pytest.raises(InvalidArguments, match='limit must be between 1 and 2000'):
            _route('get_brand_mentions', {'keyword': 'hotel coruña', 'limit': 2001})

    def test_rejects_an_unknown_view(self):
        with pytest.raises(InvalidArguments, match='view must be one of: summary, appearances'):
            _route('get_brand_mentions', {'keyword': 'hotel coruña', 'view': 'brands'})


class TestGroupKpisReport:
    def test_keywords_view_forwards_one_keyword_and_the_page_size(self):
        arguments = {'kind': 'group_kpis', 'group_id': 'grp_1', 'view': 'keywords', 'detail_keyword': 'parador', 'limit': 25}

        assert _query('get_report', arguments) == {
            'view': 'keywords', 'detail_keyword': 'parador', 'limit': '25', 'group_id': 'grp_1',
        }

    def test_drivers_view_forwards_the_run_range(self):
        arguments = {'kind': 'group_kpis', 'group_id': 'grp_1', 'days': 30, 'view': 'drivers',
                     'from_run': '2026-09-01T00:00:00', 'to_run': '2026-09-18T00:00:00'}

        assert _query('get_report', arguments) == {
            'days': '30', 'view': 'drivers', 'from_run': '2026-09-01T00:00:00', 'to_run': '2026-09-18T00:00:00',
            'group_id': 'grp_1',
        }

    def test_rejects_more_than_25_keywords_per_page(self):
        with pytest.raises(InvalidArguments, match='limit must be between 1 and 25'):
            _route('get_report', {'kind': 'group_kpis', 'group_id': 'grp_1', 'limit': 26})

    def test_other_reports_ignore_the_group_kpis_paging_arguments(self):
        arguments = {'kind': 'competitor', 'competitor': 'Rival Hotels', 'view': 'drivers', 'limit': 5, 'next_token': TOKEN}

        assert _query('get_report', arguments) == {'competitor': 'Rival Hotels'}


class TestPageSizes:
    @pytest.mark.parametrize(('name', 'maximum'), [('list_content_items', 100), ('list_research_jobs', 100), ('list_schedules', 100)])
    def test_forwards_the_largest_page_the_route_serves(self, name, maximum):
        assert _query(name, {'limit': maximum}) == {'limit': str(maximum)}

    @pytest.mark.parametrize('name', ['list_content_items', 'list_research_jobs', 'list_schedules'])
    def test_rejects_a_page_over_100_items(self, name):
        with pytest.raises(InvalidArguments, match='limit must be between 1 and 100'):
            _route(name, {'limit': 101})
