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
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import success_response
from shared.constants import (
    TREND_DIRECTION_DECLINING_SLOPE,
    TREND_DIRECTION_IMPROVING_SLOPE,
    UNRANKED_SENTINEL,
    VISIBILITY_MENTION_LOG_BASE,
    VISIBILITY_MENTION_WEIGHT,
    VISIBILITY_PROVIDER_WEIGHT,
    VISIBILITY_RANK_CAP,
    VISIBILITY_RANK_INVERSE_BASE,
    VISIBILITY_RANK_WEIGHT,
)
from shared.decorators import api_handler, validate
from shared.dynamo_decimal import to_int
from shared.providers import get_enabled_provider_count
from shared.utils import brand_names_match, get_brand_config, utc_now

# Bounded parallelism for the per-keyword trend fan-out. 10 workers keeps the
# DynamoDB RCU pressure reasonable on the SearchResults table while collapsing
# 20 sequential queries into ~2 rounds of parallel work.
_TRENDS_MAX_WORKERS = 10

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = os.environ['DYNAMODB_TABLE_SEARCH_RESULTS']
KEYWORDS_TABLE = os.environ.get('DYNAMODB_TABLE_KEYWORDS')  # Optional for fallback


def calculate_visibility_score(provider_count: int, total_mentions: int, best_rank: int, total_providers: int | None = None) -> float:
    """Calculate visibility score (0-100).

    This variant is sentiment-agnostic (historical-trends doesn't carry
    per-period sentiment aggregation); the sentiment weight is folded
    into the other three weights proportionally:
        provider: 40, rank: 30, mentions: 20, total = 90 (out of 100).
    See `get-visibility-metrics.py::calculate_visibility_score` for the
    full 4-factor version. Constants are shared in `shared.constants`.
    """
    import math
    if total_providers is None:
        total_providers = get_enabled_provider_count()
    provider_score = (
        (provider_count / total_providers) * VISIBILITY_PROVIDER_WEIGHT
        if total_providers > 0 else 0
    )
    capped_rank = min(best_rank, VISIBILITY_RANK_CAP)
    rank_score = max(0, (VISIBILITY_RANK_INVERSE_BASE - capped_rank) / VISIBILITY_RANK_CAP) * VISIBILITY_RANK_WEIGHT
    mention_score = (
        min(math.log(total_mentions + 1) / math.log(VISIBILITY_MENTION_LOG_BASE), 1)
        * VISIBILITY_MENTION_WEIGHT
    )
    return round(provider_score + rank_score + mention_score, 1)


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
    elif slope < TREND_DIRECTION_DECLINING_SLOPE:
        return 'declining'
    return 'stable'


def aggregate_by_period(items: list[dict], period: str, config: dict) -> list[dict]:
    """
    Aggregate search results by time period.

    Args:
        items: Search result items
        period: 'day', 'week', or 'month'
        config: Brand configuration
    """
    tracked_brands = config.get("tracked_brands", {})
    first_party = [b.lower() for b in tracked_brands.get("first_party", [])]

    # Group items by period
    period_data = defaultdict(list)

    for item in items:
        timestamp = item.get('timestamp', '')
        if not timestamp:
            continue

        try:
            dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))

            if period == 'day':
                period_key = dt.strftime('%Y-%m-%d')
            elif period == 'week':
                # ISO week
                period_key = dt.strftime('%Y-W%W')
            else:  # month
                period_key = dt.strftime('%Y-%m')

            period_data[period_key].append(item)
        except (ValueError, KeyError, TypeError):
            continue

    # Calculate metrics for each period
    trend_data = []

    for period_key in sorted(period_data.keys()):
        items_in_period = period_data[period_key]

        # Get unique timestamps (analysis runs)
        timestamps = set(item.get('timestamp', '') for item in items_in_period)

        # Aggregate first-party brand metrics
        fp_mentions = 0
        fp_providers = set()
        fp_best_rank = UNRANKED_SENTINEL
        total_searches = len(timestamps)

        for item in items_in_period:
            provider = item.get('provider', '')
            brands = item.get('brands', [])

            for brand in brands:
                name = brand.get('name', '').lower()
                # Prefer LLM classification; fall back to exact name match
                # only when classification is missing (see audit items 9, 22).
                classification = brand.get('classification')
                is_first_party = classification == 'first_party' or (
                    classification is None
                    and any(brand_names_match(name, fp) for fp in first_party)
                )
                if is_first_party:
                    fp_mentions += to_int(brand.get('mention_count'), 1)
                    fp_providers.add(provider)
                    fp_best_rank = min(fp_best_rank, to_int(brand.get('rank'), UNRANKED_SENTINEL))

        visibility_score = calculate_visibility_score(
            len(fp_providers), fp_mentions, fp_best_rank
        )

        trend_data.append({
            'period': period_key,
            'visibility_score': visibility_score,
            'total_mentions': fp_mentions,
            'provider_count': len(fp_providers),
            'best_rank': fp_best_rank if fp_best_rank < UNRANKED_SENTINEL else None,
            'analysis_runs': total_searches
        })

    return trend_data


def _fetch_keyword_items(keyword: str) -> list[dict]:
    """Fetch raw search-result rows for a keyword. Pulled out for parallel
    fan-out in ``get_all_keywords_trends`` — the rest of ``get_historical_trends``
    is CPU-bound aggregation that's safe to run serially afterwards.

    Returns an empty list on query failure so a single bad keyword can't fail
    the whole trends dashboard. Errors are logged for ops visibility.
    """
    try:
        table = dynamodb.Table(SEARCH_RESULTS_TABLE)
        response = table.query(KeyConditionExpression=Key('keyword').eq(keyword))
        return response.get('Items', [])
    except Exception as e:
        logger.error(f"Error fetching trend items for keyword {keyword!r}: {e}")
        return []


def _build_trend_from_items(
    keyword: str,
    items: list[dict],
    config: dict,
    period: str,
    days: int,
) -> dict[str, Any]:
    """Build the trend payload from an already-fetched items list.

    Extracted from ``get_historical_trends`` so the parallel fan-out can
    collect queries first, then run the CPU-bound aggregation serially
    on the main thread (avoiding the GIL contention that makes threading
    unhelpful for pure-Python work).
    """
    if not items:
        return {"error": f"No data found for keyword: {keyword}"}

    # Filter to requested time range.
    cutoff = utc_now().replace(tzinfo=None) - timedelta(days=days)
    cutoff_str = cutoff.isoformat()

    filtered_items = [
        item for item in items
        if item.get('timestamp', '') >= cutoff_str
    ]

    if not filtered_items:
        filtered_items = items  # Use all data if none in range

    # Aggregate by period
    trend_data = aggregate_by_period(filtered_items, period, config)

    # Calculate trend direction
    scores = [d['visibility_score'] for d in trend_data]
    trend_direction = get_trend_direction(scores)

    # Calculate period-over-period change
    if len(trend_data) >= 2:
        current = trend_data[-1]['visibility_score']
        previous = trend_data[-2]['visibility_score']
        change = round(current - previous, 1)
        change_pct = round((change / previous * 100), 1) if previous > 0 else 0
    else:
        change = 0
        change_pct = 0

    # Calculate averages
    avg_score = round(sum(scores) / len(scores), 1) if scores else 0
    max_score = max(scores) if scores else 0
    min_score = min(scores) if scores else 0

    return {
        'keyword': keyword,
        'period_type': period,
        'days_analyzed': days,
        'data_points': len(trend_data),
        'trend_data': trend_data,
        'trend_direction': trend_direction,
        'summary': {
            'current_score': trend_data[-1]['visibility_score'] if trend_data else 0,
            'previous_score': trend_data[-2]['visibility_score'] if len(trend_data) >= 2 else 0,
            'change': change,
            'change_percent': change_pct,
            'average_score': avg_score,
            'max_score': max_score,
            'min_score': min_score
        }
    }


def get_historical_trends(keyword: str, config: dict, period: str = 'day', days: int = 30) -> dict[str, Any]:
    """Get historical trend data for a keyword.

    Single-keyword entry point. Fetches + aggregates inline. For multi-keyword
    dashboards use ``get_all_keywords_trends``, which parallelizes the query
    step via ``_fetch_keyword_items``.
    """
    items = _fetch_keyword_items(keyword)
    return _build_trend_from_items(keyword, items, config, period, days)


def get_all_keywords_trends(config: dict, period: str = 'day', days: int = 30) -> dict[str, Any]:
    """Get trend summary across all keywords.

    DynamoDB queries are parallelized across up to ``_TRENDS_MAX_WORKERS``
    workers to collapse the previous N sequential queries (audit item 16).
    Aggregation runs serially afterwards on the main thread — it's pure
    Python and the GIL makes threading unhelpful for that phase.
    """
    # Get keywords from the Keywords table instead of scanning SearchResults
    # This is more efficient as Keywords table is small and purpose-built
    keywords_table_name = os.environ.get('DYNAMODB_TABLE_KEYWORDS')
    if keywords_table_name:
        keywords_table = dynamodb.Table(keywords_table_name)
        response = keywords_table.scan(
            ProjectionExpression='keyword',
            Limit=500
        )
        keywords = list(set(item.get('keyword', '') for item in response.get('Items', []) if item.get('keyword')))
    else:
        # Fallback to scanning SearchResults if Keywords table not configured
        table = dynamodb.Table(SEARCH_RESULTS_TABLE)
        response = table.scan(ProjectionExpression='keyword', Limit=500)
        keywords = list(set(item.get('keyword', '') for item in response.get('Items', []) if item.get('keyword')))

    # Cap fan-out at 20 keywords — matches the previous behavior so the
    # dashboard's perceived breadth doesn't change, and bounds DynamoDB
    # RCU + Lambda CPU cost.
    keywords_to_query = keywords[:20]
    if not keywords_to_query:
        return {
            'period_type': period,
            'days_analyzed': days,
            'keywords_analyzed': 0,
            'keyword_trends': [],
            'overall': {
                'improving_count': 0,
                'declining_count': 0,
                'stable_count': 0,
                'avg_score': 0,
            }
        }

    # Phase 1: parallel DynamoDB queries.
    workers = min(_TRENDS_MAX_WORKERS, len(keywords_to_query))
    items_by_keyword: dict[str, list[dict]] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        future_to_keyword = {
            pool.submit(_fetch_keyword_items, kw): kw
            for kw in keywords_to_query
        }
        for future in concurrent.futures.as_completed(future_to_keyword):
            kw = future_to_keyword[future]
            try:
                items_by_keyword[kw] = future.result()
            except Exception as e:
                # _fetch_keyword_items already catches and logs, but pool
                # propagation quirks (e.g. interpreter shutdown) could still
                # raise. Default to empty so aggregation treats it as
                # "no data for this keyword".
                logger.error(f"Trend fan-out future failed for {kw!r}: {e}")
                items_by_keyword[kw] = []

    # Phase 2: CPU-bound aggregation, serial on the main thread.
    keyword_trends = []
    for keyword in keywords_to_query:
        items = items_by_keyword.get(keyword, [])
        trend = _build_trend_from_items(keyword, items, config, period, days)
        if 'error' not in trend:
            keyword_trends.append({
                'keyword': keyword,
                'trend_direction': trend['trend_direction'],
                'current_score': trend['summary']['current_score'],
                'change': trend['summary']['change'],
                'change_percent': trend['summary']['change_percent']
            })

    # Sort by current score
    keyword_trends.sort(key=lambda x: x['current_score'], reverse=True)

    # Calculate overall trends
    improving = len([k for k in keyword_trends if k['trend_direction'] == 'improving'])
    declining = len([k for k in keyword_trends if k['trend_direction'] == 'declining'])
    stable = len([k for k in keyword_trends if k['trend_direction'] == 'stable'])

    return {
        'period_type': period,
        'days_analyzed': days,
        'keywords_analyzed': len(keyword_trends),
        'keyword_trends': keyword_trends,
        'overall': {
            'improving_count': improving,
            'declining_count': declining,
            'stable_count': stable,
            'avg_score': round(sum(k['current_score'] for k in keyword_trends) / len(keyword_trends), 1) if keyword_trends else 0
        }
    }


@api_handler
@validate({
    'keyword': {'type': str, 'max_length': 500},
    'period': {'type': str, 'choices': ['day', 'week', 'month'], 'default': 'day'},
    'days': {'type': int, 'min': 1, 'max': 365, 'default': 30}
})
def handler(event: dict[str, Any], context: Any, keyword: str | None = None, period: str = 'day', days: int = 30) -> dict[str, Any]:
    """
    API handler for historical trends.

    Query params:
        - keyword: Specific keyword (optional, returns all if not specified)
        - period: 'day', 'week', or 'month' (default: day)
        - days: Number of days to analyze (default: 30)
    """
    config = get_brand_config()

    if keyword:
        result = get_historical_trends(keyword, config, period, days)
    else:
        result = get_all_keywords_trends(config, period, days)

    return success_response(result, event)
