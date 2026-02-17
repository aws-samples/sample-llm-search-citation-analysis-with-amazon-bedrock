"""
Visibility Metrics API

Calculates and returns visibility scores and share of voice metrics
for brands across AI providers.

Metrics:
- Visibility Score: 0-100 score based on mentions, rankings, and provider coverage
- Share of Voice: % of total brand mentions that belong to each brand
- Provider Coverage: Which AI engines mention the brand
- Trend Direction: Improving, declining, or stable
"""

import os
import sys
import logging
import math
import boto3
from boto3.dynamodb.conditions import Key
from typing import Dict, Any, List

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.decorators import api_handler, validate, require_keyword
from shared.api_response import success_response
from shared.utils import get_brand_config
from shared.config import PROVIDERS
from decimal_utils import to_int

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = os.environ['DYNAMODB_TABLE_SEARCH_RESULTS']
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
            # No config entries means all providers are enabled by default
            return len(PROVIDERS)
        
        # Count providers that are explicitly enabled or not configured (default enabled)
        configured_providers = {item['provider_id']: item.get('enabled', True) for item in items}
        
        enabled_count = 0
        for provider in PROVIDERS:
            # Default to enabled if not in config table
            if configured_providers.get(provider, True):
                enabled_count += 1
        
        return enabled_count if enabled_count > 0 else len(PROVIDERS)
    except Exception as e:
        logger.warning(f"Error getting provider config: {e}")
        return len(PROVIDERS)


def calculate_visibility_score(
    provider_count: int,
    total_mentions: int,
    best_rank: int,
    avg_sentiment_score: float,
    total_providers: int
) -> float:
    """
    Calculate visibility score (0-100) based on multiple factors.
    
    Factors:
    - Provider coverage (40%): How many AI engines mention the brand
    - Ranking position (30%): Best rank across providers (1=best)
    - Mention frequency (20%): Total number of mentions
    - Sentiment (10%): Average sentiment score
    """
    # Provider coverage score (0-40)
    provider_score = (provider_count / total_providers) * 40 if total_providers > 0 else 0
    
    # Ranking score (0-30) - inverse of rank, capped at rank 10
    rank_score = max(0, (11 - min(best_rank, 10)) / 10) * 30
    
    # Mention score (0-20) - logarithmic scale, capped at 50 mentions
    mention_score = min(math.log(total_mentions + 1) / math.log(51), 1) * 20
    
    # Sentiment score (0-10) - convert -1 to 1 scale to 0-10
    sentiment_score = ((avg_sentiment_score + 1) / 2) * 10
    
    return round(provider_score + rank_score + mention_score + sentiment_score, 1)


def sentiment_to_score(sentiment: str) -> float:
    """Convert sentiment string to numeric score."""
    sentiment_map = {
        'positive': 1.0,
        'neutral': 0.0,
        'negative': -1.0,
        'mixed': 0.0
    }
    return sentiment_map.get(sentiment.lower() if sentiment else 'neutral', 0.0)


def calculate_share_of_voice(brand_mentions: Dict[str, int], total_mentions: int) -> Dict[str, float]:
    """Calculate share of voice percentage for each brand."""
    if total_mentions == 0:
        return {}
    return {
        brand: round((count / total_mentions) * 100, 2)
        for brand, count in brand_mentions.items()
    }


def get_visibility_metrics(keyword: str, config: Dict[str, Any]) -> Dict[str, Any]:
    """Calculate visibility metrics for a keyword."""
    table = dynamodb.Table(SEARCH_RESULTS_TABLE)
    
    # Query all results for this keyword
    response = table.query(
        KeyConditionExpression=Key('keyword').eq(keyword)
    )
    items = response.get('Items', [])
    
    if not items:
        return {"error": "No data found for keyword"}
    
    # Get tracked brands for classification
    tracked_brands = config.get("tracked_brands", {})
    first_party = [b.lower() for b in tracked_brands.get("first_party", [])]
    competitors = [b.lower() for b in tracked_brands.get("competitors", [])]
    
    # Aggregate brand data
    brand_data = {}  # brand_name -> {providers, mentions, ranks, sentiments}
    total_mentions = 0
    
    # Get latest timestamp for current metrics
    latest_timestamp = max(item.get('timestamp', '') for item in items)
    latest_items = [item for item in items if item.get('timestamp') == latest_timestamp]
    
    for item in latest_items:
        provider = item.get('provider', 'unknown')
        brands = item.get('brands', [])
        
        for brand in brands:
            name = brand.get('name', '').lower()
            if not name:
                continue
            
            # Use the classification from brand extraction if available
            brand_classification = brand.get('classification', 'other')
            
            if name not in brand_data:
                brand_data[name] = {
                    'original_name': brand.get('name'),
                    'classification': brand_classification,  # Store original classification
                    'providers': set(),
                    'mentions': 0,
                    'ranks': [],
                    'sentiments': []
                }
            
            brand_data[name]['providers'].add(provider)
            mention_count = to_int(brand.get('mention_count'), 1)
            brand_data[name]['mentions'] += mention_count
            brand_data[name]['ranks'].append(to_int(brand.get('rank'), 999))
            if brand.get('sentiment'):
                brand_data[name]['sentiments'].append(sentiment_to_score(brand.get('sentiment')))
            
            total_mentions += mention_count
    
    # Get enabled provider count for visibility calculation
    total_providers = get_enabled_provider_count()
    
    # Calculate metrics for each brand
    brand_metrics = []
    for name, data in brand_data.items():
        provider_count = len(data['providers'])
        best_rank = min(data['ranks']) if data['ranks'] else 999
        avg_sentiment = sum(data['sentiments']) / len(data['sentiments']) if data['sentiments'] else 0.0
        
        # Ensure all values are native Python types
        mentions = to_int(data['mentions'], 0)
        
        visibility_score = calculate_visibility_score(
            provider_count=provider_count,
            total_mentions=mentions,
            best_rank=best_rank,
            avg_sentiment_score=float(avg_sentiment),
            total_providers=total_providers
        )
        
        # Use the classification from brand extraction (already determined during search)
        classification = data.get('classification', 'other')
        
        brand_metrics.append({
            'name': data['original_name'],
            'visibility_score': visibility_score,
            'provider_count': provider_count,
            'providers': list(data['providers']),
            'total_mentions': mentions,
            'best_rank': best_rank,
            'avg_sentiment': round(float(avg_sentiment), 2),
            'classification': classification
        })
    
    # Sort by visibility score
    brand_metrics.sort(key=lambda x: x['visibility_score'], reverse=True)
    
    # Calculate share of voice
    brand_mentions = {b['name']: b['total_mentions'] for b in brand_metrics}
    share_of_voice = calculate_share_of_voice(brand_mentions, total_mentions)
    
    # Add share of voice to each brand
    for brand in brand_metrics:
        brand['share_of_voice'] = share_of_voice.get(brand['name'], 0)
    
    # Separate by classification
    first_party_metrics = [b for b in brand_metrics if b['classification'] == 'first_party']
    competitor_metrics = [b for b in brand_metrics if b['classification'] == 'competitor']
    other_metrics = [b for b in brand_metrics if b['classification'] == 'other']
    
    return {
        'keyword': keyword,
        'timestamp': latest_timestamp,
        'total_brands': len(brand_metrics),
        'total_mentions': total_mentions,
        'brands': brand_metrics,
        'first_party': first_party_metrics,
        'competitors': competitor_metrics,
        'others': other_metrics,
        'summary': {
            'first_party_avg_score': round(sum(b['visibility_score'] for b in first_party_metrics) / len(first_party_metrics), 1) if first_party_metrics else 0,
            'competitor_avg_score': round(sum(b['visibility_score'] for b in competitor_metrics) / len(competitor_metrics), 1) if competitor_metrics else 0,
            'first_party_total_sov': round(sum(b['share_of_voice'] for b in first_party_metrics), 2),
            'competitor_total_sov': round(sum(b['share_of_voice'] for b in competitor_metrics), 2)
        }
    }


@api_handler
@validate({
    'keyword': require_keyword(),
    'brand': {'type': str, 'max_length': 200}
})
def handler(event, context, keyword, brand=None):
    """
    API handler for visibility metrics.
    
    Query params:
        - keyword: Search keyword (required)
        - brand: Filter to specific brand (optional)
    """
    config = get_brand_config()
    metrics = get_visibility_metrics(keyword, config)
    
    # Filter to specific brand if requested
    if brand and 'brands' in metrics:
        metrics['brands'] = [
            b for b in metrics['brands']
            if brand.lower() in b['name'].lower()
        ]
    
    return success_response(metrics, event)
