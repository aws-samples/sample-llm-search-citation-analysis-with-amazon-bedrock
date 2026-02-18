"""
Get Stats API Lambda

Returns overall dashboard statistics.
Uses efficient query operations with GSIs instead of full table scans.
Counts are cached in a metadata item to avoid expensive scan operations.
"""

import sys
import logging
import time
import boto3
import os
from datetime import datetime

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.decorators import api_handler, validate, optional_provider
from shared.api_response import success_response
from shared.config import PROVIDERS

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = os.environ['SEARCH_RESULTS_TABLE']
CITATIONS_TABLE = os.environ['CITATIONS_TABLE']
CRAWLED_CONTENT_TABLE = os.environ['CRAWLED_CONTENT_TABLE']
KEYWORDS_TABLE = os.environ['KEYWORDS_TABLE']

search_results_table = dynamodb.Table(SEARCH_RESULTS_TABLE)
citations_table = dynamodb.Table(CITATIONS_TABLE)
crawled_table = dynamodb.Table(CRAWLED_CONTENT_TABLE)
keywords_table = dynamodb.Table(KEYWORDS_TABLE)

# Cache for table item counts (refreshed periodically via describe_table)
_count_cache = {}
_count_cache_ttl = 300  # 5 minutes


def _get_table_item_count(table, cache_key: str) -> int:
    """Get item count using scan with COUNT select for accuracy."""
    now = time.time()
    cached = _count_cache.get(cache_key)
    
    if cached and (now - cached['timestamp']) < _count_cache_ttl:
        return cached['count']
    
    try:
        response = table.scan(Select='COUNT')
        count = response.get('Count', 0)
        
        # Handle pagination for large tables
        while 'LastEvaluatedKey' in response:
            response = table.scan(Select='COUNT', ExclusiveStartKey=response['LastEvaluatedKey'])
            count += response.get('Count', 0)
        
        _count_cache[cache_key] = {'count': count, 'timestamp': now}
        return count
    except Exception as e:
        logger.warning(f"Failed to get item count for {table.table_name}: {e}")
        return cached['count'] if cached else 0


@api_handler
@validate({
    'provider': optional_provider()
})
def handler(event, context, provider=None):
    """
    GET /api/stats
    
    Query params (all optional):
        - provider: Filter stats by provider
    """
    # Get approximate counts using describe_table
    total_searches = _get_table_item_count(search_results_table, 'search_results')
    total_citations = _get_table_item_count(citations_table, 'citations')
    total_crawled = _get_table_item_count(crawled_table, 'crawled')
    unique_keywords = _get_table_item_count(keywords_table, 'keywords')
    
    # Get latest timestamp using ProviderIndex GSI
    providers = [provider] if provider else PROVIDERS
    timestamps = []
    
    for p in providers:
        try:
            response = search_results_table.query(
                IndexName='ProviderIndex',
                KeyConditionExpression='provider = :provider',
                ExpressionAttributeValues={':provider': p},
                ProjectionExpression='#ts',
                ExpressionAttributeNames={'#ts': 'timestamp'},
                ScanIndexForward=False,
                Limit=1
            )
            items = response.get('Items', [])
            if items:
                timestamps.append(items[0].get('timestamp', ''))
        except Exception as e:
            logger.debug(f"No data for provider {p}: {str(e)}")
            continue
    
    last_execution = max(timestamps) if timestamps else None
    
    return success_response({
        'total_searches': total_searches,
        'total_citations': total_citations,
        'total_crawled': total_crawled,
        'unique_keywords': unique_keywords,
        'last_execution': last_execution,
        'timestamp': datetime.utcnow().isoformat() + 'Z'
    }, event)
