"""
Get URL Breakdown API Lambda

Returns keywords and providers that cited a specific URL.

Backed by the ``UrlIndex`` GSI on the Citations table (PK=normalized_url,
SK=keyword, projection=ALL). Replaces the previous full-scan over
SearchResults — see audit item: "consider adding a GSI on citations or
maintaining a separate URL-to-keyword mapping table".
"""

import logging
import sys
from typing import Any
from urllib.parse import unquote

import boto3

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import success_response
from shared.bounded_reads import collect_capped_partition
from shared.decorators import api_handler, validate
from shared.env_vars import resolve_table_env
from shared.utils import normalize_url

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables (audit #12 canonical naming).
CITATIONS_TABLE = resolve_table_env('DYNAMODB_TABLE_CITATIONS')
citations_table = dynamodb.Table(CITATIONS_TABLE)

# Inverse index GSI: PK=normalized_url, SK=keyword, projection=ALL.
URL_INDEX_NAME = 'UrlIndex'

# Pagination cap. Each page is up to 1 MB; with the deduplicated Citations
# rows (a few hundred bytes each) and the cap of MAX_CITATIONS_PER_KEYWORD
# rows per keyword, even a globally cited URL stays well under this limit.
_MAX_QUERY_PAGES = 10


def _query_url_index(target_normalized: str) -> list[dict[str, Any]]:
    """
    Query the ``UrlIndex`` GSI for every Citations row whose ``normalized_url``
    matches the target. Returns the raw items so the caller can shape the
    response.
    """
    items, truncated = collect_capped_partition(
        citations_table, 'normalized_url', target_normalized, _MAX_QUERY_PAGES, index_name=URL_INDEX_NAME,
    )
    if truncated:
        logger.warning(
            "UrlIndex query hit the %d-page cap (url=%s, items=%d). "
            "Results are truncated.",
            _MAX_QUERY_PAGES, target_normalized, len(items),
        )

    return items


def _expand_to_breakdown(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Each Citations row aggregates citing_providers; the breakdown response
    expands one entry per (keyword, provider) pair so existing UI consumers
    keep working unchanged.
    """
    breakdown: list[dict[str, Any]] = []
    for item in items:
        keyword = item.get('keyword', '')
        # last_updated is the most recent run that wrote this row; if
        # missing fall back to first_seen for legacy rows pre-dating the
        # field.
        timestamp = item.get('last_updated') or item.get('first_seen', '')

        providers = item.get('citing_providers') or []
        if not providers:
            # Legacy rows without provider tracking still represent a
            # citation event; surface them with provider="" rather than
            # dropping them.
            breakdown.append({
                'keyword': keyword,
                'provider': '',
                'timestamp': timestamp,
            })
            continue

        breakdown.extend(
            {'keyword': keyword, 'provider': provider, 'timestamp': timestamp}
            for provider in providers
        )

    return breakdown


@api_handler
@validate({
    'url': {'required': True, 'type': str, 'max_length': 2048}
})
def handler(event: dict[str, Any], context: Any, url: str) -> dict[str, Any]:
    """
    GET /api/url-breakdown?url=https://example.com

    Returns a breakdown of which keywords and providers cited this URL.
    Implementation queries the ``UrlIndex`` GSI on the Citations table
    instead of scanning SearchResults.
    """
    target_url = unquote(url)
    target_normalized = normalize_url(target_url)

    logger.info("Looking up URL %s (normalized: %s)", target_url, target_normalized)

    items = _query_url_index(target_normalized)
    breakdown = _expand_to_breakdown(items)

    # Sort by timestamp (most recent first) for stable, user-friendly output.
    breakdown.sort(key=lambda entry: entry.get('timestamp', ''), reverse=True)

    logger.info(
        "Returning %d breakdown entries from %d Citations rows for %s",
        len(breakdown), len(items), target_normalized,
    )

    return success_response({
        'url': target_url,
        'total_citations': len(breakdown),
        'breakdown': breakdown,
    }, event)
