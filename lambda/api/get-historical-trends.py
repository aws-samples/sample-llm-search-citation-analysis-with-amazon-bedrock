"""
Historical Trends API

Tracks visibility metrics over time to show improvement or decline.
Aggregates data by day/week/month for trend analysis.

Features:
- Time-series visibility scores
- Trend direction detection (improving/declining/stable)
- Period-over-period comparison
- Provider-specific trends
"""

import concurrent.futures
import logging
import math
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any

import boto3

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import success_response
from shared.constants import (
    TREND_DIRECTION_DECLINING_SLOPE,
    TREND_DIRECTION_IMPROVING_SLOPE,
    UNRANKED_SENTINEL,
)
from shared.decorators import api_handler, validate
from shared.dynamo_decimal import to_int
from shared.providers import get_enabled_provider_count
from shared.scope_params import (
    SCOPE_QUERY_PARAMS,
    ReportScope,
    all_active_scope,
    keywords_table_name,
    query_keyword_rows,
    scope_from_request,
)
from shared.utils import brand_names_match, get_brand_config, utc_now
from shared.visibility_score import (
    calculate_sentiment_agnostic_visibility_score,
    mean,
    normalize_rank,
    summarize_first_party_prominence,
)

# Bounded parallelism for the per-keyword trend fan-out. 10 workers keeps the
# DynamoDB RCU pressure reasonable on the SearchResults table while collapsing
# 20 sequential queries into ~2 rounds of parallel work.
_TRENDS_MAX_WORKERS = 10

# Fan-out ceilings. The unscoped dashboard keeps its historical breadth of 20
# keywords; an explicit group / id scope may cover up to 100 (the
# `keyword_ids` cap), which fits the 29s API budget with projected queries.
_ALL_KEYWORDS_CAP = 20
_SCOPE_KEYWORDS_CAP = 100

# Only the fields the buckets use; the LLM response text stays in the table.
# The projected brands include rank and first_position.
_TREND_PROJECTION = '#ts, provider, brands'

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = os.environ['DYNAMODB_TABLE_SEARCH_RESULTS']
KEYWORDS_TABLE = keywords_table_name()


def get_trend_direction(values: list[float]) -> str:
    """Determine trend direction from a series of values.

    Slope thresholds are tuned for the 0-100 visibility range. See
    `shared.constants.TREND_DIRECTION_{IMPROVING,DECLINING}_SLOPE`.
    """
    if len(values) < 2:
        return 'stable'

    # Calculate simple linear regression slope
    n = len(values)
    x_mean = (n - 1) / 2
    y_mean = sum(values) / n

    numerator = sum((i - x_mean) * (values[i] - y_mean) for i in range(n))
    denominator = sum((i - x_mean) ** 2 for i in range(n))

    if denominator == 0:
        return 'stable'

    slope = numerator / denominator

    if slope > TREND_DIRECTION_IMPROVING_SLOPE:
        return 'improving'
    if slope < TREND_DIRECTION_DECLINING_SLOPE:
        return 'declining'
    return 'stable'


def _is_first_party(brand: dict[str, Any], first_party: list[str]) -> bool:
    classification = brand.get('classification')
    name = str(brand.get('name', '')).lower()
    return classification == 'first_party' or (
        classification is None
        and any(brand_names_match(name, configured_name) for configured_name in first_party)
    )


def _period_key(timestamp: str, period: str) -> str | None:
    try:
        parsed = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
    except (ValueError, TypeError):
        return None
    if period == 'day':
        return parsed.strftime('%Y-%m-%d')
    if period == 'week':
        return parsed.strftime('%Y-W%W')
    return parsed.strftime('%Y-%m')


def aggregate_by_period(items: list[dict], period: str, config: dict) -> list[dict]:
    """Aggregate visibility and answer-level prominence by time period."""
    tracked_brands = config.get('tracked_brands', {})
    first_party = [str(brand).lower() for brand in tracked_brands.get('first_party', [])]

    period_data: dict[str, list[dict]] = defaultdict(list)
    for item in items:
        period_key = _period_key(item.get('timestamp', ''), period)
        if period_key is not None:
            period_data[period_key].append(item)

    # The enabled-provider count is the score denominator and does not change
    # within a request, so resolve it once rather than once per period bucket.
    total_providers = get_enabled_provider_count()
    trend_data = []

    for period_key in sorted(period_data):
        items_in_period = period_data[period_key]
        timestamps = {item.get('timestamp', '') for item in items_in_period}
        fp_mentions = 0
        fp_providers = set()
        fp_best_rank = UNRANKED_SENTINEL
        first_party_brands_by_answer: list[list[dict[str, Any]]] = []

        for item in items_in_period:
            provider = item.get('provider', '')
            answer_brands = [
                brand for brand in item.get('brands', [])
                if _is_first_party(brand, first_party)
            ]
            first_party_brands_by_answer.append(answer_brands)

            for brand in answer_brands:
                fp_mentions += to_int(brand.get('mention_count'), 1)
                fp_providers.add(provider)
                rank = normalize_rank(brand.get('rank'))
                if rank is not None:
                    fp_best_rank = min(fp_best_rank, rank)

        visibility_score = calculate_sentiment_agnostic_visibility_score(
            len(fp_providers), fp_mentions, fp_best_rank, total_providers
        )
        prominence = summarize_first_party_prominence(first_party_brands_by_answer)

        trend_data.append({
            'period': period_key,
            'visibility_score': visibility_score,
            'total_mentions': fp_mentions,
            'provider_count': len(fp_providers),
            'best_rank': fp_best_rank if fp_best_rank < UNRANKED_SENTINEL else None,
            'analysis_runs': len(timestamps),
            **prominence,
        })

    return trend_data


def _fetch_keyword_items(keyword: str) -> list[dict]:
    """Fetch raw search-result rows for a keyword for parallel fan-out.

    Returns an empty list on query failure so one bad keyword cannot fail the
    whole trends dashboard. Errors remain logged for operational visibility.
    """
    try:
        return query_keyword_rows(dynamodb.Table(SEARCH_RESULTS_TABLE), keyword, _TREND_PROJECTION)
    except Exception as exc:
        logger.error(f"Error fetching trend items for keyword {keyword!r}: {exc}")
        return []


def _build_trend_from_items(
    keyword: str,
    items: list[dict],
    config: dict,
    period: str,
    days: int,
) -> dict[str, Any]:
    """Build the trend payload from an already-fetched items list."""
    if not items:
        return {"error": f"No data found for keyword: {keyword}"}

    cutoff = utc_now().replace(tzinfo=None) - timedelta(days=days)
    cutoff_str = cutoff.isoformat()
    filtered_items = [
        item for item in items
        if item.get('timestamp', '') >= cutoff_str
    ]

    if not filtered_items:
        filtered_items = items

    trend_data = aggregate_by_period(filtered_items, period, config)
    return {
        'keyword': keyword,
        'period_type': period,
        'days_analyzed': days,
        **summarize_series(trend_data),
    }


def summarize_series(trend_data: list[dict[str, Any]]) -> dict[str, Any]:
    """Direction, period-over-period change and averages of one score series."""
    scores = [data_point['visibility_score'] for data_point in trend_data]
    trend_direction = get_trend_direction(scores)

    if len(trend_data) >= 2:
        current = trend_data[-1]['visibility_score']
        previous = trend_data[-2]['visibility_score']
        change = round(current - previous, 1)
        change_pct = round((change / previous * 100), 1) if previous > 0 else 0
    else:
        change = 0
        change_pct = 0

    return {
        'data_points': len(trend_data),
        'trend_data': trend_data,
        'trend_direction': trend_direction,
        'summary': {
            'current_score': trend_data[-1]['visibility_score'] if trend_data else 0,
            'previous_score': trend_data[-2]['visibility_score'] if len(trend_data) >= 2 else 0,
            'change': change,
            'change_percent': change_pct,
            'average_score': round(mean(scores), 1),
            'max_score': max(scores) if scores else 0,
            'min_score': min(scores) if scores else 0,
        },
    }


def _finite_float(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) else None


def _mean_or_none(values: list[float]) -> float | None:
    return round(mean(values), 2) if values else None


def build_group_series(trends: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Build an equal-keyword group series for each available period bucket."""
    buckets: dict[str, dict[str, Any]] = {}
    for trend in trends:
        for point in trend.get('trend_data', []):
            bucket = buckets.setdefault(point['period'], {
                'scores': [],
                'total_mentions': 0,
                'provider_count': 0,
                'best_rank': None,
                'analysis_runs': 0,
                'answers': 0,
                'mentioned_answers': 0,
                'rank_1_shares': [],
                'top_3_shares': [],
                'mean_ranks': [],
                'mean_first_positions': [],
            })
            bucket['scores'].append(float(point.get('visibility_score', 0)))
            bucket['total_mentions'] += int(point.get('total_mentions', 0))
            bucket['provider_count'] = max(bucket['provider_count'], int(point.get('provider_count', 0)))
            rank = normalize_rank(point.get('best_rank'))
            if rank is not None and (bucket['best_rank'] is None or rank < bucket['best_rank']):
                bucket['best_rank'] = rank
            bucket['analysis_runs'] += int(point.get('analysis_runs', 0))
            answers = int(point.get('answers', 0))
            bucket['answers'] += answers
            bucket['mentioned_answers'] += int(point.get('mentioned_answers', 0))
            if answers > 0:
                bucket['rank_1_shares'].append(float(point.get('rank_1_share', 0.0)))
                bucket['top_3_shares'].append(float(point.get('top_3_share', 0.0)))
            mean_rank = _finite_float(point.get('mean_rank'))
            if mean_rank is not None and 1 <= mean_rank < UNRANKED_SENTINEL:
                bucket['mean_ranks'].append(mean_rank)
            mean_position = _finite_float(point.get('mean_first_position'))
            if mean_position is not None and mean_position >= 0:
                bucket['mean_first_positions'].append(mean_position)

    return [
        {
            'period': period,
            'visibility_score': round(mean(bucket['scores']), 1),
            'total_mentions': bucket['total_mentions'],
            'provider_count': bucket['provider_count'],
            'best_rank': bucket['best_rank'],
            'analysis_runs': bucket['analysis_runs'],
            'answers': bucket['answers'],
            'mentioned_answers': bucket['mentioned_answers'],
            'rank_1_share': round(mean(bucket['rank_1_shares']), 1),
            'top_3_share': round(mean(bucket['top_3_shares']), 1),
            'mean_rank': _mean_or_none(bucket['mean_ranks']),
            'mean_first_position': _mean_or_none(bucket['mean_first_positions']),
            'keywords_with_data': len(bucket['scores']),
        }
        for period, bucket in sorted(buckets.items())
    ]


def get_historical_trends(keyword: str, config: dict, period: str = 'day', days: int = 30) -> dict[str, Any]:
    """Get historical trend data for a keyword."""
    items = _fetch_keyword_items(keyword)
    return _build_trend_from_items(keyword, items, config, period, days)


def _trend_scope(scope: ReportScope | None) -> tuple[ReportScope, int]:
    """Resolve the active-keyword scope and its request cap."""
    if scope is None:
        return all_active_scope(dynamodb.Table(KEYWORDS_TABLE)), _ALL_KEYWORDS_CAP
    return scope, _SCOPE_KEYWORDS_CAP


def get_all_keywords_trends(
    config: dict,
    period: str = 'day',
    days: int = 30,
    scope: ReportScope | None = None,
) -> dict[str, Any]:
    """Trend summary across the active keywords of a scope (default: all)."""
    resolved, cap = _trend_scope(scope)
    keywords = list(resolved.keywords)
    keywords_to_query = keywords[:cap]
    scope_block = resolved.describe()
    if not keywords_to_query:
        return {
            'scope': scope_block,
            'period_type': period,
            'days_analyzed': days,
            'keywords_analyzed': 0,
            'keywords_truncated': False,
            'keyword_trends': [],
            'overall': {
                'improving_count': 0,
                'declining_count': 0,
                'stable_count': 0,
                'avg_score': 0,
            },
            **summarize_series([]),
        }

    workers = min(_TRENDS_MAX_WORKERS, len(keywords_to_query))
    items_by_keyword: dict[str, list[dict]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        future_to_keyword = {
            pool.submit(_fetch_keyword_items, keyword): keyword
            for keyword in keywords_to_query
        }
        for future in concurrent.futures.as_completed(future_to_keyword):
            keyword = future_to_keyword[future]
            try:
                items_by_keyword[keyword] = future.result()
            except Exception as exc:
                logger.error(f"Trend fan-out future failed for {keyword!r}: {exc}")
                items_by_keyword[keyword] = []

    keyword_trends = []
    full_trends = []
    for keyword in keywords_to_query:
        items = items_by_keyword.get(keyword, [])
        trend = _build_trend_from_items(keyword, items, config, period, days)
        if 'error' not in trend:
            full_trends.append(trend)
            keyword_trends.append({
                'keyword': keyword,
                'trend_direction': trend['trend_direction'],
                'current_score': trend['summary']['current_score'],
                'change': trend['summary']['change'],
                'change_percent': trend['summary']['change_percent']
            })

    keyword_trends.sort(key=lambda item: item['current_score'], reverse=True)

    improving = len([item for item in keyword_trends if item['trend_direction'] == 'improving'])
    declining = len([item for item in keyword_trends if item['trend_direction'] == 'declining'])
    stable = len([item for item in keyword_trends if item['trend_direction'] == 'stable'])

    return {
        'scope': scope_block,
        'period_type': period,
        'days_analyzed': days,
        'keywords_analyzed': len(keyword_trends),
        'keywords_truncated': len(keywords) > len(keywords_to_query),
        'keyword_trends': keyword_trends,
        'overall': {
            'improving_count': improving,
            'declining_count': declining,
            'stable_count': stable,
            'avg_score': round(mean(item['current_score'] for item in keyword_trends), 1),
        },
        **summarize_series(build_group_series(full_trends)),
    }


@api_handler
@validate({
    **SCOPE_QUERY_PARAMS,
    'period': {'type': str, 'choices': ['day', 'week', 'month'], 'default': 'day'},
    'days': {'type': int, 'min': 1, 'max': 365, 'default': 30}
})
def handler(
    event: dict[str, Any],
    context: Any,
    period: str = 'day',
    days: int = 30,
    **scope_params: str | None,
) -> dict[str, Any]:
    """Return historical trends for one keyword or an aggregated scope."""
    report_scope, rejected = scope_from_request(event, scope_params, dynamodb.Table(KEYWORDS_TABLE))
    if rejected:
        return rejected

    config = get_brand_config()
    if report_scope is not None and report_scope.is_single_keyword:
        result = get_historical_trends(report_scope.keywords[0], config, period, days)
    else:
        result = get_all_keywords_trends(config, period, days, scope=report_scope)

    return success_response(result, event)
