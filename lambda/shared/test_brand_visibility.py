"""
Tests for shared.brand_visibility.

These helpers replaced the copies that `get-recommendations.py` and
`content-studio.py` each carried of the same pipeline: lowercase the
tracked brands, load recent SearchResults rows for the active keywords, and
classify each brand mention. The tests pin the behaviour both handlers
relied on so the consolidation cannot change either of them.
"""

from __future__ import annotations

import pytest

from shared.brand_visibility import (
    classify_brand,
    tracked_brand_names,
)
from shared.request_deadline import clear_request_deadline

FIRST_PARTY = ['marriott']


@pytest.fixture(autouse=True)
def _no_active_deadline():
    yield
    clear_request_deadline()
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


