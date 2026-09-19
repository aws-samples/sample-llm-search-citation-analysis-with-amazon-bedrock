"""
Brand visibility scoring shared by the KPI endpoints.

Single definition of the visibility formula that ``get-visibility-metrics``,
``get-persona-rankings`` and ``get-historical-trends`` previously each carried a
copy of (the persona-rankings copy even hard-coded the weights). Any change to
how a score is computed belongs here so the dashboard, the persona view, the
trend charts and the reports keep agreeing with each other.

Weights and caps come from ``shared.constants`` (VISIBILITY_*).

Since 2.4.0 this module also owns share of voice and the group summary
(mean first-party / competitor visibility, averaged share of voice, coverage,
per-keyword breakdown, cross-keyword brand ranking) that ``/visibility``
answers for a keyword group.
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from typing import Any

from shared.constants import (
    UNRANKED_SENTINEL,
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
    # rank) therefore still earns the capped minimum — kept for parity with the
    # historical scores already stored and charted.
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


def calculate_sentiment_agnostic_visibility_score(
    provider_count: int,
    total_mentions: int,
    best_rank: int,
    total_providers: int,
) -> float:
    """Three-factor variant used for time-series buckets, which carry no
    per-period sentiment aggregation. Same provider/rank/mention terms as
    :func:`calculate_visibility_score` without the sentiment term, so the
    maximum is 100 - VISIBILITY_SENTIMENT_WEIGHT (90 with the default weights).
    Rounded to one decimal.
    """
    return round(
        _provider_score(provider_count, total_providers)
        + _rank_score(best_rank)
        + _mention_score(total_mentions),
        1,
    )


# ---------------------------------------------------------------------------
# Share of voice, prominence and group (multi-keyword) summaries
# ---------------------------------------------------------------------------


def mean(values: Iterable[float]) -> float:
    """Arithmetic mean, 0.0 for an empty sequence (the KPI convention)."""
    items = [float(value) for value in values]
    return sum(items) / len(items) if items else 0.0


def calculate_share_of_voice(brand_mentions: dict[str, int], total_mentions: int) -> dict[str, float]:
    """Share of voice per brand: its mentions as a percentage of all mentions."""
    if total_mentions <= 0:
        return {}
    return {
        brand: round((count / total_mentions) * 100, 2)
        for brand, count in brand_mentions.items()
    }


def _finite_number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


def normalize_rank(value: Any) -> int | None:
    """Return a reporting-safe rank, excluding malformed and unranked values."""
    number = _finite_number(value)
    if number is None or not number.is_integer():
        return None
    rank = int(number)
    return rank if 1 <= rank < UNRANKED_SENTINEL else None


def _normalize_mean_rank(value: Any) -> float | None:
    number = _finite_number(value)
    if number is None or not 1 <= number < UNRANKED_SENTINEL:
        return None
    return number


def _normalize_position(value: Any) -> float | None:
    number = _finite_number(value)
    if number is None or number < 0:
        return None
    return number


def _rounded_available_mean(values: Iterable[float | None], digits: int = 2) -> float | None:
    available = [value for value in values if value is not None and math.isfinite(value)]
    return round(mean(available), digits) if available else None


def summarize_first_party_prominence(
    first_party_brands_by_answer: Iterable[Iterable[dict[str, Any]]],
) -> dict[str, Any]:
    """Summarize first-party placement once per provider answer.

    Rank shares use every answer as their denominator, including answers that
    do not mention a first-party brand. Mean rank and first position use only
    answers carrying the corresponding valid value.
    """
    answers = [list(brands) for brands in first_party_brands_by_answer]
    answer_ranks: list[int] = []
    answer_positions: list[float] = []
    mentioned_answers = 0

    for brands in answers:
        if brands:
            mentioned_answers += 1

        ranks = [rank for brand in brands if (rank := normalize_rank(brand.get('rank'))) is not None]
        if ranks:
            answer_ranks.append(min(ranks))

        positions = [
            position
            for brand in brands
            if (position := _normalize_position(brand.get('first_position'))) is not None
        ]
        if positions:
            answer_positions.append(min(positions))

    answer_count = len(answers)
    return {
        'answers': answer_count,
        'mentioned_answers': mentioned_answers,
        'rank_1_share': round(sum(rank == 1 for rank in answer_ranks) / answer_count * 100, 1) if answer_count else 0.0,
        'top_3_share': round(sum(rank <= 3 for rank in answer_ranks) / answer_count * 100, 1) if answer_count else 0.0,
        'mean_rank': _rounded_available_mean(answer_ranks),
        'mean_first_position': _rounded_available_mean(answer_positions),
    }


def _first_party_providers(metrics: dict[str, Any]) -> int:
    return max((int(brand.get('provider_count', 0)) for brand in metrics.get('first_party', [])), default=0)


def _first_party_best_rank(metrics: dict[str, Any]) -> int | None:
    ranks = [
        rank
        for brand in metrics.get('first_party', [])
        if (rank := normalize_rank(brand.get('best_rank'))) is not None
    ]
    return min(ranks, default=None)


def summarize_keyword_visibility(keyword: str, metrics: dict[str, Any] | None) -> dict[str, Any]:
    """One row of the per-keyword breakdown of a group summary."""
    if not metrics or 'error' in metrics or 'summary' not in metrics:
        return {
            'keyword': keyword,
            'has_data': False,
            'timestamp': None,
            'first_party_score': 0.0,
            'competitor_score': 0.0,
            'first_party_sov': 0.0,
            'competitor_sov': 0.0,
            'first_party_providers': 0,
            'total_mentions': 0,
            'first_party_mentioned': False,
            'first_party_best_rank': None,
            'answers': 0,
            'mentioned_answers': 0,
            'rank_1_share': 0.0,
            'top_3_share': 0.0,
            'mean_rank': None,
            'mean_first_position': None,
        }

    summary = metrics['summary']
    prominence = metrics.get('prominence', {})
    return {
        'keyword': keyword,
        'has_data': True,
        'timestamp': metrics.get('timestamp'),
        'first_party_score': float(summary.get('first_party_avg_score', 0.0)),
        'competitor_score': float(summary.get('competitor_avg_score', 0.0)),
        'first_party_sov': float(summary.get('first_party_total_sov', 0.0)),
        'competitor_sov': float(summary.get('competitor_total_sov', 0.0)),
        'first_party_providers': _first_party_providers(metrics),
        'total_mentions': int(metrics.get('total_mentions', 0)),
        'first_party_mentioned': bool(metrics.get('first_party')),
        'first_party_best_rank': _first_party_best_rank(metrics),
        'answers': int(prominence.get('answers', 0)),
        'mentioned_answers': int(prominence.get('mentioned_answers', 0)),
        'rank_1_share': float(_finite_number(prominence.get('rank_1_share')) or 0.0),
        'top_3_share': float(_finite_number(prominence.get('top_3_share')) or 0.0),
        'mean_rank': _normalize_mean_rank(prominence.get('mean_rank')),
        'mean_first_position': _normalize_position(prominence.get('mean_first_position')),
    }


def aggregate_brands_across_keywords(per_keyword: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Cross-keyword brand ranking: mean score, mention totals, provider union.

    A brand's group score is its mean visibility over the keywords where it
    appears; ``keyword_count`` says how many of the group's keywords mention
    it, so a brand scoring 90 on one keyword does not outrank one scoring 70
    on twelve without the reader seeing why.
    """
    rollup: dict[str, dict[str, Any]] = {}
    for metrics in per_keyword:
        for brand in metrics.get('brands', []) if metrics else []:
            key = str(brand.get('name', '')).lower()
            if not key:
                continue
            entry = rollup.setdefault(key, {
                'name': brand.get('name'),
                'classification': brand.get('classification', 'other'),
                'scores': [],
                'sovs': [],
                'providers': set(),
                'total_mentions': 0,
                'best_rank': None,
                'keyword_count': 0,
            })
            entry['scores'].append(float(brand.get('visibility_score', 0.0)))
            entry['sovs'].append(float(brand.get('share_of_voice', 0.0)))
            entry['providers'].update(brand.get('providers', []))
            entry['total_mentions'] += int(brand.get('total_mentions', 0))
            rank = normalize_rank(brand.get('best_rank'))
            if rank is not None and (entry['best_rank'] is None or rank < entry['best_rank']):
                entry['best_rank'] = rank
            entry['keyword_count'] += 1

    brands = [
        {
            'name': entry['name'],
            'classification': entry['classification'],
            'visibility_score': round(mean(entry['scores']), 1),
            'share_of_voice': round(mean(entry['sovs']), 2),
            'provider_count': len(entry['providers']),
            'providers': sorted(entry['providers']),
            'total_mentions': entry['total_mentions'],
            'best_rank': entry['best_rank'],
            'keyword_count': entry['keyword_count'],
        }
        for entry in rollup.values()
    ]
    brands.sort(key=lambda brand: (-brand['visibility_score'], -brand['keyword_count'], brand['name'].lower()))
    return brands


def summarize_group_visibility(keywords: list[str], per_keyword: list[dict[str, Any]], total_providers: int) -> dict[str, Any]:
    """Group-level KPIs from per-keyword metrics (same order as ``keywords``).

    Averages cover only keywords that have analysis data. Share of voice and
    answer-level rank shares are averaged, not pooled, so each keyword keeps
    the same weight in the group summary.
    """
    rows = [summarize_keyword_visibility(keyword, metrics) for keyword, metrics in zip(keywords, per_keyword, strict=True)]
    with_data = [row for row in rows if row['has_data']]
    with_answers = [row for row in with_data if row['answers'] > 0]
    brands = aggregate_brands_across_keywords(metrics for metrics in per_keyword if metrics and 'summary' in metrics)

    coverage = mean(1.0 if row['first_party_mentioned'] else 0.0 for row in with_data) * 100
    provider_coverage = mean(row['first_party_providers'] / total_providers for row in with_data) * 100 if total_providers > 0 else 0.0

    return {
        'timestamp': max((row['timestamp'] for row in with_data if row['timestamp']), default=None),
        'keywords_analyzed': len(rows),
        'keywords_with_data': len(with_data),
        'keywords': rows,
        'brands': brands,
        'first_party': [brand for brand in brands if brand['classification'] == 'first_party'],
        'competitors': [brand for brand in brands if brand['classification'] == 'competitor'],
        'others': [brand for brand in brands if brand['classification'] == 'other'],
        'summary': {
            'first_party_avg_score': round(mean(row['first_party_score'] for row in with_data), 1),
            'competitor_avg_score': round(mean(row['competitor_score'] for row in with_data), 1),
            'first_party_avg_sov': round(mean(row['first_party_sov'] for row in with_data), 2),
            'competitor_avg_sov': round(mean(row['competitor_sov'] for row in with_data), 2),
            'coverage_rate': round(coverage, 1),
            'provider_coverage': round(provider_coverage, 1),
            'first_party_mean_best_rank': _rounded_available_mean(
                row['first_party_best_rank'] for row in with_data
            ),
            'rank_1_share': round(mean(row['rank_1_share'] for row in with_answers), 1),
            'top_3_share': round(mean(row['top_3_share'] for row in with_answers), 1),
            'mean_rank': _rounded_available_mean(row['mean_rank'] for row in with_data),
            'mean_first_position': _rounded_available_mean(
                row['mean_first_position'] for row in with_data
            ),
        },
    }
