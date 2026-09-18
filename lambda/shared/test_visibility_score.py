"""
Tests for shared.visibility_score.

The expected values below were captured from the three handler-local copies of
the formula (get-visibility-metrics, get-persona-rankings, get-historical-trends)
immediately before they were replaced by this module, so these tests pin the
consolidation to the numbers the dashboard was already showing.
"""

from __future__ import annotations

import os
import sys

import pytest

# Load by bare name to avoid triggering shared/__init__.py's boto3 import.
sys.path.insert(0, os.path.dirname(__file__))

import visibility_score  # type: ignore[import-not-found]


class TestCalculateVisibilityScore:
    @pytest.mark.parametrize(
        ('provider_count', 'total_mentions', 'best_rank', 'avg_sentiment', 'total_providers', 'expected'),
        [
            (4, 50, 1, 1.0, 4, 100.0),
            (2, 5, 3, 0.0, 4, 58.1),
            (1, 1, 10, -1.0, 4, 16.5),
            (3, 120, 11, 0.5, 4, 60.5),
            (4, 7, 2, 0.25, 9, 61.6),
        ],
    )
    def test_matches_the_scores_the_handlers_computed_before_consolidation(
        self, provider_count, total_mentions, best_rank, avg_sentiment, total_providers, expected
    ) -> None:
        score = visibility_score.calculate_visibility_score(
            provider_count, total_mentions, best_rank, avg_sentiment, total_providers
        )

        assert score == expected

    def test_returns_100_for_full_coverage_top_rank_saturated_mentions_and_positive_sentiment(self) -> None:
        assert visibility_score.calculate_visibility_score(4, 50, 1, 1.0, 4) == 100.0

    def test_scores_an_unmentioned_brand_at_the_rank_floor_plus_neutral_sentiment(self) -> None:
        # No providers, no mentions, unranked sentinel: only the capped rank
        # minimum (3.0) and the neutral sentiment midpoint (5.0) remain.
        assert visibility_score.calculate_visibility_score(0, 0, 9999, 0.0, 4) == 8.0

    def test_drops_the_provider_term_when_no_providers_are_enabled(self) -> None:
        with_providers = visibility_score.calculate_visibility_score(2, 5, 3, 0.0, 4)
        without_providers = visibility_score.calculate_visibility_score(2, 5, 3, 0.0, 0)

        assert without_providers == 38.1
        assert with_providers - without_providers == pytest.approx(20.0)

    def test_caps_the_mention_term_at_the_saturation_count(self) -> None:
        saturated = visibility_score.calculate_visibility_score(0, 50, 9999, 0.0, 4)
        beyond = visibility_score.calculate_visibility_score(0, 5000, 9999, 0.0, 4)

        assert saturated == beyond


class TestCalculateSentimentAgnosticVisibilityScore:
    @pytest.mark.parametrize(
        ('provider_count', 'total_mentions', 'best_rank', 'total_providers', 'expected'),
        [
            (4, 50, 1, 4, 90.0),
            (2, 5, 3, 4, 53.1),
            (1, 1, 10, 4, 16.5),
            (3, 120, 11, 4, 53.0),
            (2, 5, 3, 0, 33.1),
        ],
    )
    def test_matches_the_scores_historical_trends_computed_before_consolidation(
        self, provider_count, total_mentions, best_rank, total_providers, expected
    ) -> None:
        score = visibility_score.calculate_sentiment_agnostic_visibility_score(
            provider_count, total_mentions, best_rank, total_providers
        )

        assert score == expected

    def test_tops_out_at_90_because_the_sentiment_term_is_omitted(self) -> None:
        assert visibility_score.calculate_sentiment_agnostic_visibility_score(4, 50, 1, 4) == 90.0

    def test_scores_an_unmentioned_brand_at_the_rank_floor_only(self) -> None:
        assert visibility_score.calculate_sentiment_agnostic_visibility_score(0, 0, 9999, 4) == 3.0

    def test_equals_the_four_factor_score_minus_the_neutral_sentiment_term(self) -> None:
        four_factor = visibility_score.calculate_visibility_score(2, 5, 3, 0.0, 4)
        three_factor = visibility_score.calculate_sentiment_agnostic_visibility_score(2, 5, 3, 4)

        assert four_factor - three_factor == pytest.approx(5.0)


class TestSentimentToScore:
    @pytest.mark.parametrize(
        ('label', 'expected'),
        [
            ('positive', 1.0),
            ('Positive', 1.0),
            ('neutral', 0.0),
            ('negative', -1.0),
            ('mixed', 0.0),
        ],
    )
    def test_maps_known_labels_case_insensitively(self, label, expected) -> None:
        assert visibility_score.sentiment_to_score(label) == expected

    def test_treats_missing_label_as_neutral(self) -> None:
        assert visibility_score.sentiment_to_score(None) == 0.0
        assert visibility_score.sentiment_to_score('') == 0.0

    def test_treats_unknown_label_as_neutral(self) -> None:
        assert visibility_score.sentiment_to_score('weird') == 0.0
