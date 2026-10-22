"""
Get Crawled Content API

Retrieves crawled content including screenshots and SEO analysis, one
budget-bounded page at a time.

A crawled row carries up to 50,000 characters of page ``content``; in Spanish
that is several hundred KB once JSON-escaped, so pages are cut to
``PAGE_BUDGET_BYTES`` (``shared.partition_pages``) and continue with
``next_token``. ``include_content=false`` leaves the page text out (the crawl
history only lists crawls).
"""

import logging
import sys
from typing import Any

import boto3

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import success_response, validation_error
from shared.cursors import CURSOR_ERROR_MESSAGE, CURSOR_QUERY_PARAM, encode_cursor
from shared.decorators import api_handler, optional_limit, validate
from shared.env_vars import resolve_table_env
from shared.partition_pages import PartitionRead, cut_page, decode_key

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')

# Fail-fast: Required environment variables (audit #12 canonical naming).
CRAWLED_CONTENT_TABLE = resolve_table_env('DYNAMODB_TABLE_CRAWLED_CONTENT')

# Key attributes of a table row and of a KeywordIndex row (the GSI key plus the table key).
_TABLE_KEY = ('normalized_url', 'crawled_at')
_KEYWORD_INDEX_KEY = ('normalized_url', 'crawled_at', 'keyword')


def generate_presigned_url(s3_uri: str, expiration: int = 900) -> str | None:
    """Generate a presigned URL for S3 object.

    Args:
        s3_uri: S3 URI (s3://bucket/key)
        expiration: URL expiration in seconds (default: 900 = 15 minutes)
    """
    try:
        if not s3_uri or not s3_uri.startswith('s3://'):
            return None

        parts = s3_uri.replace('s3://', '').split('/', 1)
        bucket = parts[0]
        key = parts[1] if len(parts) > 1 else ''

        return s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': bucket, 'Key': key},
            ExpiresIn=expiration
        )
    except Exception:
        logger.exception("Error generating presigned URL")
        return None


def _read_rows(table: Any, url: str | None, keyword: str | None, limit: int, start_key: dict[str, Any] | None):
    """``(rows, LastEvaluatedKey)`` of the read the parameters select, newest first where there is an order."""
    if url:
        return PartitionRead('normalized_url', url, limit).query(table, start_key)
    if keyword:
        return PartitionRead('keyword', keyword, limit, index_name='KeywordIndex').query(table, start_key)
    params: dict[str, Any] = {'Limit': limit}
    if start_key is not None:
        params['ExclusiveStartKey'] = start_key
    response = table.scan(**params)
    return response.get('Items', []), response.get('LastEvaluatedKey')


def _shape(rows: list[dict[str, Any]], include_content: bool, include_screenshot_url: bool) -> None:
    """Drop the page text when not asked for and sign the screenshot links, in place."""
    for row in rows:
        if not include_content:
            row.pop('content', None)
        if include_screenshot_url and row.get('screenshot_s3_uri'):
            screenshot_url = generate_presigned_url(row['screenshot_s3_uri'])
            if screenshot_url:
                row['screenshot_url'] = screenshot_url


@api_handler
@validate({
    'url': {'type': str, 'max_length': 2048},
    'keyword': {'type': str, 'max_length': 500},
    'limit': optional_limit(default=50, max_val=500),
    'include_screenshot_url': {'type': bool, 'default': True},
    'include_history': {'type': bool, 'default': False},
    'include_content': {'type': bool, 'default': True},
    **CURSOR_QUERY_PARAM,
})
def handler(
    event, context, url=None, keyword=None, limit=50, include_screenshot_url=True, include_history=False,
    include_content=True, next_token=None,
):
    """
    API handler to get crawled content with screenshots and SEO analysis.

    Query params:
        - url: Specific URL (optional)
        - keyword: Filter by keyword (optional)
        - limit: Most rows per page (default: 50, max: 500)
        - include_screenshot_url: Generate presigned URLs for screenshots (default: true)
        - include_history: Include all historical crawls for the URL (default: false)
        - include_content: Include the crawled page text (default: true)
        - next_token: Continuation token from the previous page

    Returns ``{"items": [...], "count": n, "next_token": str | null}``.
    """
    table = dynamodb.Table(CRAWLED_CONTENT_TABLE)
    key_attributes = _KEYWORD_INDEX_KEY if keyword and not url else _TABLE_KEY

    start_key = None
    if next_token is not None:
        start_key = decode_key(next_token, key_attributes)
        if start_key is None:
            return validation_error(CURSOR_ERROR_MESSAGE, event, 'next_token')

    # The latest crawl of a URL is one row; its history is ``limit`` rows.
    query_limit = 1 if url and not include_history else limit
    rows, last_evaluated_key = _read_rows(table, url, keyword, query_limit, start_key)
    if url and not include_history:
        last_evaluated_key = None

    _shape(rows, include_content, include_screenshot_url)
    page, next_key = cut_page(rows, last_evaluated_key, key_attributes)
    if not url and not keyword:
        # A scan page has no order of its own (the cursor follows scan order,
        # so only the page is sorted); a partition is read newest first already.
        page.sort(key=lambda row: row.get('crawled_at', ''), reverse=True)

    # Rows are returned whole: a YouTube video's `content_type`, `provider`,
    # `author_name`, `author_url` and `thumbnail_url` (crawler oEmbed read)
    # pass through as stored.
    return success_response({
        'items': page,
        'count': len(page),
        'next_token': encode_cursor(next_key),
    }, event)
