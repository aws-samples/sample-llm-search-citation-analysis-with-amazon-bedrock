"""
Tests for shared.brand_visibility.

These helpers replaced the copies that `get-recommendations.py` and
`content-studio.py` each carried of the same pipeline: lowercase the
tracked brands, load recent SearchResults rows for the active keywords, and
classify each brand mention. The tests pin the behaviour both handlers
relied on so the consolidation cannot change either of them.
"""

from __future__ import annotations

import functools
from unittest.mock import MagicMock

import pytest
from boto3.dynamodb.conditions import Key

from shared.brand_visibility import (
    classify_brand,
    load_recent_search_results,
    tracked_brand_names,
)

FIRST_PARTY = ['marriott']
COMPETITORS = ['hilton', 'hyatt']


class TestTrackedBrandNames:
    def test_returns_lowercased_first_party_and_competitor_names(self):
        config = {'tracked_brands': {'first_party': ['Marriott'], 'competitors': ['Hilton', 'HYATT']}}

        assert tracked_brand_names(config) == (['marriott'], ['hilton', 'hyatt'])

    def test_returns_two_empty_lists_when_brands_are_not_configured(self):
        assert tracked_brand_names({}) == ([], [])


class TestClassifyBrand:
    def test_trusts_a_first_party_classification_over_the_name_lists(self):
        brand = {'name': 'Hilton', 'classification': 'first_party'}

        assert classify_brand(brand, FIRST_PARTY, COMPETITORS) == 'first_party'

    def test_trusts_a_competitor_classification_over_the_name_lists(self):
        brand = {'name': 'Marriott', 'classification': 'competitor'}

        assert classify_brand(brand, FIRST_PARTY, COMPETITORS) == 'competitor'

    @pytest.mark.parametrize('classification', ['other', ''], ids=['other', 'empty-string'])
    def test_classifies_any_other_llm_label_as_neither(self, classification):
        brand = {'name': 'Marriott', 'classification': classification}

        assert classify_brand(brand, FIRST_PARTY, COMPETITORS) is None

    def test_falls_back_to_an_exact_first_party_name_match_when_unclassified(self):
        assert classify_brand({'name': '  MARRIOTT '}, FIRST_PARTY, COMPETITORS) == 'first_party'

    def test_falls_back_to_an_exact_competitor_name_match_when_unclassified(self):
        assert classify_brand({'name': 'Hyatt'}, FIRST_PARTY, COMPETITORS) == 'competitor'

    def test_returns_none_when_an_unclassified_name_matches_neither_list(self):
        assert classify_brand({'name': 'Accor'}, FIRST_PARTY, COMPETITORS) is None

    def test_never_matches_a_tracked_name_as_a_substring(self):
        """REGRESSION GUARD (audit items 9 and 22): `Inn` must not claim `Holiday Inn`."""
        assert classify_brand({'name': 'Holiday Inn'}, ['inn'], []) is None

    def test_prefers_first_party_when_a_name_is_tracked_in_both_lists(self):
        assert classify_brand({'name': 'Marriott'}, ['marriott'], ['marriott']) == 'first_party'

    def test_treats_a_missing_name_as_unmatched(self):
        assert classify_brand({}, FIRST_PARTY, COMPETITORS) is None


def _table_response(items):
    return {'Items': items}


def _keyword_rows(*keywords):
    """A query/scan page holding one row per keyword."""
    return _table_response([{'keyword': keyword} for keyword in keywords])


@pytest.fixture
def dynamodb():
    """A DynamoDB resource stub whose ``Table(name)`` returns one mock per name."""
    tables: dict[str, MagicMock] = {}
    resource = MagicMock()
    resource.Table.side_effect = lambda name: tables.setdefault(name, MagicMock(name=name))
    resource.tables = tables
    return resource


@pytest.fixture
def search(dynamodb):
    """The SearchResults table stub every load reads from."""
    return dynamodb.Table('search')


@pytest.fixture
def load_recent(dynamodb):
    """``load_recent_search_results`` bound to the stub resource and the ``search`` table."""
    return functools.partial(load_recent_search_results, dynamodb, 'search')


@pytest.fixture
def no_keywords_table(monkeypatch):
    """No keywords table is configured, so keyword discovery is unavailable."""
    monkeypatch.delenv('DYNAMODB_TABLE_KEYWORDS', raising=False)


@pytest.fixture
def keywords_table(dynamodb, monkeypatch):
    """The configured keywords table stub that keyword discovery queries."""
    monkeypatch.setenv('DYNAMODB_TABLE_KEYWORDS', 'keywords')
    return dynamodb.Table('keywords')


@pytest.mark.usefixtures('no_keywords_table')
class TestLoadRecentSearchResultsWithoutKeywordsTable:
    def test_queries_each_explicit_keyword_for_its_most_recent_rows(self, load_recent, search):
        search.query.side_effect = [_keyword_rows('a'), _keyword_rows('b')]

        items = load_recent(max_keywords=20, keywords=['a', 'b'])

        assert items == [{'keyword': 'a'}, {'keyword': 'b'}]
        kwargs = search.query.call_args_list[0].kwargs
        assert (kwargs['ScanIndexForward'], kwargs['Limit']) == (False, 20)

    def test_caps_the_number_of_queried_keywords_at_max_keywords(self, load_recent, search):
        search.query.return_value = _keyword_rows()

        load_recent(max_keywords=2, keywords=['a', 'b', 'c'])

        assert search.query.call_count == 2

    def test_skips_a_keyword_whose_query_fails_and_keeps_the_rest(self, load_recent, search):
        search.query.side_effect = [RuntimeError('throttled'), _keyword_rows('b')]

        items = load_recent(max_keywords=20, keywords=['a', 'b'])

        assert items == [{'keyword': 'b'}]

    def test_falls_back_to_a_bounded_scan_when_no_keyword_is_known(self, load_recent, search):
        search.scan.return_value = _keyword_rows('anything')

        items = load_recent(max_keywords=20)

        assert items == [{'keyword': 'anything'}]
        search.scan.assert_called_once_with(Limit=500)
        search.query.assert_not_called()


class TestLoadRecentSearchResultsWithKeywordsTable:
    def test_discovers_active_keywords_from_the_status_index_when_none_are_given(self, load_recent, search, keywords_table):
        keywords_table.query.return_value = _table_response([{'keyword': 'hotels'}, {'keyword': ''}, {'other': 'x'}])
        search.query.return_value = _keyword_rows('hotels')

        items = load_recent(max_keywords=20)

        assert items == [{'keyword': 'hotels'}]
        assert search.query.call_args.kwargs['KeyConditionExpression'] == Key('keyword').eq('hotels')

    def test_queries_one_status_index_page_of_max_keywords_when_discovering_keywords(
        self, load_recent, search, keywords_table
    ):
        keywords_table.query.return_value = _keyword_rows()
        search.scan.return_value = _keyword_rows()

        load_recent(max_keywords=30)

        keywords_table.query.assert_called_once_with(
            IndexName='StatusIndex',
            KeyConditionExpression=Key('status').eq('active'),
            ProjectionExpression='keyword',
            Limit=30,
        )

    def test_never_scans_the_keywords_table_when_discovering_keywords(self, load_recent, search, keywords_table):
        """REGRESSION: a filtered scan applied Limit before the status filter.

        With thousands of keywords the first 100 evaluated rows could hold no
        active keyword at all, so the analysis silently fell back to an
        arbitrary slice of the search table.
        """
        keywords_table.query.return_value = _keyword_rows('hotels')
        search.query.return_value = _keyword_rows()

        load_recent(max_keywords=20)

        keywords_table.scan.assert_not_called()

    def test_queries_every_discovered_keyword_in_index_order(self, load_recent, search, keywords_table):
        keywords_table.query.return_value = _keyword_rows('alpha', 'beta', 'gamma')
        search.query.return_value = _keyword_rows()

        load_recent(max_keywords=3)

        assert [call.kwargs['KeyConditionExpression'] for call in search.query.call_args_list] == [
            Key('keyword').eq('alpha'),
            Key('keyword').eq('beta'),
            Key('keyword').eq('gamma'),
        ]

    def test_skips_discovery_and_falls_back_when_max_keywords_is_zero(self, load_recent, search, keywords_table):
        search.scan.return_value = _keyword_rows()

        load_recent(max_keywords=0)

        keywords_table.query.assert_not_called()

    def test_treats_an_empty_keyword_list_like_no_keywords(self, load_recent, search, keywords_table):
        keywords_table.query.return_value = _keyword_rows('hotels')
        search.query.return_value = _keyword_rows('hotels')

        items = load_recent(max_keywords=20, keywords=[])

        assert items == [{'keyword': 'hotels'}]

    def test_falls_back_to_a_scan_when_the_keywords_table_has_no_active_rows(self, load_recent, search, keywords_table):
        keywords_table.query.return_value = _keyword_rows()
        search.scan.return_value = _keyword_rows()

        load_recent(max_keywords=20)

        search.scan.assert_called_once_with(Limit=500)
