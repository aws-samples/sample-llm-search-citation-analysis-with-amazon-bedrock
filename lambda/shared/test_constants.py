"""
Tests for shared.constants.

These pin the critical invariants that the handlers consuming these
constants rely on. A regression here would silently break scoring math
across visibility-metrics and historical-trends.
"""

from __future__ import annotations

from shared import constants


class TestVisibilityScoreWeights:
    """The four visibility weights must sum to 100 — the formula is a
    weighted average, not independent factors."""

    def test_weights_sum_to_one_hundred(self) -> None:
        total = (
            constants.VISIBILITY_PROVIDER_WEIGHT
            + constants.VISIBILITY_RANK_WEIGHT
            + constants.VISIBILITY_MENTION_WEIGHT
            + constants.VISIBILITY_SENTIMENT_WEIGHT
        )
        assert total == 100

    def test_provider_weight_is_largest(self) -> None:
        """Provider coverage dominates the score — if anyone rebalances
        they must update the comment in get-visibility-metrics.py too."""
        weights = [
            constants.VISIBILITY_PROVIDER_WEIGHT,
            constants.VISIBILITY_RANK_WEIGHT,
            constants.VISIBILITY_MENTION_WEIGHT,
            constants.VISIBILITY_SENTIMENT_WEIGHT,
        ]
        assert constants.VISIBILITY_PROVIDER_WEIGHT == max(weights)

    def test_all_weights_are_positive(self) -> None:
        weights = [
            constants.VISIBILITY_PROVIDER_WEIGHT,
            constants.VISIBILITY_RANK_WEIGHT,
            constants.VISIBILITY_MENTION_WEIGHT,
            constants.VISIBILITY_SENTIMENT_WEIGHT,
        ]
        assert all(w > 0 for w in weights)


class TestVisibilityRankMath:
    """The rank inverse formula depends on these two constants being
    coupled: VISIBILITY_RANK_INVERSE_BASE == VISIBILITY_RANK_CAP + 1.
    The '+1' makes rank=1 score maximum and rank=10 score zero."""

    def test_rank_inverse_base_equals_rank_cap_plus_one(self) -> None:
        assert (
            constants.VISIBILITY_RANK_INVERSE_BASE
            == constants.VISIBILITY_RANK_CAP + 1
        )

    def test_unranked_sentinel_is_above_rank_cap(self) -> None:
        """Sentinel must be > cap so min() against it in reducers stays
        the sentinel until a real rank shows up."""
        assert constants.UNRANKED_SENTINEL > constants.VISIBILITY_RANK_CAP


class TestMentionLogBase:
    """`VISIBILITY_MENTION_LOG_BASE == VISIBILITY_MENTION_SATURATION_COUNT + 1`
    is the invariant that makes `math.log(n + 1) / math.log(log_base)` saturate
    to exactly 1.0 when n == saturation_count. If these drift the mention
    component will no longer saturate at the documented count."""

    def test_log_base_equals_saturation_plus_one(self) -> None:
        assert (
            constants.VISIBILITY_MENTION_LOG_BASE
            == constants.VISIBILITY_MENTION_SATURATION_COUNT + 1
        )


class TestTrendDirectionSlopes:
    """Thresholds are symmetric — if they drift asymmetric, the dashboard
    will feel biased toward one direction."""

    def test_improving_and_declining_slopes_are_symmetric(self) -> None:
        assert (
            constants.TREND_DIRECTION_IMPROVING_SLOPE
            == -constants.TREND_DIRECTION_DECLINING_SLOPE
        )

    def test_improving_slope_is_positive(self) -> None:
        assert constants.TREND_DIRECTION_IMPROVING_SLOPE > 0

    def test_declining_slope_is_negative(self) -> None:
        assert constants.TREND_DIRECTION_DECLINING_SLOPE < 0


class TestBusinessLimits:
    """Business caps — both are positive integers."""

    def test_max_citations_is_positive(self) -> None:
        assert constants.MAX_CITATIONS_PER_KEYWORD_DEFAULT > 0

    def test_max_query_prompts_is_positive(self) -> None:
        assert constants.MAX_QUERY_PROMPTS_DEFAULT > 0
