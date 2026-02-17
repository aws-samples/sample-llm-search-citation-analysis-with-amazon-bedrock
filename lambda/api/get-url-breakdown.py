"""
Get URL Breakdown API Lambda

Returns keywords and providers that cited a specific URL.
"""

import sys
import logging
import boto3
from typing import Dict, Any, List
import os
from urllib.parse import unquote

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.decorators import api_handler, validate
from shared.api_response import success_response
from shared.utils import normalize_url

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = os.environ['SEARCH_RESULTS_TABLE']
search_results_table = dynamodb.Table(SEARCH_RESULTS_TABLE)


def _normalize_for_comparison(url: str) -> str:
    """Normalize URL for comparison - lowercase and remove trailing slash."""
    normalized = normalize_url(url)
    # Additional normalization for comparison
    normalized = normalized.lower().rstrip('/')
    return normalized


def _urls_match(url1: str, url2: str) -> bool:
    """Check if two URLs match after normalization."""
    return _normalize_for_comparison(url1) == _normalize_for_comparison(url2)


@api_handler
@validate({
    'url': {'required': True, 'type': str, 'max_length': 2048}
})
def handler(event: Dict[str, Any], context: Any, url: str) -> Dict[str, Any]:
    """
    GET /api/url-breakdown?url=https://example.com
    
    Returns breakdown of which keywords and providers cited this URL.
    """
    # URL decode in case it's encoded
    target_url = unquote(url)
    target_normalized = _normalize_for_comparison(target_url)
    
    logger.info(f"Looking for URL: {target_url}")
    logger.info(f"Normalized target: {target_normalized}")
    
    # Scan all search results with pagination
    # Note: For better performance at scale, consider adding a GSI on citations
    # or maintaining a separate URL-to-keyword mapping table
    breakdown = []
    last_evaluated_key = None
    items_scanned = 0
    max_items = 5000  # Safety limit
    
    while items_scanned < max_items:
        scan_params = {'Limit': 500}
        if last_evaluated_key:
            scan_params['ExclusiveStartKey'] = last_evaluated_key
        
        response = search_results_table.scan(**scan_params)
        items = response.get('Items', [])
        items_scanned += len(items)
        
        # Find all keyword-provider combinations that cited this URL
        for item in items:
            citations = item.get('citations', [])
            keyword = item.get('keyword', '')
            provider = item.get('provider', '')
            timestamp = item.get('timestamp', '')
            
            # Check if this URL is in the citations (with normalized comparison)
            for citation in citations:
                citation_url = citation if isinstance(citation, str) else citation.get('S', '')
                if citation_url and _urls_match(citation_url, target_url):
                    breakdown.append({
                        'keyword': keyword,
                        'provider': provider,
                        'timestamp': timestamp
                    })
                    break  # Only count once per search result
        
        # Check if there are more items to scan
        last_evaluated_key = response.get('LastEvaluatedKey')
        if not last_evaluated_key:
            break
    
    logger.info(f"Scanned {items_scanned} items, found {len(breakdown)} matches")
    
    # Sort by timestamp (most recent first)
    breakdown.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
    
    return success_response({
        'url': target_url,
        'total_citations': len(breakdown),
        'breakdown': breakdown
    }, event)
