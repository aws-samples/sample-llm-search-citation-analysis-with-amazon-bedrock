"""
Get Citations API Lambda

Returns citation statistics and top cited URLs.
"""

import sys
import logging
import boto3
from boto3.dynamodb.conditions import Key
from collections import Counter
import os

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.decorators import api_handler, validate, optional_limit
from shared.api_response import success_response
from shared.utils import get_brand_config

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = os.environ['SEARCH_RESULTS_TABLE']
CITATIONS_TABLE = os.environ['CITATIONS_TABLE']
search_results_table = dynamodb.Table(SEARCH_RESULTS_TABLE)
citations_table = dynamodb.Table(CITATIONS_TABLE)

# Optional: Brand config table for dynamic brand detection
BRAND_CONFIG_TABLE = os.environ.get('DYNAMODB_TABLE_BRAND_CONFIG')


def _get_tracked_brands():
    """Get all tracked brands from config for URL matching."""
    config = get_brand_config(BRAND_CONFIG_TABLE)
    tracked_brands = config.get('tracked_brands', {})
    
    # Collect all brands with their display names and search terms
    brands = []
    for category in ['first_party', 'competitors']:
        for brand in tracked_brands.get(category, []):
            # Brand can be a string or dict with name and aliases
            if isinstance(brand, str):
                brands.append({'name': brand, 'terms': [brand.lower()]})
            elif isinstance(brand, dict):
                name = brand.get('name', '')
                aliases = brand.get('aliases', [])
                terms = [name.lower()] + [a.lower() for a in aliases]
                brands.append({'name': name, 'terms': terms})
    
    return brands


def _detect_brand_in_url(url_lower, tracked_brands):
    """Detect brand mention in URL using tracked brands config."""
    for brand in tracked_brands:
        for term in brand['terms']:
            if term and term in url_lower:
                return brand['name']
    return 'Other'


@api_handler
@validate({
    'keyword': {'type': str, 'max_length': 500},
    'query_prompt_id': {'type': str, 'max_length': 100},
    'limit': optional_limit(default=100, max_val=1000)
})
def handler(event, context, keyword=None, query_prompt_id=None, limit=100):
    """
    GET /api/citations?keyword=xxx&query_prompt_id=xxx&limit=100
    
    Returns citation statistics including:
    - Top cited URLs
    - Citations by provider
    - Total citation count
    """
    # Get tracked brands from config for dynamic brand detection
    tracked_brands = _get_tracked_brands()
    
    # Use query when keyword is provided (much more efficient than scan)
    if keyword:
        response = search_results_table.query(
            KeyConditionExpression=Key('keyword').eq(keyword),
            Limit=limit
        )
        items = response.get('Items', [])
    else:
        # When no keyword filter, query using ProviderIndex GSI
        items = []
        providers = ['openai', 'perplexity', 'gemini', 'claude']
        items_per_provider = max(limit // len(providers), 50)
        
        for p in providers:
            try:
                response = search_results_table.query(
                    IndexName='ProviderIndex',
                    KeyConditionExpression=Key('provider').eq(p),
                    ScanIndexForward=False,
                    Limit=items_per_provider
                )
                items.extend(response.get('Items', []))
            except Exception as e:
                logger.debug(f"No data for provider {p}: {str(e)}")
                continue
        
        items.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
        items = items[:limit]
    
    # Filter by query prompt if specified
    if query_prompt_id:
        items = [item for item in items if item.get('query_prompt_id', 'default') == query_prompt_id]
    
    # Calculate statistics from search results
    url_counts = Counter()
    url_provider_counts = {}
    url_keyword_sets = {}
    provider_counts = Counter()
    brand_mentions = Counter()
    
    for item in items:
        citations = item.get('citations', [])
        item_provider = item.get('provider', '')
        item_keyword = item.get('keyword', '')
        
        if citations:
            provider_counts[item_provider] += len(citations)
        
        for citation in citations:
            url = citation if isinstance(citation, str) else citation.get('S', '')
            if url:
                url_counts[url] += 1
                
                if url not in url_provider_counts:
                    url_provider_counts[url] = Counter()
                url_provider_counts[url][item_provider] += 1
                
                if url not in url_keyword_sets:
                    url_keyword_sets[url] = set()
                if item_keyword:
                    url_keyword_sets[url].add(item_keyword)
                
                # Dynamic brand detection using config
                url_lower = url.lower()
                detected_brand = _detect_brand_in_url(url_lower, tracked_brands)
                brand_mentions[detected_brand] += 1
    
    top_urls = [
        {
            'url': url,
            'citation_count': count,
            'by_provider': dict(url_provider_counts.get(url, {})),
            'keyword_count': len(url_keyword_sets.get(url, set())),
            'keywords': list(url_keyword_sets.get(url, set()))
        }
        for url, count in url_counts.most_common()
    ]
    
    provider_stats = [
        {'provider': p, 'citation_count': c}
        for p, c in provider_counts.items()
    ]
    
    brand_stats = [
        {'brand': b, 'mention_count': c}
        for b, c in brand_mentions.items()
    ]
    
    return success_response({
        'total_citations': len(items),
        'top_urls': top_urls,
        'provider_stats': provider_stats,
        'brand_stats': brand_stats
    }, event)
