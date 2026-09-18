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

from shared.api_response import success_response, validation_error
from shared.constants import (
    MAX_KEYWORD_LENGTH,
    TREND_DIRECTION_DECLINING_SLOPE,
    TREND_DIRECTION_IMPROVING_SLOPE,
    UNRANKED_SENTINEL,
)
from shared.decorators import api_handler, validate
from shared.dynamo_decimal import to_int
from shared.providers import get_enabled_provider_count
from shared.scope_params import ReportScope, all_active_scope, parse_scope_params
from shared.utils import brand_names_match, get_brand_config, utc_now
from shared.visibility_score import calculate_sentiment_agnostic_visibility_score, mean

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
_TREND_PROJECTION = '#ts, provider, brands'
_TREND_PROJECTION_NAMES = {'#ts': 'timestamp'}

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = os.environ['DYNAMODB_TABLE_SEARCH_RESULTS']
KEYWORDS_TABLE = (
    os.environ.get('DYNAMODB_TABLE_KEYWORDS')
    or os.environ.get('KEYWORDS_TABLE')
    or 'CitationAnalysis-Keywords'
)


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

    # Calculate metrics for each period. The enabled-provider count is the
    # score denominator and does not change within a request, so resolve it
    # once here rather than once per period bucket (each lookup is a table scan).
    total_providers = get_enabled_provider_count()
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

        visibility_score = calculate_sentiment_agnostic_visibility_score(
            len(fp_providers), fp_mentions, fp_best_rank, total_providers
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
        params: dict[str, Any] = {
            'KeyConditionExpression': Key('keyword').eq(keyword),
            'ProjectionExpression': _TREND_PROJECTION,
            'ExpressionAttributeNames': _TREND_PROJECTION_NAMES,
        }
        items: list[dict] = []
        while True:
            response = table.query(**params)
            items.extend(response.get('Items', []))
            last_key = response.get('LastEvaluatedKey')
            if not last_key:
                return items
            params['ExclusiveStartKey'] = last_key
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

    return {
        'keyword': keyword,
        'period_type': period,
        'days_analyzed': days,
        **summarize_series(trend_data),
    }


def summarize_series(trend_data: list[dict[str, Any]]) -> dict[str, Any]:
    """Direction, period-over-period change and averages of one score series.

    Shared by the single-keyword payload and the group series so both are
    read the same way by the charts.
    """
    scores = [d['visibility_score'] for d in trend_data]
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


def build_group_series(trends: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per-bucket mean of the first-party score across keywords.

    A bucket's score averages only the keywords that have data in that
    bucket; mentions and analysis runs are summed, provider count is the
    widest coverage any keyword reached.
    """
    buckets: dict[str, dict[str, Any]] = {}
    for trend in trends:
        for point in trend.get('trend_data', []):
            bucket = buckets.setdefault(point['period'], {
                'scores': [], 'total_mentions': 0, 'provider_count': 0, 'best_rank': None, 'analysis_runs': 0,
            })
            bucket['scores'].append(float(point.get('visibility_score', 0)))
            bucket['total_mentions'] += int(point.get('total_mentions', 0))
            bucket['provider_count'] = max(bucket['provider_count'], int(point.get('provider_count', 0)))
            rank = point.get('best_rank')
            if rank is not None and (bucket['best_rank'] is None or int(rank) < bucket['best_rank']):
                bucket['best_rank'] = int(rank)
            bucket['analysis_runs'] += int(point.get('analysis_runs', 0))

    return [
        {
            'period': period,
            'visibility_score': round(mean(bucket['scores']), 1),
            'total_mentions': bucket['total_mentions'],
            'provider_count': bucket['provider_count'],
            'best_rank': bucket['best_rank'],
            'analysis_runs': bucket['analysis_runs'],
            'keywords_with_data': len(bucket['scores']),
        }
        for period, bucket in sorted(buckets.items())
    ]


def get_historical_trends(keyword: str, config: dict, period: str = 'day', days: int = 30) -> dict[str, Any]:
    """Get historical trend data for a keyword.

    Single-keyword entry point. Fetches + aggregates inline. For multi-keyword
    dashboards use ``get_all_keywords_trends``, which parallelizes the query
    step via ``_fetch_keyword_items``.
    """
    items = _fetch_keyword_items(keyword)
    return _build_trend_from_items(keyword, items, config, period, days)


def _keywords_for_scope(scope: ReportScope | None) -> tuple[list[str], int]:
    """Keyword texts to fan out over and the cap applied; active keywords only."""
    resolved = scope if scope is not None else all_active_scope(dynamodb.Table(KEYWORDS_TABLE))
    cap = _SCOPE_KEYWORDS_CAP if scope is not None else _ALL_KEYWORDS_CAP
    return list(resolved.keywords), cap


def get_all_keywords_trends(config: dict, period: str = 'day', days: int = 30, scope: ReportScope | None = None) -> dict[str, Any]:
    """Trend summary across the active keywords of a scope (default: all).

    DynamoDB queries are parallelized across up to ``_TRENDS_MAX_WORKERS``
    workers to collapse the previous N sequential queries (audit item 16).
    Aggregation runs serially afterwards on the main thread — it's pure
    Python and the GIL makes threading unhelpful for that phase.

    Besides the per-keyword `keyword_trends`, the payload carries the group
    series (`trend_data`: per-bucket mean first-party score) with the same
    `trend_direction` / `summary` block a single keyword has, so the group
    overview charts it exactly like one keyword.
    """
    keywords, cap = _keywords_for_scope(scope)
    keywords_to_query = keywords[:cap]
    scope_block = scope.describe() if scope is not None else {'mode': 'all', 'kind': 'all', 'label': 'all active keywords', 'keyword_count': len(keywords)}
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

    # Sort by current score
    keyword_trends.sort(key=lambda x: x['current_score'], reverse=True)

    # Calculate overall trends
    improving = len([k for k in keyword_trends if k['trend_direction'] == 'improving'])
    declining = len([k for k in keyword_trends if k['trend_direction'] == 'declining'])
    stable = len([k for k in keyword_trends if k['trend_direction'] == 'stable'])

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
            'avg_score': round(mean(k['current_score'] for k in keyword_trends), 1),
        },
        **summarize_series(build_group_series(full_trends)),
    }


@api_handler
@validate({
    'keyword': {'type': str, 'max_length': MAX_KEYWORD_LENGTH},
    'group_id': {'type': str, 'max_length': 64},
    'keyword_ids': {'type': str, 'max_length': 8000},
    'scope': {'type': str, 'choices': ['all']},
    'period': {'type': str, 'choices': ['day', 'week', 'month'], 'default': 'day'},
    'days': {'type': int, 'min': 1, 'max': 365, 'default': 30}
})
def handler(
    event: dict[str, Any],
    context: Any,
    keyword: str | None = None,
    group_id: str | None = None,
    keyword_ids: str | None = None,
    scope: str | None = None,
    period: str = 'day',
    days: int = 30,
) -> dict[str, Any]:
    """
    API handler for historical trends.

    Query params:
        - keyword: one keyword (single-keyword payload)
        - group_id / keyword_ids: a keyword group or id set (group series + per-keyword trends)
        - neither: every active keyword (capped at 20)
        - period: 'day', 'week', or 'month' (default: day)
        - days: Number of days to analyze (default: 30, max 365)
    """
    report_scope, error = parse_scope_params(
        {'keyword': keyword, 'group_id': group_id, 'keyword_ids': keyword_ids, 'scope': scope}, dynamodb.Table(KEYWORDS_TABLE)
    )
    if error:
        return validation_error(error, event, 'scope')

    config = get_brand_config()
    if report_scope is not None and report_scope.is_single_keyword:
        result = get_historical_trends(report_scope.keywords[0], config, period, days)
    else:
        result = get_all_keywords_trends(config, period, days, scope=report_scope)

    return success_response(result, event)
