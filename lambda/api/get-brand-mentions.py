"""
Get Brand Mentions API

Retrieves brand mentions from search results for a specific keyword.
Supports multiple industries and brand classification (first_party, competitor, other).
"""

import logging
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import not_found_response, success_response
from shared.decorators import api_handler, optional_provider, validate
from shared.dynamo_decimal import to_int
from shared.scope_params import (
    SCOPE_QUERY_PARAMS,
    ReportScope,
    keywords_table_name,
    query_keyword_rows,
    scope_from_request,
)
from shared.utils import get_brand_config

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = os.environ['DYNAMODB_TABLE_SEARCH_RESULTS']
KEYWORDS_TABLE = keywords_table_name()

# Group aggregates fan out one projected Query per keyword (no LLM response
# text), in parallel.
_SCOPE_MAX_WORKERS = 10
_SCOPE_PROJECTION = 'keyword, #ts, provider, brands, query_prompt_id'


def aggregate_brand_mentions(results: list[dict[str, Any]], config: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    Aggregate brand mentions across all providers.

    Returns:
        Dict with aggregated brand data including cross-provider rankings
    """
    brand_scores = {}  # brand_name -> {providers: [], total_mentions: int, best_rank: int}

    for result in results:
        provider = result.get('provider', 'unknown')
        brands = result.get('brands', [])

        for brand in brands:
            name = brand.get('name')
            if not name:
                continue

            normalized_name = name.lower()

            if normalized_name not in brand_scores:
                # Use the LLM-assigned classification directly
                # The LLM has already classified brands based on ownership knowledge
                classification = brand.get('classification', 'other')

                brand_scores[normalized_name] = {
                    'name': name,  # Keep original casing from first mention
                    'parent_company': brand.get('parent_company'),
                    'providers': [],
                    'keywords': set(),
                    'total_mentions': 0,
                    'best_rank': to_int(brand.get('rank'), 999),
                    'classification': classification,
                    'appearances': []
                }

            brand_scores[normalized_name]['providers'].append(provider)
            if result.get('keyword'):
                brand_scores[normalized_name]['keywords'].add(result['keyword'])
            brand_scores[normalized_name]['total_mentions'] += to_int(brand.get('mention_count'), 1)
            brand_scores[normalized_name]['best_rank'] = min(
                brand_scores[normalized_name]['best_rank'],
                to_int(brand.get('rank'), 999)
            )
            brand_scores[normalized_name]['appearances'].append({
                'provider': provider,
                'rank': brand.get('rank'),
                'mention_count': brand.get('mention_count'),
                'first_position': brand.get('first_position'),
                'sentiment': brand.get('sentiment'),
                'sentiment_reason': brand.get('sentiment_reason'),
                'ranking_context': brand.get('ranking_context')
            })

    # Convert to list and calculate aggregate score
    aggregated = []
    for brand_data in brand_scores.values():
        # Score: number of providers * 10 + inverse of best rank + total mentions
        provider_count = len(set(brand_data['providers']))
        score = (provider_count * 10) + (10 - brand_data['best_rank']) + brand_data['total_mentions']

        brand_data['provider_count'] = provider_count
        brand_data['aggregate_score'] = score
        # Distinct keywords mentioning the brand (meaningful for group scopes).
        brand_data['keyword_count'] = len(brand_data['keywords'])
        brand_data['keywords'] = sorted(brand_data['keywords'])
        aggregated.append(brand_data)

    # Sort by aggregate score
    aggregated.sort(key=lambda x: x['aggregate_score'], reverse=True)

    # Add overall rank
    for idx, brand in enumerate(aggregated, 1):
        brand['overall_rank'] = idx

    # Separate by classification
    first_party_brands = [b for b in aggregated if b.get('classification') == 'first_party']
    competitor_brands = [b for b in aggregated if b.get('classification') == 'competitor']
    other_brands = [b for b in aggregated if b.get('classification') == 'other']

    return {
        'brands': aggregated,
        'total_unique_brands': len(aggregated),
        'first_party_brands': first_party_brands,
        'competitor_brands': competitor_brands,
        'other_brands': other_brands,
        'summary': {
            'first_party_count': len(first_party_brands),
            'competitor_count': len(competitor_brands),
            'other_count': len(other_brands)
        }
    }


def _latest_run_items(keyword: str, query_prompt_id: str | None, provider: str | None) -> list[dict[str, Any]]:
    """The latest analysis run of one keyword (projected), persona/provider filtered."""
    items = query_keyword_rows(dynamodb.Table(SEARCH_RESULTS_TABLE), keyword, _SCOPE_PROJECTION)
    if not items:
        return []
    latest = max(item.get('timestamp', '') for item in items)
    items = [item for item in items if item.get('timestamp') == latest]
    if query_prompt_id:
        items = [item for item in items if item.get('query_prompt_id', 'default') == query_prompt_id]
    if provider:
        items = [item for item in items if item.get('provider') == provider]
    return items


def get_scope_brand_mentions(
    scope: ReportScope,
    brand_config: dict[str, Any],
    query_prompt_id: str | None,
    provider: str | None,
    classification: str | None,
) -> dict[str, Any]:
    """Brand mentions aggregated over the latest run of every keyword in the scope.

    Providers are counted as distinct engines across keywords, mentions are
    summed, `best_rank` is the best position on any keyword and
    `keyword_count` says on how many keywords the brand appeared. The full
    LLM responses (`by_provider`) are not part of a group answer.
    """
    keywords = list(scope.keywords)
    per_keyword: list[list[dict[str, Any]]] = []
    if keywords:
        with ThreadPoolExecutor(max_workers=min(_SCOPE_MAX_WORKERS, len(keywords))) as pool:
            per_keyword = list(pool.map(lambda keyword: _latest_run_items(keyword, query_prompt_id, provider), keywords))

    items = [item for rows in per_keyword for item in rows]
    aggregated = aggregate_brand_mentions(items, brand_config)
    if classification:
        aggregated['brands'] = [b for b in aggregated['brands'] if b.get('classification') == classification]

    return {
        'scope': scope.describe(),
        'keyword': None,
        'timestamp': max((item.get('timestamp', '') for item in items), default=None),
        'keywords_analyzed': len(keywords),
        'keywords_with_data': sum(1 for rows in per_keyword if rows),
        'config': brand_config,
        'by_provider': [],
        'aggregated': aggregated,
    }


@api_handler
@validate({
    **SCOPE_QUERY_PARAMS,
    'timestamp': {'type': str, 'max_length': 50},
    'provider': optional_provider(),
    'classification': {'type': str, 'choices': ['first_party', 'competitor', 'other']},
    'query_prompt_id': {'type': str, 'max_length': 100},
})
def handler(event: dict[str, Any], context: Any, timestamp: str | None = None, provider: str | None = None,
            classification: str | None = None, query_prompt_id: str | None = None, **scope_params: str | None) -> dict[str, Any]:
    """
    API handler to get brand mentions for a keyword or a keyword group.

    Query params (exactly one scope):
        - keyword: The search keyword — per-provider responses + aggregate
        - group_id / keyword_ids: a keyword group / id set — aggregate across keywords
        - timestamp: Specific timestamp (optional, single keyword, defaults to latest)
        - provider: Filter by specific provider (optional)
        - classification: Filter by classification (first_party, competitor, other) (optional)
        - query_prompt_id: Filter by persona (optional)

    Returns:
        {
            "keyword": "best running shoes",
            "timestamp": "2025-01-15T10:30:00Z",
            "config": {...},
            "by_provider": [...],
            "aggregated": {
                "brands": [...],
                "total_unique_brands": 15,
                "first_party_brands": [...],
                "competitor_brands": [...],
                "other_brands": [...]
            }
        }
    """
    report_scope, rejected = scope_from_request(event, scope_params, dynamodb.Table(KEYWORDS_TABLE), required=True)
    if rejected:
        return rejected

    # Get brand tracking configuration
    brand_config = get_brand_config()

    if not report_scope.is_single_keyword:
        return success_response(get_scope_brand_mentions(report_scope, brand_config, query_prompt_id, provider, classification), event)

    keyword = report_scope.keywords[0]
    table = dynamodb.Table(SEARCH_RESULTS_TABLE)

    # Query by keyword
    if timestamp:
        response = table.query(
            KeyConditionExpression=Key('keyword').eq(keyword) & Key('timestamp_provider').begins_with(timestamp)
        )
    else:
        response = table.query(
            KeyConditionExpression=Key('keyword').eq(keyword)
        )

    items = response.get('Items', [])

    if not items:
        return not_found_response('Results for keyword', event)

    # Filter by persona if specified
    if query_prompt_id:
        items = [item for item in items if item.get('query_prompt_id', 'default') == query_prompt_id]

    # Filter by provider if specified
    if provider:
        items = [item for item in items if item.get('provider') == provider]

    # Get latest timestamp if not specified
    result_timestamp = timestamp
    if not timestamp and items:
        latest_timestamp = max(item.get('timestamp', '') for item in items)
        items = [item for item in items if item.get('timestamp') == latest_timestamp]
        result_timestamp = latest_timestamp

    # Format response by provider
    by_provider = []
    for item in items:
        full_response = item.get('response', '')
        by_provider.append({
            'provider': item.get('provider'),
            'timestamp': item.get('timestamp'),
            'brands': item.get('brands', []),
            'brand_count': item.get('brand_count', 0),
            'response_preview': full_response[:200] + '...' if len(full_response) > 200 else full_response,
            'full_response': full_response,
            'seo_feedback': item.get('seo_feedback', ''),
            'geo_feedback': item.get('geo_feedback', ''),
            'citations': item.get('citations', [])
        })

    # Aggregate across providers
    aggregated = aggregate_brand_mentions(items, brand_config)

    # Apply classification filter if specified
    if classification:
        aggregated['brands'] = [b for b in aggregated['brands'] if b.get('classification') == classification]

    result = {
        'keyword': keyword,
        'timestamp': result_timestamp,
        'config': brand_config,
        'by_provider': by_provider,
        'aggregated': aggregated
    }

    return success_response(result, event)
