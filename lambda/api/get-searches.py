"""
Get Searches API Lambda

Returns search results with optional filtering by keyword or provider.
"""

import sys
import logging
import boto3
from boto3.dynamodb.conditions import Key
import os

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.decorators import api_handler, validate, optional_limit
from shared.api_response import success_response

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = os.environ['SEARCH_RESULTS_TABLE']
table = dynamodb.Table(SEARCH_RESULTS_TABLE)


@api_handler
@validate({
    'keyword': {'type': str, 'max_length': 500},
    'provider': {'type': str, 'max_length': 50},
    'query_prompt_id': {'type': str, 'max_length': 100},
    'limit': optional_limit(default=500, max_val=1000)
})
def handler(event, context, keyword=None, provider=None, query_prompt_id=None, limit=500):
    """
    GET /api/searches?keyword=xxx&provider=xxx&query_prompt_id=xxx&limit=50
    
    Returns list of search results with optional filters.
    """
    items = []
    
    if keyword:
        # Query by keyword (partition key) - most efficient
        response = table.query(
            KeyConditionExpression=Key('keyword').eq(keyword),
            ScanIndexForward=False,
            Limit=limit
        )
        items = response.get('Items', [])
        
        # Apply provider filter if also specified
        if provider:
            items = [item for item in items if item.get('provider', '').lower() == provider.lower()]
            
    elif provider:
        # Query by provider using ProviderIndex GSI
        response = table.query(
            IndexName='ProviderIndex',
            KeyConditionExpression=Key('provider').eq(provider.lower()),
            ScanIndexForward=False,
            Limit=limit
        )
        items = response.get('Items', [])
        
    else:
        # No filter - query using ProviderIndex GSI for each provider
        providers = ['openai', 'perplexity', 'gemini', 'claude']
        items_per_provider = max(limit // len(providers), 50)
        
        for p in providers:
            try:
                response = table.query(
                    IndexName='ProviderIndex',
                    KeyConditionExpression=Key('provider').eq(p),
                    ScanIndexForward=False,
                    Limit=items_per_provider
                )
                items.extend(response.get('Items', []))
            except Exception as e:
                logger.error(f"Error querying provider {p}: {str(e)}")
                continue
    
    # Sort by timestamp descending
    items.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
    
    # Filter by query prompt if specified
    if query_prompt_id:
        items = [item for item in items if item.get('query_prompt_id', 'default') == query_prompt_id]
    
    return success_response({
        'searches': items[:limit],
        'count': len(items)
    }, event)
