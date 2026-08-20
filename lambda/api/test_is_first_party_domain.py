"""
Regression tests for `is_first_party_domain` in get-citation-gaps.py.

Background — these tests pin the fix for audit item 22:
    The previous implementation used substring matching (`brand in domain` or
    `domain in fp` bidirectionally), which produced false positives:
      - "Inn" matched both "Holiday Inn" (legit) and "linkedin.com" (bug)
      - "example.com" in first_party_domains matched "notexample.com"
      - "example" as a brand name flagged "google.com/search?q=example"
    A false first-party classification hides legit citation gaps from the
    dashboard and silently misclassifies competitor URLs.

    The fix uses the explicit allow-list only, with exact/subdomain matching.

These tests would FAIL if the substring fallback were reintroduced.
"""

from __future__ import annotations

import importlib.util
import os
import sys

# The module filename has a hyphen, which is not a valid Python identifier.
# Load by file path and bind to a clean module name for pytest.
_HERE = os.path.dirname(__file__)
_MODULE_PATH = os.path.join(_HERE, 'get-citation-gaps.py')

# Mock env vars the module reads at import time so we can load without
# touching AWS.
os.environ.setdefault('DYNAMODB_TABLE_SEARCH_RESULTS', 'test-search')
os.environ.setdefault('DYNAMODB_TABLE_CITATIONS', 'test-citations')
os.environ.setdefault('DYNAMODB_TABLE_CRAWLED_CONTENT', 'test-crawled')

# Put lambda/ on the path so `from shared...` imports in the module under
# test resolve to the layer copies.
_LAMBDA_DIR = os.path.dirname(_HERE)
if _LAMBDA_DIR not in sys.path:
    sys.path.insert(0, _LAMBDA_DIR)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

_spec = importlib.util.spec_from_file_location('get_citation_gaps_under_test', _MODULE_PATH)
_mod = importlib.util.module_from_spec(_spec)
sys.modules['get_citation_gaps_under_test'] = _mod
_spec.loader.exec_module(_mod)

is_first_party_domain = _mod.is_first_party_domain


class TestExactDomainMatch:
    def test_returns_true_for_exact_match(self) -> None:
        config = {'first_party_domains': ['example.com']}
        assert is_first_party_domain('example.com', config) is True

    def test_is_case_insensitive(self) -> None:
        config = {'first_party_domains': ['Example.COM']}
        assert is_first_party_domain('EXAMPLE.com', config) is True

    def test_strips_leading_www_on_both_sides(self) -> None:
        config = {'first_party_domains': ['www.example.com']}
        assert is_first_party_domain('example.com', config) is True
        assert is_first_party_domain('www.example.com', config) is True


class TestSubdomainMatch:
    def test_returns_true_for_subdomain(self) -> None:
        config = {'first_party_domains': ['example.com']}
        assert is_first_party_domain('blog.example.com', config) is True

    def test_returns_true_for_nested_subdomain(self) -> None:
        config = {'first_party_domains': ['example.com']}
        assert is_first_party_domain('a.b.example.com', config) is True


class TestSubstringRegressionGuards:
    """These are the bugs the old implementation shipped. Each assertion
    must fail if substring matching is reintroduced."""

    def test_does_not_match_domain_that_merely_contains_the_configured_domain(self) -> None:
        """`notexample.com` contains `example.com` as a substring — must NOT match."""
        config = {'first_party_domains': ['example.com']}
        assert is_first_party_domain('notexample.com', config) is False

    def test_does_not_match_suffix_without_dot_boundary(self) -> None:
        """`evilexample.com` ends with `example.com` as a substring — must NOT match."""
        config = {'first_party_domains': ['example.com']}
        assert is_first_party_domain('evilexample.com', config) is False

    def test_does_not_match_when_configured_domain_is_a_substring_of_short_target(self) -> None:
        """The old bidirectional match would flip `x.com` as first-party if
        `a.x.com` was configured. That's a privilege-escalation bug for
        cousin domains — must NOT match."""
        config = {'first_party_domains': ['something.example.com']}
        assert is_first_party_domain('example.com', config) is False

    def test_does_not_match_via_brand_name_fallback(self) -> None:
        """The old Method 2 fallback used `first_party` brand names against
        domains — classic false positive: 'Inn' in 'linkedin.com'. The new
        implementation ignores tracked_brands entirely; only the
        first_party_domains allow-list matters."""
        config = {
            'first_party_domains': [],
            'tracked_brands': {'first_party': ['Holiday Inn', 'Marriott']},
        }
        assert is_first_party_domain('linkedin.com', config) is False
        assert is_first_party_domain('marriotttourguide.com', config) is False

    def test_returns_false_when_no_domains_configured(self) -> None:
        """No allow-list = no first-party classification. Previously would
        fall through to brand-name substring matching and produce false
        positives."""
        assert is_first_party_domain('example.com', {}) is False
        assert is_first_party_domain('example.com', {'first_party_domains': []}) is False


class TestDefensiveInputHandling:
    def test_returns_false_for_empty_domain(self) -> None:
        config = {'first_party_domains': ['example.com']}
        assert is_first_party_domain('', config) is False

    def test_returns_false_for_none_domain(self) -> None:
        config = {'first_party_domains': ['example.com']}
        assert is_first_party_domain(None, config) is False  # type: ignore[arg-type]

    def test_returns_false_for_non_string_domain(self) -> None:
        config = {'first_party_domains': ['example.com']}
        assert is_first_party_domain(123, config) is False  # type: ignore[arg-type]

    def test_skips_non_string_entries_in_allow_list(self) -> None:
        """Config may be DynamoDB-hydrated — be defensive against mixed types."""
        config = {'first_party_domains': [None, 123, '', 'example.com']}
        assert is_first_party_domain('example.com', config) is True
        assert is_first_party_domain('other.com', config) is False

    def test_returns_false_for_missing_first_party_domains_key(self) -> None:
        """Back-compat: old brand configs may not have first_party_domains."""
        assert is_first_party_domain('example.com', {'tracked_brands': {}}) is False
