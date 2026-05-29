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

import logging
import math
import os
import sys
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

# Add shared module to path
sys.path.insert(0, '/opt/python')

from decimal_utils import to_int
from shared.api_response import success_response
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
from shared.decorators import api_handler, require_keyword, validate
from shared.providers import get_enabled_provider_count

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = os.environ['DYNAMODB_TABLE_SEARCH_RESULTS']


def calculate_visibility_score(
    provider_count: int,
    total_mentions: int,
    best_rank: int,
    avg_sentiment_score: float,
    total_providers: int
) -> float:
    """
    Calculate visibility score (0-100) based on multiple factors.
    Factors (weights sum to 100; see shared.constants for the source of truth):
    - Provider coverage: VISIBILITY_PROVIDER_WEIGHT
    - Ranking position: VISIBILITY_RANK_WEIGHT
    - Mention frequency: VISIBILITY_MENTION_WEIGHT
    - Sentiment: VISIBILITY_SENTIMENT_WEIGHT
    """
    # Provider coverage score
    provider_score = (
        (provider_count / total_providers) * VISIBILITY_PROVIDER_WEIGHT
        if total_providers > 0 else 0
    )

    # Ranking score — inverse of rank, capped at VISIBILITY_RANK_CAP
    capped_rank = min(best_rank, VISIBILITY_RANK_CAP)
    rank_score = max(0, (VISIBILITY_RANK_INVERSE_BASE - capped_rank) / VISIBILITY_RANK_CAP) * VISIBILITY_RANK_WEIGHT

    # Mention score — logarithmic saturation at VISIBILITY_MENTION_SATURATION_COUNT mentions
    mention_score = (
        min(math.log(total_mentions + 1) / math.log(VISIBILITY_MENTION_LOG_BASE), 1)
        * VISIBILITY_MENTION_WEIGHT
    )

    # Sentiment score — convert -1..1 scale to 0..VISIBILITY_SENTIMENT_WEIGHT
    sentiment_score = ((avg_sentiment_score + 1) / 2) * VISIBILITY_SENTIMENT_WEIGHT

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


def calculate_share_of_voice(brand_mentions: dict[str, int], total_mentions: int) -> dict[str, float]:
    """Calculate share of voice percentage for each brand."""
    if total_mentions == 0:
        return {}
    return {
        brand: round((count / total_mentions) * 100, 2)
        for brand, count in brand_mentions.items()
    }


def get_visibility_metrics(keyword: str, query_prompt_id: str | None = None) -> dict[str, Any]:
    """Calculate visibility metrics for a keyword, optionally filtered by persona."""
    table = dynamodb.Table(SEARCH_RESULTS_TABLE)

    # Query all results for this keyword
    response = table.query(
        KeyConditionExpression=Key('keyword').eq(keyword)
    )
    items = response.get('Items', [])

    if not items:
        return {"error": "No data found for keyword"}

    # Aggregate brand data
    brand_data = {}  # brand_name -> {providers, mentions, ranks, sentiments}
    total_mentions = 0

    # Get latest timestamp for current metrics
    latest_timestamp = max(item.get('timestamp', '') for item in items)
    latest_items = [item for item in items if item.get('timestamp') == latest_timestamp]

    # Filter by persona if specified
    if query_prompt_id:
        latest_items = [item for item in latest_items if item.get('query_prompt_id', 'default') == query_prompt_id]

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
            brand_data[name]['ranks'].append(to_int(brand.get('rank'), UNRANKED_SENTINEL))
            if brand.get('sentiment'):
                brand_data[name]['sentiments'].append(sentiment_to_score(brand.get('sentiment')))

            total_mentions += mention_count

    # Get enabled provider count for visibility calculation
    total_providers = get_enabled_provider_count()

    # Calculate metrics for each brand
    brand_metrics = []
    for _name, data in brand_data.items():
        provider_count = len(data['providers'])
        best_rank = min(data['ranks']) if data['ranks'] else UNRANKED_SENTINEL
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
    'brand': {'type': str, 'max_length': 200},
    'query_prompt_id': {'type': str, 'max_length': 100},
})
def handler(event, context, keyword, brand=None, query_prompt_id=None):
    """
    API handler for visibility metrics.

    Query params:
        - keyword: Search keyword (required)
        - brand: Filter to specific brand (optional)
        - query_prompt_id: Filter to specific persona (optional)
    """
    metrics = get_visibility_metrics(keyword, query_prompt_id=query_prompt_id)

    # Filter to specific brand if requested
    if brand and 'brands' in metrics:
        metrics['brands'] = [
            b for b in metrics['brands']
            if brand.lower() in b['name'].lower()
        ]

    return success_response(metrics, event)
