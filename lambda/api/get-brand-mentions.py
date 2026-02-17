"""
Get Brand Mentions API

Retrieves brand mentions from search results for a specific keyword.
Supports multiple industries and brand classification (first_party, competitor, other).
"""

import os
import sys
import logging
import boto3
from boto3.dynamodb.conditions import Key
from typing import Dict, Any, List
from decimal_utils import to_int

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.decorators import api_handler, validate, require_keyword, optional_provider
from shared.api_response import success_response, not_found_response
from shared.utils import get_brand_config

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = os.environ['DYNAMODB_TABLE_SEARCH_RESULTS']


def aggregate_brand_mentions(results: List[Dict[str, Any]], config: Dict[str, Any] = None) -> Dict[str, Any]:
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
                    'total_mentions': 0,
                    'best_rank': to_int(brand.get('rank'), 999),
                    'classification': classification,
                    'appearances': []
                }
            
            brand_scores[normalized_name]['providers'].append(provider)
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


@api_handler
@validate({
    'keyword': require_keyword(),
    'timestamp': {'type': str, 'max_length': 50},
    'provider': optional_provider(),
    'classification': {'type': str, 'choices': ['first_party', 'competitor', 'other']}
})
def handler(event: Dict[str, Any], context: Any, keyword: str, timestamp: str = None, 
            provider: str = None, classification: str = None) -> Dict[str, Any]:
    """
    API handler to get brand mentions for a keyword.
    
    Query params:
        - keyword: The search keyword (required)
        - timestamp: Specific timestamp (optional, defaults to latest)
        - provider: Filter by specific provider (optional)
        - classification: Filter by classification (first_party, competitor, other) (optional)
    
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
    # Get brand tracking configuration
    brand_config = get_brand_config()
    
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
