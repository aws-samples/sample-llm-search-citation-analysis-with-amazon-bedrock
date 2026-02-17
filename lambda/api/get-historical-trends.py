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

import os
import sys
import logging
import boto3
from boto3.dynamodb.conditions import Key
from typing import Dict, Any, List
from collections import defaultdict
from datetime import datetime, timedelta
from decimal_utils import to_int

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.decorators import api_handler, validate
from shared.api_response import success_response
from shared.utils import get_brand_config
from shared.config import PROVIDERS

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = os.environ['DYNAMODB_TABLE_SEARCH_RESULTS']
KEYWORDS_TABLE = os.environ.get('DYNAMODB_TABLE_KEYWORDS')  # Optional for fallback
PROVIDER_CONFIG_TABLE = os.environ.get('PROVIDER_CONFIG_TABLE')  # Optional for fallback


def get_enabled_provider_count() -> int:
    """
    Get the count of enabled providers from the provider config table.
    Falls back to total known providers if table is not configured or empty.
    """
    if not PROVIDER_CONFIG_TABLE:
        return len(PROVIDERS)
    
    try:
        table = dynamodb.Table(PROVIDER_CONFIG_TABLE)
        response = table.scan(
            ProjectionExpression='provider_id, enabled'
        )
        items = response.get('Items', [])
        
        if not items:
            return len(PROVIDERS)
        
        configured_providers = {item['provider_id']: item.get('enabled', True) for item in items}
        
        enabled_count = 0
        for provider in PROVIDERS:
            if configured_providers.get(provider, True):
                enabled_count += 1
        
        return enabled_count if enabled_count > 0 else len(PROVIDERS)
    except Exception as e:
        logger.warning(f"Error getting provider config: {e}")
        return len(PROVIDERS)


def calculate_visibility_score(provider_count: int, total_mentions: int, best_rank: int, total_providers: int = None) -> float:
    """Calculate visibility score (0-100)."""
    import math
    if total_providers is None:
        total_providers = get_enabled_provider_count()
    provider_score = (provider_count / total_providers) * 40 if total_providers > 0 else 0
    rank_score = max(0, (11 - min(best_rank, 10)) / 10) * 30
    mention_score = min(math.log(total_mentions + 1) / math.log(51), 1) * 20
    return round(provider_score + rank_score + mention_score, 1)


def get_trend_direction(values: List[float]) -> str:
    """Determine trend direction from a series of values."""
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
    
    # Determine direction based on slope magnitude
    if slope > 2:
        return 'improving'
    elif slope < -2:
        return 'declining'
    return 'stable'


def aggregate_by_period(items: List[Dict], period: str, config: Dict) -> List[Dict]:
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
        fp_best_rank = 999
        total_searches = len(timestamps)
        
        for item in items_in_period:
            provider = item.get('provider', '')
            brands = item.get('brands', [])
            
            for brand in brands:
                name = brand.get('name', '').lower()
                if any(fp in name or name in fp for fp in first_party):
                    fp_mentions += to_int(brand.get('mention_count'), 1)
                    fp_providers.add(provider)
                    fp_best_rank = min(fp_best_rank, to_int(brand.get('rank'), 999))
        
        visibility_score = calculate_visibility_score(
            len(fp_providers), fp_mentions, fp_best_rank
        )
        
        trend_data.append({
            'period': period_key,
            'visibility_score': visibility_score,
            'total_mentions': fp_mentions,
            'provider_count': len(fp_providers),
            'best_rank': fp_best_rank if fp_best_rank < 999 else None,
            'analysis_runs': total_searches
        })
    
    return trend_data


def get_historical_trends(keyword: str, config: Dict, period: str = 'day', days: int = 30) -> Dict[str, Any]:
    """Get historical trend data for a keyword."""
    table = dynamodb.Table(SEARCH_RESULTS_TABLE)
    
    # Query all results for keyword
    response = table.query(
        KeyConditionExpression=Key('keyword').eq(keyword)
    )
    items = response.get('Items', [])
    
    if not items:
        return {"error": f"No data found for keyword: {keyword}"}
    
    # Filter to requested time range
    cutoff = datetime.utcnow() - timedelta(days=days)
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


def get_all_keywords_trends(config: Dict, period: str = 'day', days: int = 30) -> Dict[str, Any]:
    """Get trend summary across all keywords."""
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
    
    keyword_trends = []
    
    for keyword in keywords[:20]:  # Limit to 20 keywords
        trend = get_historical_trends(keyword, config, period, days)
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
def handler(event: Dict[str, Any], context: Any, keyword: str = None, period: str = 'day', days: int = 30) -> Dict[str, Any]:
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
