"""
The legacy four-factor visibility score, still behind ``/persona-rankings``.

New code reports the KPIs of ``shared.kpi_engine``
(``docs/kpi-definitions.md``). This module goes when the persona view is
migrated; do not use it for anything new.

Weights and caps come from ``shared.constants`` (VISIBILITY_*).
"""

from __future__ import annotations

import math
from typing import Any

from shared.constants import (
    VISIBILITY_MENTION_LOG_BASE,
    VISIBILITY_MENTION_WEIGHT,
    VISIBILITY_PROVIDER_WEIGHT,
    VISIBILITY_RANK_CAP,
    VISIBILITY_RANK_INVERSE_BASE,
    VISIBILITY_RANK_WEIGHT,
    VISIBILITY_SENTIMENT_WEIGHT,
)

_SENTIMENT_SCORES = {
    'positive': 1.0,
    'neutral': 0.0,
    'negative': -1.0,
    'mixed': 0.0,
}


def sentiment_to_score(sentiment: str | None) -> float:
    """Map an extractor sentiment label to the -1..1 scale used by the score.

    Case-insensitive; missing or unknown labels count as neutral (0.0).
    """
    if not sentiment:
        return 0.0
    return _SENTIMENT_SCORES.get(sentiment.lower(), 0.0)


def _provider_score(provider_count: int, total_providers: int) -> float:
    if total_providers <= 0:
        return 0.0
    return (provider_count / total_providers) * VISIBILITY_PROVIDER_WEIGHT


def _rank_score(best_rank: int) -> float:
    # Inverse of rank, capped at VISIBILITY_RANK_CAP. An unranked brand (sentinel
    # rank) therefore still earns the capped minimum.
    capped_rank = min(best_rank, VISIBILITY_RANK_CAP)
    return max(0, (VISIBILITY_RANK_INVERSE_BASE - capped_rank) / VISIBILITY_RANK_CAP) * VISIBILITY_RANK_WEIGHT


def _mention_score(total_mentions: int) -> float:
    # Logarithmic saturation at VISIBILITY_MENTION_SATURATION_COUNT mentions.
    return min(math.log(total_mentions + 1) / math.log(VISIBILITY_MENTION_LOG_BASE), 1) * VISIBILITY_MENTION_WEIGHT


def calculate_visibility_score(
    provider_count: int,
    total_mentions: int,
    best_rank: int,
    avg_sentiment_score: float,
    total_providers: int,
) -> float:
    """Four-factor visibility score (0-100).

    - Provider coverage: VISIBILITY_PROVIDER_WEIGHT * providers mentioning / providers enabled
    - Ranking position: VISIBILITY_RANK_WEIGHT * inverse best rank, capped at VISIBILITY_RANK_CAP
    - Mention frequency: VISIBILITY_MENTION_WEIGHT * log-saturating mention count
    - Sentiment: VISIBILITY_SENTIMENT_WEIGHT * average sentiment rescaled from -1..1 to 0..1

    Rounded to one decimal.
    """
    sentiment_score = ((avg_sentiment_score + 1) / 2) * VISIBILITY_SENTIMENT_WEIGHT
    return round(
        _provider_score(provider_count, total_providers)
        + _rank_score(best_rank)
        + _mention_score(total_mentions)
        + sentiment_score,
        1,
    )


def finite_number(value: Any) -> float | None:
    """``value`` as a finite float; ``None`` for missing, boolean, non-numeric, NaN and infinite values."""
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None
