"""
Get Searches API Lambda

Returns search results with optional filtering by keyword or provider.
"""

import logging
import sys

import boto3
from boto3.dynamodb.conditions import Key

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import success_response
from shared.config import PROVIDERS
from shared.decorators import api_handler, optional_limit, validate
from shared.env_vars import resolve_table_env

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables (audit #12 canonical naming).
SEARCH_RESULTS_TABLE = resolve_table_env('DYNAMODB_TABLE_SEARCH_RESULTS', 'SEARCH_RESULTS_TABLE')
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
        # No filter - query using ProviderIndex GSI for each provider.
        # Use the centralized PROVIDERS list so new providers (search/LLM)
        # automatically surface here without touching this handler.
        items_per_provider = max(limit // len(PROVIDERS), 50)

        for p in PROVIDERS:
            try:
                response = table.query(
                    IndexName='ProviderIndex',
                    KeyConditionExpression=Key('provider').eq(p),
                    ScanIndexForward=False,
                    Limit=items_per_provider
                )
                items.extend(response.get('Items', []))
            except Exception as e:
                logger.error(f"Error querying provider {p}: {e!s}")
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
