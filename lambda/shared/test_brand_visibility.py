"""
Tests for shared.brand_visibility.

These helpers replaced the copies that `get-recommendations.py` and
`content-studio.py` each carried of the same pipeline: lowercase the
tracked brands, load recent SearchResults rows for the active keywords, and
classify each brand mention. The tests pin the behaviour both handlers
relied on so the consolidation cannot change either of them.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

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


@pytest.fixture
def dynamodb():
    """A DynamoDB resource stub whose ``Table(name)`` returns one mock per name."""
    tables: dict[str, MagicMock] = {}
    resource = MagicMock()
    resource.Table.side_effect = lambda name: tables.setdefault(name, MagicMock(name=name))
    resource.tables = tables
    return resource


class TestLoadRecentSearchResults:
    def test_queries_each_explicit_keyword_for_its_most_recent_rows(self, dynamodb, monkeypatch):
        monkeypatch.delenv('DYNAMODB_TABLE_KEYWORDS', raising=False)
        search = dynamodb.Table('search')
        search.query.side_effect = [_table_response([{'keyword': 'a'}]), _table_response([{'keyword': 'b'}])]

        items = load_recent_search_results(dynamodb, 'search', max_keywords=20, keywords=['a', 'b'])

        assert items == [{'keyword': 'a'}, {'keyword': 'b'}]
        kwargs = search.query.call_args_list[0].kwargs
        assert (kwargs['ScanIndexForward'], kwargs['Limit']) == (False, 20)

    def test_caps_the_number_of_queried_keywords_at_max_keywords(self, dynamodb, monkeypatch):
        monkeypatch.delenv('DYNAMODB_TABLE_KEYWORDS', raising=False)
        search = dynamodb.Table('search')
        search.query.return_value = _table_response([])

        load_recent_search_results(dynamodb, 'search', max_keywords=2, keywords=['a', 'b', 'c'])

        assert search.query.call_count == 2

    def test_skips_a_keyword_whose_query_fails_and_keeps_the_rest(self, dynamodb, monkeypatch):
        monkeypatch.delenv('DYNAMODB_TABLE_KEYWORDS', raising=False)
        search = dynamodb.Table('search')
        search.query.side_effect = [RuntimeError('throttled'), _table_response([{'keyword': 'b'}])]

        items = load_recent_search_results(dynamodb, 'search', max_keywords=20, keywords=['a', 'b'])

        assert items == [{'keyword': 'b'}]

    def test_discovers_active_keywords_from_the_keywords_table_when_none_are_given(self, dynamodb, monkeypatch):
        monkeypatch.setenv('DYNAMODB_TABLE_KEYWORDS', 'keywords')
        dynamodb.Table('keywords').scan.return_value = _table_response(
            [{'keyword': 'hotels'}, {'keyword': ''}, {'other': 'x'}]
        )
        search = dynamodb.Table('search')
        search.query.return_value = _table_response([{'keyword': 'hotels'}])

        items = load_recent_search_results(dynamodb, 'search', max_keywords=20)

        assert items == [{'keyword': 'hotels'}]
        assert search.query.call_count == 1
        scan_kwargs = dynamodb.tables['keywords'].scan.call_args.kwargs
        assert scan_kwargs['ExpressionAttributeValues'] == {':status': 'active'}

    def test_treats_an_empty_keyword_list_like_no_keywords(self, dynamodb, monkeypatch):
        monkeypatch.setenv('DYNAMODB_TABLE_KEYWORDS', 'keywords')
        dynamodb.Table('keywords').scan.return_value = _table_response([{'keyword': 'hotels'}])
        dynamodb.Table('search').query.return_value = _table_response([{'keyword': 'hotels'}])

        items = load_recent_search_results(dynamodb, 'search', max_keywords=20, keywords=[])

        assert items == [{'keyword': 'hotels'}]

    def test_falls_back_to_a_bounded_scan_when_no_keyword_is_known(self, dynamodb, monkeypatch):
        monkeypatch.delenv('DYNAMODB_TABLE_KEYWORDS', raising=False)
        search = dynamodb.Table('search')
        search.scan.return_value = _table_response([{'keyword': 'anything'}])

        items = load_recent_search_results(dynamodb, 'search', max_keywords=20)

        assert items == [{'keyword': 'anything'}]
        search.scan.assert_called_once_with(Limit=500)
        search.query.assert_not_called()

    def test_falls_back_to_a_scan_when_the_keywords_table_has_no_active_rows(self, dynamodb, monkeypatch):
        monkeypatch.setenv('DYNAMODB_TABLE_KEYWORDS', 'keywords')
        dynamodb.Table('keywords').scan.return_value = _table_response([])
        search = dynamodb.Table('search')
        search.scan.return_value = _table_response([])

        load_recent_search_results(dynamodb, 'search', max_keywords=20)

        search.scan.assert_called_once_with(Limit=500)
