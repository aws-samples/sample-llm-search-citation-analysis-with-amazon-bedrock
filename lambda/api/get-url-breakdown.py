"""
Get URL Breakdown API Lambda

Returns keywords and providers that cited a specific URL.

Backed by the ``UrlIndex`` GSI on the Citations table (PK=normalized_url,
SK=keyword, projection=ALL). Replaces the previous full-scan over
SearchResults — see audit item: "consider adding a GSI on citations or
maintaining a separate URL-to-keyword mapping table".

Full list (2.45.0 wave 5): every (keyword, provider) entry of the URL, most
recently first cited first (``first_seen``, set once by Deduplication, then
keyword and provider: a later run rewriting ``last_updated`` never moves an
entry), ``limit`` a page, ``next_token`` naming the last entry listed so the
next page starts right after it whatever was cited since (new entries sort
ahead of it), ``total_citations`` counting every entry; ``market_id`` keeps
the active keywords of that market. ``truncated`` says the read stopped at
its page cap or the request's time budget (the entries listed are a part of
the URL's).
"""

import logging
import sys
from typing import Any
from urllib.parse import unquote

import boto3

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import success_response, validation_error
from shared.bounded_reads import collect_capped_partition
from shared.cursors import CURSOR_ERROR_MESSAGE, CURSOR_QUERY_PARAM, decode_cursor, encode_cursor
from shared.decorators import api_handler, optional_limit, validate
from shared.env_vars import resolve_table_env
from shared.scope_params import MARKET_PARAM, SCOPE_QUERY_PARAMS, keywords_table_name, scope_from_request
from shared.utils import normalize_url

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables (audit #12 canonical naming).
CITATIONS_TABLE = resolve_table_env('DYNAMODB_TABLE_CITATIONS')
citations_table = dynamodb.Table(CITATIONS_TABLE)

# Inverse index GSI: PK=normalized_url, SK=keyword, projection=ALL.
URL_INDEX_NAME = 'UrlIndex'

# Pagination cap. Each page is up to 1 MB; a deduplicated Citations row is a
# few hundred bytes and a URL has one row per keyword citing it, so even a
# URL cited by every keyword of a 10x tenant (5,000 rows) reads in two pages.
_MAX_QUERY_PAGES = 100

#: Breakdown entries a page lists by default, and at most (``limit``).
DEFAULT_LIMIT = 1000
MAX_LIMIT = 1000


def _query_url_index(target_normalized: str) -> tuple[list[dict[str, Any]], bool]:
    """
    Query the ``UrlIndex`` GSI for every Citations row whose ``normalized_url``
    matches the target: the raw items and whether the page cap or the time
    budget cut the read.
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

    return items, truncated


def _keyed_breakdown(items: list[dict[str, Any]]) -> list[tuple[tuple[str, str, str], dict[str, Any]]]:
    """
    Each Citations row aggregates citing_providers; the breakdown response
    expands one entry per (keyword, provider) pair so existing UI consumers
    keep working unchanged. Each entry comes with its order key
    ``(first_seen, keyword, provider)``.
    """
    breakdown: list[tuple[tuple[str, str, str], dict[str, Any]]] = []
    for item in items:
        keyword = item.get('keyword', '')
        # last_updated is the most recent run that wrote this row; if
        # missing fall back to first_seen for legacy rows pre-dating the
        # field.
        timestamp = item.get('last_updated') or item.get('first_seen', '')
        first_seen = str(item.get('first_seen') or timestamp)

        # Legacy rows without provider tracking still represent a citation
        # event; surface them with provider="" rather than dropping them.
        providers = item.get('citing_providers') or ['']
        breakdown.extend(
            ((first_seen, keyword, provider), {'keyword': keyword, 'provider': provider, 'timestamp': timestamp})
            for provider in providers
        )

    return breakdown


def _ordered(breakdown: list[tuple[tuple[str, str, str], dict[str, Any]]]) -> list[tuple[tuple[str, str, str], dict[str, Any]]]:
    """Newest first by ``first_seen`` (set once, never rewritten), then keyword and provider: an order no later run changes."""
    by_name = sorted(breakdown, key=lambda pair: pair[0][1:])
    return sorted(by_name, key=lambda pair: pair[0][0], reverse=True)


def _is_after(key: tuple[str, str, str], last: tuple[str, str, str]) -> bool:
    """Whether the entry ``key`` comes after the entry ``last`` in ``_ordered``."""
    return key[0] < last[0] or (key[0] == last[0] and key[1:] > last[1:])


def _decode_after(token: str | None) -> tuple[tuple[str, str, str] | None, bool]:
    """The last entry a ``next_token`` names (``None`` without one) and whether the token is valid."""
    if token is None:
        return None, True
    decoded = decode_cursor(token, ('after',))
    after = None if decoded is None else decoded['after']
    if not isinstance(after, list) or len(after) != 3 or not all(isinstance(part, str) for part in after):
        return None, False
    return (after[0], after[1], after[2]), True


def _market_keywords(event: dict[str, Any], market_id: str | None) -> tuple[set[str] | None, dict[str, Any] | None]:
    """The active keywords of ``market_id`` (``None``: every keyword), or the 400 of a malformed market."""
    if market_id is None:
        return None, None
    report_scope, rejected = scope_from_request(event, {MARKET_PARAM: market_id}, dynamodb.Table(keywords_table_name()))
    if rejected is not None:
        return None, rejected
    return (set(report_scope.keywords) if report_scope else set()), None


@api_handler
@validate({
    'url': {'required': True, 'type': str, 'max_length': 2048},
    MARKET_PARAM: SCOPE_QUERY_PARAMS[MARKET_PARAM],
    'limit': optional_limit(default=DEFAULT_LIMIT, max_val=MAX_LIMIT),
    **CURSOR_QUERY_PARAM,
})
def handler(
    event: dict[str, Any], context: Any, url: str, limit: int = DEFAULT_LIMIT, next_token: str | None = None, **market: str | None,
) -> dict[str, Any]:
    """
    GET /api/url-breakdown?url=https://example.com[&market_id=…][&limit=…][&next_token=…]

    Returns a breakdown of which keywords and providers cited this URL, one
    page of every entry (see the module docstring). Implementation queries
    the ``UrlIndex`` GSI on the Citations table instead of scanning
    SearchResults.
    """
    after, valid = _decode_after(next_token)
    if not valid:
        return validation_error(CURSOR_ERROR_MESSAGE, event, 'next_token')
    keywords, rejected = _market_keywords(event, market.get(MARKET_PARAM))
    if rejected is not None:
        return rejected
    target_url = unquote(url)
    target_normalized = normalize_url(target_url)

    logger.info("Looking up URL %s (normalized: %s)", target_url, target_normalized)

    items, truncated = _query_url_index(target_normalized)
    if keywords is not None:
        items = [item for item in items if item.get('keyword') in keywords]
    ordered = _ordered(_keyed_breakdown(items))
    rest = ordered if after is None else [pair for pair in ordered if _is_after(pair[0], after)]
    page = rest[:limit]

    logger.info(
        "Returning %d breakdown entries from %d Citations rows for %s",
        len(ordered), len(items), target_normalized,
    )

    return success_response({
        'url': target_url,
        'total_citations': len(ordered),
        'breakdown': [entry for _, entry in page],
        'next_token': encode_cursor({'after': list(page[-1][0])}) if len(rest) > limit else None,
        'truncated': truncated,
    }, event)
