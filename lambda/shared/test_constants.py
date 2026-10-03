"""
Tests for shared.constants.

These pin the invariants that the handlers consuming these constants rely on.
"""

from __future__ import annotations

from shared import constants


class TestBusinessLimits:
    """Business caps — both are positive integers."""

    def test_max_citations_is_positive(self) -> None:
        assert constants.MAX_CITATIONS_PER_KEYWORD_DEFAULT > 0

    def test_max_query_prompts_is_positive(self) -> None:
        assert constants.MAX_QUERY_PROMPTS_DEFAULT > 0
