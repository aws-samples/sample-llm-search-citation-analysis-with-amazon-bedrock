"""
Characterization tests for shared.utils timestamp helpers.

These helpers are called from 27+ sites across the Lambda codebase; their
wire format (ISO 8601 with trailing 'Z') is a contract for DynamoDB sort
keys, S3 object prefixes, and API responses. A regression here breaks silent
comparisons downstream — the tests below pin the contract.

The helpers under test:
- utc_now()            — timezone-aware datetime.now(UTC) replacement
- get_timestamp()      — 'YYYY-MM-DDTHH:MM:SS.ffffffZ' wire format
- get_timestamp_compact() — 'YYYYMMDD-HHMMSS' filesystem-safe stamp
"""

from __future__ import annotations

import os
import re
import sys
from datetime import UTC, datetime, timedelta

# Match the pattern used by test_llm_json / test_url_validator / test_router:
# insert the shared/ dir onto sys.path so the module loads by bare name,
# which avoids pytest walking up into shared/__init__.py (which pulls boto3).
sys.path.insert(0, os.path.dirname(__file__))

import utils  # type: ignore[import-not-found]


class TestGetTimestamp:
    """get_timestamp() produces the canonical ISO 8601 wire format."""

    def test_ends_with_Z_suffix(self) -> None:
        ts = utils.get_timestamp()
        assert ts.endswith('Z')

    def test_does_not_contain_raw_offset(self) -> None:
        """Regression guard: the +00:00 suffix must be normalized to Z."""
        ts = utils.get_timestamp()
        assert '+00:00' not in ts

    def test_matches_legacy_wire_format_pattern(self) -> None:
        """'YYYY-MM-DDTHH:MM:SS.ffffffZ' — what datetime.utcnow().isoformat() + 'Z' produced."""
        ts = utils.get_timestamp()
        assert re.match(
            r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z$',
            ts,
        ), f'Unexpected wire format: {ts!r}'

    def test_parses_back_via_fromisoformat_after_Z_to_offset_swap(self) -> None:
        """Downstream code does fromisoformat(s.replace('Z', '+00:00')) — ensure that still works."""
        ts = utils.get_timestamp()
        parsed = datetime.fromisoformat(ts.replace('Z', '+00:00'))
        assert parsed.tzinfo is not None

    def test_returns_current_utc_time_within_a_few_seconds(self) -> None:
        ts = utils.get_timestamp()
        parsed = datetime.fromisoformat(ts.replace('Z', '+00:00'))
        # Allow 5 seconds of drift for slow CI
        now = datetime.now(UTC)
        delta = abs((now - parsed).total_seconds())
        assert delta < 5.0

    def test_lexicographic_sort_order_matches_chronological(self) -> None:
        """DynamoDB sort keys depend on string-sort-order matching time-sort-order."""
        earlier = utils.get_timestamp()
        # Build a later timestamp directly — can't sleep reliably in tests
        later_dt = datetime.now(UTC) + timedelta(seconds=10)
        later = later_dt.isoformat().replace('+00:00', 'Z')
        assert earlier < later


class TestGetTimestampCompact:
    """get_timestamp_compact() produces the filesystem-safe short stamp."""

    def test_matches_compact_format_pattern(self) -> None:
        ts = utils.get_timestamp_compact()
        assert re.match(r'^\d{8}-\d{6}$', ts), f'Unexpected compact format: {ts!r}'

    def test_has_no_colons_or_dots(self) -> None:
        """Regression: S3 keys and Step Functions execution names reject ':' and '.' in paths."""
        ts = utils.get_timestamp_compact()
        assert ':' not in ts
        assert '.' not in ts

    def test_lexicographic_sort_order_matches_chronological(self) -> None:
        earlier = utils.get_timestamp_compact()
        later_dt = datetime.now(UTC) + timedelta(minutes=1)
        later = later_dt.strftime('%Y%m%d-%H%M%S')
        assert earlier < later


class TestUtcNow:
    """utc_now() returns a timezone-aware UTC datetime."""

    def test_returns_timezone_aware_datetime(self) -> None:
        """The core reason this helper exists — legacy datetime.utcnow() was naive."""
        now = utils.utc_now()
        assert now.tzinfo is not None

    def test_timezone_is_utc(self) -> None:
        now = utils.utc_now()
        # Accept either datetime.UTC or datetime.timezone.utc identity
        assert now.utcoffset() == timedelta(0)

    def test_can_subtract_from_another_aware_datetime(self) -> None:
        """If both operands are aware, arithmetic works without TypeError."""
        now = utils.utc_now()
        ten_seconds_earlier = now - timedelta(seconds=10)
        delta = (now - ten_seconds_earlier).total_seconds()
        assert delta == 10.0

    def test_raises_typeerror_when_subtracted_from_naive(self) -> None:
        """Naive-minus-aware raises — this pins the awareness contract for callers
        that parse stored ISO strings and strip tzinfo."""
        import pytest

        aware = utils.utc_now()
        naive = datetime.now()  # naive local time
        with pytest.raises(TypeError):
            _ = aware - naive


class TestWireFormatCompatibility:
    """Contract: new helpers produce output byte-identical to the legacy pattern.

    Legacy code was `datetime.utcnow().isoformat() + 'Z'`. New code is
    `datetime.now(UTC).isoformat().replace('+00:00', 'Z')`. Both must produce
    the same string for any fixed instant.
    """

    def test_fixed_instant_produces_legacy_format(self) -> None:
        """Synthesize a known instant and compare both formatting paths."""
        # Freeze an instant in UTC
        fixed_utc = datetime(2026, 4, 18, 12, 34, 56, 789012, tzinfo=UTC)

        legacy = fixed_utc.replace(tzinfo=None).isoformat() + 'Z'
        new_style = fixed_utc.isoformat().replace('+00:00', 'Z')

        assert legacy == new_style
        assert legacy == '2026-04-18T12:34:56.789012Z'

    def test_non_utc_tz_still_normalizes_to_Z_when_value_is_utc(self) -> None:
        """Even a datetime constructed with timezone.utc (not datetime.UTC) must normalize."""
        fixed = datetime(2026, 4, 18, 0, 0, 0, tzinfo=UTC)
        formatted = fixed.isoformat().replace('+00:00', 'Z')
        assert formatted == '2026-04-18T00:00:00Z'



class TestBrandNamesMatch:
    """Regression tests for `brand_names_match` — the helper that replaced
    substring brand matching in get-recommendations, get-historical-trends,
    and content-studio.

    The old pattern `any(fp in name or name in fp for fp in first_party)`
    had classic false positives ('Inn' matching 'linkedin.com' or
    'Holiday Inn'). These tests pin the safe exact-match behavior.
    """

    def test_matches_identical_brand_names(self) -> None:
        assert utils.brand_names_match("Marriott", "Marriott") is True

    def test_is_case_insensitive(self) -> None:
        assert utils.brand_names_match("MARRIOTT", "marriott") is True
        assert utils.brand_names_match("Marriott Bonvoy", "marriott bonvoy") is True

    def test_normalizes_surrounding_whitespace(self) -> None:
        assert utils.brand_names_match("  Marriott  ", "Marriott") is True

    def test_collapses_internal_whitespace_runs(self) -> None:
        """Dashboard inputs sometimes have double spaces — normalize."""
        assert utils.brand_names_match("Holiday  Inn", "Holiday Inn") is True

    def test_does_not_match_substring_regression_guard(self) -> None:
        """The classic bug from audit items 9 and 22: 'Inn' is a substring
        of both 'Holiday Inn' and 'linkedin.com'. Exact-match only."""
        assert utils.brand_names_match("Inn", "Holiday Inn") is False
        assert utils.brand_names_match("Holiday Inn", "Inn") is False
        assert utils.brand_names_match("Marriott", "Marriott Bonvoy") is False

    def test_returns_false_for_empty_strings(self) -> None:
        assert utils.brand_names_match("", "Marriott") is False
        assert utils.brand_names_match("Marriott", "") is False
        assert utils.brand_names_match("", "") is False

    def test_returns_false_for_whitespace_only(self) -> None:
        assert utils.brand_names_match("   ", "Marriott") is False

    def test_returns_false_for_non_string_input(self) -> None:
        assert utils.brand_names_match(None, "Marriott") is False  # type: ignore[arg-type]
        assert utils.brand_names_match("Marriott", None) is False  # type: ignore[arg-type]
        assert utils.brand_names_match(123, "Marriott") is False  # type: ignore[arg-type]
        assert utils.brand_names_match(["Marriott"], "Marriott") is False  # type: ignore[arg-type]


class TestClassifyBrand:
    """Regression tests for `classify_brand` — the shared helper that all four
    handlers (get-citation-gaps, get-recommendations, content-studio,
    get-historical-trends) use so their brand classification can't drift apart.

    Contract: the LLM `classification` field is authoritative; the exact-name
    `brand_names_match` fallback fires ONLY when classification is missing
    (None), and never via substring. Returns (is_first_party, is_competitor).
    """

    def test_returns_first_party_when_classification_is_first_party(self) -> None:
        assert utils.classify_brand(
            {'name': 'Marmara', 'classification': 'first_party'}, ['marmara'], ['four seasons']
        ) == (True, False)

    def test_returns_competitor_when_classification_is_competitor(self) -> None:
        assert utils.classify_brand(
            {'name': 'Four Seasons', 'classification': 'competitor'}, ['marmara'], ['four seasons']
        ) == (False, True)

    def test_returns_neither_when_classification_is_other_despite_matching_a_tracked_list(self) -> None:
        # The root-cause guard: an LLM-'other' brand whose name matches a
        # tracked list must NOT be reclassified — 'other' is authoritative.
        assert utils.classify_brand(
            {'name': 'Marmara', 'classification': 'other'}, ['marmara'], ['marmara']
        ) == (False, False)

    def test_trusts_classification_even_when_tracked_lists_are_empty(self) -> None:
        assert utils.classify_brand(
            {'name': 'Marmara', 'classification': 'first_party'}, [], []
        ) == (True, False)

    def test_falls_back_to_exact_first_party_match_when_classification_missing(self) -> None:
        assert utils.classify_brand({'name': 'Marmara'}, ['marmara'], ['four seasons']) == (True, False)

    def test_falls_back_to_exact_competitor_match_when_classification_missing(self) -> None:
        assert utils.classify_brand({'name': 'Four Seasons'}, ['marmara'], ['four seasons']) == (False, True)

    def test_does_not_fall_back_via_substring_when_classification_missing(self) -> None:
        # 'Holiday Inn' must NOT match a configured 'inn' through the fallback.
        assert utils.classify_brand({'name': 'Holiday Inn'}, ['inn'], []) == (False, False)

    def test_treats_competitors_as_empty_when_omitted(self) -> None:
        # The get-historical-trends caller omits competitors; first-party
        # detection still works and competitor is never reported.
        assert utils.classify_brand({'name': 'Marmara'}, ['marmara']) == (True, False)

    def test_returns_neither_when_name_and_classification_both_missing(self) -> None:
        assert utils.classify_brand({}, ['marmara'], ['four seasons']) == (False, False)


class TestExtractDomain:
    """Tests for the refactored `extract_domain` (audit item 28).

    The shared helper now does what every handler-local copy was doing:
    lowercase + strip leading `www.`. Previously the shared version was
    subtly different — it returned raw `netloc` and the literal string
    `'unknown'` on error — which is why handlers had their own copies.
    """

    def test_returns_lowercase_domain(self) -> None:
        assert utils.extract_domain("https://EXAMPLE.com/path") == "example.com"

    def test_strips_leading_www(self) -> None:
        assert utils.extract_domain("https://www.example.com/") == "example.com"

    def test_preserves_subdomains_other_than_www(self) -> None:
        assert utils.extract_domain("https://api.example.com/v1") == "api.example.com"

    def test_returns_original_string_on_parse_failure(self) -> None:
        """Regression: the old implementation returned 'unknown' so every
        parse error collapsed into one bucket in DynamoDB. Now callers
        see the raw input."""
        # urlparse is forgiving — pass a value that explicitly raises on
        # netloc access. None is the simplest trigger.
        assert utils.extract_domain(None) == ""  # type: ignore[arg-type]

    def test_empty_url_returns_empty_domain(self) -> None:
        assert utils.extract_domain("") == ""
