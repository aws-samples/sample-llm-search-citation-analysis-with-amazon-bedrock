"""
Regression tests for brand classification in get-citation-gaps.py.

Background — these pin the fix for the bug where Citation Gaps reported
0 gaps / 114 covered (89.8% coverage) while the Visibility dashboard reported
the first-party brand absent (score 0.0, share of voice 0.0) for the same
keyword.

Root cause: analyze_citation_gaps used a permissive fuzzy_match_brand fallback
(bidirectional substring + any shared word longer than 3 chars) whenever the
LLM classification was not exactly 'first_party'/'competitor'. That flipped
LLM-classified 'other' brands into first-party, marking competitor-citing
sources as 'covered' and yielding zero gaps. Meanwhile get-visibility-metrics
trusted only the LLM 'classification' field, so the two features disagreed.

The fix replaces the fallback with classify_response_brands, which trusts the
LLM 'classification' field and falls back ONLY to exact name matching
(shared.utils.brand_names_match) for legacy records missing the field.

These tests would FAIL if substring/word-overlap matching were reintroduced.
"""

from __future__ import annotations

import importlib.util
import os
import sys
from typing import Any

# The module filename has a hyphen, which is not a valid Python identifier.
# Load by file path and bind to a clean module name for pytest (same pattern
# as test_is_first_party_domain.py).
_HERE = os.path.dirname(__file__)
_MODULE_PATH = os.path.join(_HERE, 'get-citation-gaps.py')

# Mock env vars the module reads at import time so we can load without AWS.
os.environ.setdefault('DYNAMODB_TABLE_SEARCH_RESULTS', 'test-search')
os.environ.setdefault('DYNAMODB_TABLE_CITATIONS', 'test-citations')
os.environ.setdefault('DYNAMODB_TABLE_CRAWLED_CONTENT', 'test-crawled')

# Put lambda/ on the path so `from shared...` and `from decimal_utils...` in
# the module under test resolve to the layer copies.
_LAMBDA_DIR = os.path.dirname(_HERE)
if _LAMBDA_DIR not in sys.path:
    sys.path.insert(0, _LAMBDA_DIR)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

_spec = importlib.util.spec_from_file_location('get_citation_gaps_classify_under_test', _MODULE_PATH)
_mod = importlib.util.module_from_spec(_spec)
sys.modules['get_citation_gaps_classify_under_test'] = _mod
_spec.loader.exec_module(_mod)

classify_response_brands = _mod.classify_response_brands
analyze_citation_gaps = _mod.analyze_citation_gaps


class TestClassifyResponseBrandsLlmClassification:
    """The LLM 'classification' field is authoritative."""

    def test_counts_a_brand_as_first_party_when_classification_is_first_party(self) -> None:
        first_party, competitors = classify_response_brands(
            [{'name': 'Marmara', 'classification': 'first_party'}],
            ['marmara'],
            ['four seasons'],
        )
        assert first_party == {'Marmara'}
        assert competitors == set()

    def test_counts_a_brand_as_competitor_when_classification_is_competitor(self) -> None:
        first_party, competitors = classify_response_brands(
            [{'name': 'Four Seasons', 'classification': 'competitor'}],
            ['marmara'],
            ['four seasons'],
        )
        assert competitors == {'Four Seasons'}
        assert first_party == set()

    def test_classifies_an_other_brand_as_neither_when_it_shares_a_word_with_a_first_party_brand(self) -> None:
        # The exact bug: 'Istanbul Grand Hotel' is LLM-classified 'other' but
        # shares the word 'istanbul' with the configured first-party brand.
        # The old word-overlap fallback flipped it into first-party.
        first_party, competitors = classify_response_brands(
            [{'name': 'Istanbul Grand Hotel', 'classification': 'other'}],
            ['marmara istanbul'],
            ['four seasons'],
        )
        assert first_party == set()
        assert competitors == set()


class TestClassifyResponseBrandsLegacyFallback:
    """The exact-name fallback fires only when 'classification' is absent."""

    def test_falls_back_to_exact_name_match_when_classification_is_missing(self) -> None:
        first_party, competitors = classify_response_brands(
            [{'name': 'Marmara'}],
            ['marmara'],
            ['four seasons'],
        )
        assert first_party == {'Marmara'}
        assert competitors == set()

    def test_does_not_fall_back_via_substring_when_classification_is_missing(self) -> None:
        # Guard against reintroducing substring matching: 'Holiday Inn' must
        # NOT match a configured 'inn' through the legacy fallback.
        first_party, competitors = classify_response_brands(
            [{'name': 'Holiday Inn'}],
            ['inn'],
            [],
        )
        assert first_party == set()
        assert competitors == set()


class TestClassifyResponseBrandsDefensiveInput:
    def test_ignores_brands_with_an_empty_name(self) -> None:
        first_party, competitors = classify_response_brands(
            [{'name': '', 'classification': 'first_party'}],
            ['marmara'],
            ['four seasons'],
        )
        assert first_party == set()
        assert competitors == set()


class _FakeSearchTable:
    """Minimal stand-in for a DynamoDB Table that returns canned query items."""

    def __init__(self, items: list[dict[str, Any]]) -> None:
        self._items = items

    def query(self, **_kwargs: Any) -> dict[str, Any]:
        return {'Items': self._items}


class TestAnalyzeCitationGapsEndToEnd:
    def test_reports_gaps_instead_of_full_coverage_when_no_brand_is_classified_first_party(
        self, monkeypatch: Any
    ) -> None:
        # Reproduces the bug report: a keyword whose only brands are an
        # LLM-'other' brand (sharing a word with the first-party brand) and a
        # competitor, citing two distinct third-party sources. With the fix the
        # first-party brand is absent, so both sources are gaps and coverage is 0.
        item = {
            'keyword': 'which hotels to stay in turkey',
            'timestamp': '2026-01-01T00:00:00Z',
            'provider': 'claude',
            'citations': [
                'https://competitorblog.com/best-turkey-hotels',
                'https://hotelsreview.com/istanbul',
            ],
            'brands': [
                {'name': 'Istanbul Grand Hotel', 'classification': 'other'},
                {'name': 'Four Seasons', 'classification': 'competitor'},
            ],
        }
        monkeypatch.setattr(_mod.dynamodb, 'Table', lambda _name: _FakeSearchTable([item]))
        monkeypatch.setattr(_mod, '_batch_crawled_info', lambda _urls: {})

        config = {
            'tracked_brands': {'first_party': ['Marmara'], 'competitors': ['Four Seasons']},
            'first_party_domains': [],
        }
        result = analyze_citation_gaps('which hotels to stay in turkey', config)

        assert result['summary']['covered_count'] == 0
        assert result['summary']['gap_count'] == 2
        assert result['summary']['coverage_rate'] == 0

    def test_reports_full_coverage_when_first_party_is_classified_present(
        self, monkeypatch: Any
    ) -> None:
        # Control case: when the LLM does classify the first-party brand as
        # present on a source, that source is covered, not a gap.
        item = {
            'keyword': 'which hotels to stay in turkey',
            'timestamp': '2026-01-01T00:00:00Z',
            'provider': 'claude',
            'citations': ['https://travelguide.com/turkey'],
            'brands': [
                {'name': 'Marmara', 'classification': 'first_party'},
                {'name': 'Four Seasons', 'classification': 'competitor'},
            ],
        }
        monkeypatch.setattr(_mod.dynamodb, 'Table', lambda _name: _FakeSearchTable([item]))
        monkeypatch.setattr(_mod, '_batch_crawled_info', lambda _urls: {})

        config = {
            'tracked_brands': {'first_party': ['Marmara'], 'competitors': ['Four Seasons']},
            'first_party_domains': [],
        }
        result = analyze_citation_gaps('which hotels to stay in turkey', config)

        assert result['summary']['gap_count'] == 0
        assert result['summary']['covered_count'] == 1
        assert result['summary']['coverage_rate'] == 100.0
