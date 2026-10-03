"""
Tests for shared.constants.

These pin the invariants that the handlers consuming these constants rely on.
"""

from __future__ import annotations

import pytest

from shared import constants


class TestBusinessLimits:
    """Business caps — both are positive integers."""

    def test_max_citations_is_positive(self) -> None:
        assert constants.MAX_CITATIONS_PER_KEYWORD_DEFAULT > 0

    def test_max_query_prompts_is_positive(self) -> None:
        assert constants.MAX_QUERY_PROMPTS_DEFAULT > 0


class TestPriorityRank:
    """Recommendation priorities sort high, medium, low; anything else sorts with low."""

    @pytest.mark.parametrize(('priority', 'expected'), [
        pytest.param('high', 0, id='high-first'),
        pytest.param('medium', 1, id='medium-second'),
        pytest.param('low', 2, id='low-last'),
        pytest.param('normal', 2, id='keyword-priority-normal-sorts-with-low'),
        pytest.param(None, 2, id='missing-sorts-with-low'),
        pytest.param('HIGH', 2, id='case-sensitive'),
    ])
    def test_ranks_each_priority(self, priority, expected) -> None:
        assert constants.priority_rank(priority) == expected
