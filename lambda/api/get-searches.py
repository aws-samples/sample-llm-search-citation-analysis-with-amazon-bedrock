"""
Get Searches API Lambda

Returns search results with optional filtering by keyword or provider.
"""

import logging
import sys
from typing import Any

import boto3

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import success_response
from shared.bounded_reads import newest_items
from shared.config import PROVIDERS
from shared.decorators import api_handler, optional_limit, validate
from shared.search_results import search_results_table_name

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = search_results_table_name()
table = dynamodb.Table(SEARCH_RESULTS_TABLE)
_PROVIDER_INDEX = 'ProviderIndex'


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
    items: list[dict[str, Any]] = []

    if keyword:
        # Query by keyword (partition key) - most efficient
        items = newest_items(table, 'keyword', keyword, limit)

        # Apply provider filter if also specified
        if provider:
            items = [item for item in items if item.get('provider', '').lower() == provider.lower()]

    elif provider:
        # Query by provider using ProviderIndex GSI
        items = newest_items(table, 'provider', provider.lower(), limit, index_name=_PROVIDER_INDEX)

    else:
        # No filter - query using ProviderIndex GSI for each provider.
        # Use the centralized PROVIDERS list so new providers (search/LLM)
        # automatically surface here without touching this handler.
        items_per_provider = max(limit // len(PROVIDERS), 50)

        for p in PROVIDERS:
            try:
                items.extend(newest_items(table, 'provider', p, items_per_provider, index_name=_PROVIDER_INDEX))
            except Exception:
                logger.exception('Error querying provider %s', p)
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
