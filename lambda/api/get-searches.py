"""
Get Searches API Lambda

Returns SearchResults rows newest first, one budget-bounded page at a time,
with optional filtering by keyword, provider or persona.

Three reads, each paginated with ``next_token`` (``shared.partition_pages``):

- ``keyword``: that keyword's partition (sort key ``timestamp_provider``,
  newest first); ``provider`` narrows it after the read.
- ``provider`` alone: that provider's ``ProviderIndex`` partition.
- neither: every configured provider's ``ProviderIndex`` partition, merged
  newest first; the token keeps one start key per provider.

List rows leave out the answer text and the bulky extraction fields
(``response``, ``brands``, ``search_results``, ``metadata``): a row with them
is 10-15 KB, and the Recent Searches view and the MCP tool only list runs.
``include_response=true`` returns whole rows (the keyword detail renders the
answers); pages are cut to ``PAGE_BUDGET_BYTES`` either way.
"""

import logging
import sys
from typing import Any

import boto3

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import success_response, validation_error
from shared.config import PROVIDERS
from shared.cursors import CURSOR_ERROR_MESSAGE, CURSOR_QUERY_PARAM
from shared.decorators import api_handler, optional_limit, validate
from shared.partition_pages import (
    PartitionRead,
    RowFilter,
    decode_key,
    decode_merged_cursor,
    newest_merged_page,
    partition_page,
)
from shared.search_results import search_results_table_name

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = search_results_table_name()
table = dynamodb.Table(SEARCH_RESULTS_TABLE)
_PROVIDER_INDEX = 'ProviderIndex'

DEFAULT_LIMIT = 50
MAX_LIMIT = 500

# Key attributes of a table row and of a ProviderIndex row (the GSI key plus the table key).
_TABLE_KEY = ('keyword', 'timestamp_provider')
_PROVIDER_INDEX_KEY = ('keyword', 'timestamp_provider', 'provider', 'timestamp')

# What a list row carries: every field the run lists read, never the answer text.
LIST_ATTRIBUTES = (
    'keyword', 'timestamp_provider', 'timestamp', 'provider', 'provider_type', 'query_prompt_id',
    'query_prompt_name', 'market_id', 'citations', 'status', 'brand_count', 'error', 'raw_response_s3_uri',
)


def _keep(provider: str | None, query_prompt_id: str | None) -> RowFilter | None:
    """The after-read filter for the provider (case-insensitive) and persona (missing = ``default``)."""
    if provider is None and query_prompt_id is None:
        return None
    wanted_provider = provider.lower() if provider else None

    def keep(row: dict[str, Any]) -> bool:
        if wanted_provider is not None and str(row.get('provider', '')).lower() != wanted_provider:
            return False
        return query_prompt_id is None or row.get('query_prompt_id', 'default') == query_prompt_id

    return keep


def _page_body(rows: list[dict[str, Any]], next_token: str | None) -> dict[str, Any]:
    return {'searches': rows, 'count': len(rows), 'next_token': next_token}


def _single_partition(event, read: PartitionRead, key: tuple[str, ...], next_token, keep):
    start_key = None
    if next_token is not None:
        start_key = decode_key(next_token, key)
        if start_key is None:
            return validation_error(CURSOR_ERROR_MESSAGE, event, 'next_token')
    rows, token = partition_page(table, read, key, start_key, keep)
    return success_response(_page_body(rows, token), event)


def _every_provider(event, limit: int, projection, next_token, keep):
    cursor = None
    if next_token is not None:
        cursor = decode_merged_cursor(next_token, _PROVIDER_INDEX_KEY)
        if cursor is None:
            return validation_error(CURSOR_ERROR_MESSAGE, event, 'next_token')
    # The centralized PROVIDERS list, so new providers surface here unchanged.
    reads = {
        provider: PartitionRead('provider', provider, limit, index_name=_PROVIDER_INDEX, projection=projection)
        for provider in PROVIDERS
    }
    page = newest_merged_page(
        table, reads, key_attributes=_PROVIDER_INDEX_KEY, sort_attribute='timestamp',
        cursor=cursor, max_items=limit, keep=keep,
    )
    return success_response(_page_body(page.rows, page.next_token), event)


@api_handler
@validate({
    'keyword': {'type': str, 'max_length': 500},
    'provider': {'type': str, 'max_length': 50},
    'query_prompt_id': {'type': str, 'max_length': 100},
    'limit': optional_limit(default=DEFAULT_LIMIT, max_val=MAX_LIMIT),
    'include_response': {'type': bool, 'default': False},
    **CURSOR_QUERY_PARAM,
})
def handler(
    event, context, keyword=None, provider=None, query_prompt_id=None, limit=DEFAULT_LIMIT,
    include_response=False, next_token=None,
):
    """
    GET /api/searches?keyword=&provider=&query_prompt_id=&limit=&include_response=&next_token=

    Returns ``{"searches": [...], "count": n, "next_token": str | null}``:
    at most ``limit`` rows (default 50, max 500), newest first, cut to the page
    budget. Follow ``next_token`` for older rows; a filtered page can be short
    or empty while ``next_token`` is still set.
    """
    projection = None if include_response else LIST_ATTRIBUTES
    if keyword:
        read = PartitionRead('keyword', keyword, limit, projection=projection)
        return _single_partition(event, read, _TABLE_KEY, next_token, _keep(provider, query_prompt_id))
    if provider:
        read = PartitionRead('provider', provider.lower(), limit, index_name=_PROVIDER_INDEX, projection=projection)
        return _single_partition(event, read, _PROVIDER_INDEX_KEY, next_token, _keep(None, query_prompt_id))
    return _every_provider(event, limit, projection, next_token, _keep(None, query_prompt_id))
