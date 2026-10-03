"""Tests for shared.visibility_score.finite_number."""

from __future__ import annotations

import pytest

from shared import visibility_score


class TestFiniteNumber:
    @pytest.mark.parametrize(
        ('value', 'expected'),
        [
            (3, 3.0),
            ('2.5', 2.5),
            (0, 0.0),
            (None, None),
            (True, None),
            ('rank', None),
            (float('nan'), None),
            (float('inf'), None),
            (10 ** 400, None),
            ([], None),
        ],
    )
    def test_reads_only_finite_numbers(self, value, expected) -> None:
        assert visibility_score.finite_number(value) == expected
