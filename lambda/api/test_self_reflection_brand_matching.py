"""
Tests for brand lookup in self-reflection.

REGRESSION (AUDIT-2026-08-19 §2.15): `find_brand_in_results` matched with
`brand_lower in name.lower()`, the substring form that
`get-historical-trends.py`, `get-recommendations.py`, `content-studio.py` and
`get-citation-gaps.py` had all already replaced with
`shared.utils.brand_names_match`.

The consequence was worse here than a wrong number on a screen: the matched
brand's rank is passed into the Bedrock reflection prompt AND persisted by
`store_reflection` with a 24h TTL. So tracking `"Inn"` made the model explain
`"Holiday Inn"`'s position as if it were yours, and the dashboard served that
as fact for a day.
"""

from __future__ import annotations

import importlib.util
import os
import sys
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

_API_DIR = os.path.dirname(os.path.abspath(__file__))
_LAMBDA_DIR = os.path.abspath(os.path.join(_API_DIR, '..'))
_MODULE_NAME = 'self_reflection_under_test'

_TEST_ENV = {
    'DYNAMODB_TABLE_SELF_REFLECTION': 'test-self-reflection',
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-search-results',
    'QUERY_PROMPTS_TABLE': 'test-query-prompts',
    'DYNAMODB_TABLE_BRAND_CONFIG': 'test-brand-config',
    'BRAND_CONFIG_TABLE': 'test-brand-config',
    'CORS_ORIGIN_PARAM': '',
}


def _load_handler() -> Any:
    """Import the hyphenated handler module with AWS clients mocked."""
    if _LAMBDA_DIR not in sys.path:
        sys.path.insert(0, _LAMBDA_DIR)

    aws = MagicMock()

    sys.modules.pop(_MODULE_NAME, None)
    spec = importlib.util.spec_from_file_location(
        _MODULE_NAME, os.path.join(_API_DIR, 'self-reflection.py')
    )
    module = importlib.util.module_from_spec(spec)

    with patch('boto3.client', return_value=aws), \
         patch('boto3.resource', return_value=aws), \
         patch.dict(os.environ, _TEST_ENV):
        spec.loader.exec_module(module)

    return module


@pytest.fixture
def reflection():
    """Provide the self-reflection module."""
    module = _load_handler()
    yield module
    sys.modules.pop(_MODULE_NAME, None)


def brand_entry(name: str, rank: int, classification: str = 'competitor') -> dict[str, Any]:
    """Build one entry as the brand extractor emits it."""
    return {
        'name': name,
        'rank': rank,
        'classification': classification,
    }


class TestExactBrandMatching:
    """The brand the caller asked about, and only that brand."""

    def test_returns_the_rank_for_an_exact_name(self, reflection) -> None:
        brands = [brand_entry('Holiday Inn', 3), brand_entry('Inn', 7)]

        _, rank = reflection.find_brand_in_results('Inn', brands)

        assert rank == 7

    def test_matches_regardless_of_letter_case(self, reflection) -> None:
        brands = [brand_entry('Marriott', 2)]

        found, rank = reflection.find_brand_in_results('marriott', brands)

        assert found is not None
        assert rank == 2

    def test_matches_across_surrounding_whitespace(self, reflection) -> None:
        brands = [brand_entry('  Marriott  ', 2)]

        _, rank = reflection.find_brand_in_results('Marriott', brands)

        assert rank == 2

    def test_matches_across_collapsed_internal_whitespace(self, reflection) -> None:
        brands = [brand_entry('Holiday  Inn', 3)]

        _, rank = reflection.find_brand_in_results('Holiday Inn', brands)

        assert rank == 3

    def test_returns_the_matched_brand_record(self, reflection) -> None:
        brands = [brand_entry('Marriott', 2, classification='first_party')]

        found, _ = reflection.find_brand_in_results('Marriott', brands)

        assert found['classification'] == 'first_party'


class TestSubstringMatchesAreRejected:
    """
    The regression itself. Each of these returned a *different* brand's rank
    before the fix, and that rank reached the LLM prompt and DynamoDB.
    """

    def test_does_not_return_a_longer_brand_containing_the_tracked_name(self, reflection) -> None:
        """The audit's own example: tracking "Inn" must not match "Holiday Inn"."""
        brands = [brand_entry('Holiday Inn', 3)]

        found, rank = reflection.find_brand_in_results('Inn', brands)

        assert found is None
        assert rank is None

    def test_does_not_match_a_brand_name_embedded_in_a_domain(self, reflection) -> None:
        brands = [brand_entry('linkedin.com', 5)]

        found, _ = reflection.find_brand_in_results('Inn', brands)

        assert found is None

    def test_does_not_match_a_hyphenated_variant(self, reflection) -> None:
        brands = [brand_entry('Hilton-Garden', 4)]

        found, _ = reflection.find_brand_in_results('Hilton', brands)

        assert found is None

    def test_prefers_the_exact_entry_over_an_earlier_containing_entry(self, reflection) -> None:
        """
        Ordering must not decide correctness: the containing name comes first in
        the list, so a substring matcher would return rank 3 instead of 7.
        """
        brands = [brand_entry('Holiday Inn', 3), brand_entry('Inn', 7)]

        found, rank = reflection.find_brand_in_results('Inn', brands)

        assert found['name'] == 'Inn'
        assert rank == 7


class TestMissingAndMalformedEntries:
    """A reflection request for an unmentioned brand is normal, not an error."""

    def test_returns_nothing_for_an_empty_brand_list(self, reflection) -> None:
        assert reflection.find_brand_in_results('Marriott', []) == (None, None)

    def test_returns_nothing_when_the_brand_is_absent(self, reflection) -> None:
        brands = [brand_entry('Hilton', 1)]

        assert reflection.find_brand_in_results('Marriott', brands) == (None, None)

    def test_skips_an_entry_with_no_name(self, reflection) -> None:
        brands = [{'rank': 1}, brand_entry('Marriott', 2)]

        _, rank = reflection.find_brand_in_results('Marriott', brands)

        assert rank == 2

    def test_returns_a_none_rank_for_a_matched_brand_with_no_rank(self, reflection) -> None:
        """Unranked-but-mentioned is distinct from not-mentioned."""
        brands = [{'name': 'Marriott', 'classification': 'first_party'}]

        found, rank = reflection.find_brand_in_results('Marriott', brands)

        assert found is not None
        assert rank is None
