"""
Get Citations API Lambda

Returns the deduplicated citation URLs of a scope, sorted, filtered and paged
server-side, plus provider, brand and content-type totals over the whole scope.
Queries the CitationAnalysis-Citations table (deduplicated data) instead of raw search results.

A large scope has tens of thousands of distinct URLs; returned whole, with
each URL's keyword list, that was about 18 MB, three times the Lambda response
cap (the 502 this design fixes). A page now holds at most ``limit`` URLs, cut
to ``PAGE_BUDGET_BYTES``, without the per-URL keyword texts unless
``include_keywords=true`` (the Excel export, which follows every page);
``/api/url-breakdown`` serves one URL's keywords.
"""

import logging
import os
import sys
from collections import Counter, defaultdict
from typing import Any

import boto3

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import success_response, validation_error
from shared.bounded_reads import collect_capped_partition
from shared.citation_pages import (
    CONTENT_TYPE_FILTERS,
    SORT_COLUMNS,
    SORT_ORDERS,
    CitationQuery,
    base_order,
    list_entry,
)
from shared.cursors import CURSOR_ERROR_MESSAGE, CURSOR_QUERY_PARAM, decode_offset_cursor, encode_offset_cursor
from shared.decorators import api_handler, optional_limit, validate
from shared.dynamodb_batch import collect_capped_items
from shared.response_budget import take_within_budget
from shared.scope_params import (
    SCOPE_MAX_WORKERS,
    SCOPE_QUERY_PARAMS,
    keywords_table_name,
    map_scope_keywords,
    scope_from_request,
)
from shared.utils import get_brand_config
from shared.youtube import CONTENT_TYPES, stored_content_type

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
CITATIONS_TABLE = os.environ['DYNAMODB_TABLE_CITATIONS']
citations_table = dynamodb.Table(CITATIONS_TABLE)
KEYWORDS_TABLE = keywords_table_name()

# Optional: Brand config table for dynamic brand detection
BRAND_CONFIG_TABLE = os.environ.get('DYNAMODB_TABLE_BRAND_CONFIG')

DEFAULT_LIMIT = 100
MAX_LIMIT = 1000

CITATION_QUERY_PARAMS: dict[str, dict[str, Any]] = {
    'limit': optional_limit(default=DEFAULT_LIMIT, max_val=MAX_LIMIT),
    'offset': {'type': int, 'min': 0},
    'sort': {'type': str, 'choices': list(SORT_COLUMNS)},
    'order': {'type': str, 'choices': list(SORT_ORDERS)},
    'url_contains': {'type': str, 'max_length': 2048},
    'min_citations': {'type': int, 'min': 0},
    'content_type': {'type': str, 'choices': list(CONTENT_TYPE_FILTERS)},
    'include_keywords': {'type': bool, 'default': False},
    **CURSOR_QUERY_PARAM,
}
"""The list parameters; ``offset`` is a random-access alternative to ``next_token`` (the dashboard pager)."""


def _get_tracked_brands():
    """Get all tracked brands from config for URL matching."""
    config = get_brand_config(BRAND_CONFIG_TABLE)
    tracked_brands = config.get('tracked_brands', {})

    brands = []
    for category in ['first_party', 'competitors']:
        for brand in tracked_brands.get(category, []):
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


# Read caps, to keep the read inside the API's 29 s and the Lambda's memory.
# At 1 MB per page (DynamoDB limit), a page holds a few thousand deduplicated
# citations (a few hundred bytes each). One keyword's partition, or the full
# scan, stops after ``_MAX_SCAN_PAGES``; a multi-keyword scope shares
# ``_MAX_SCOPE_PAGES`` between its keywords (at least one page each), read
# ``SCOPE_MAX_WORKERS`` partitions at a time. A capped read is logged and
# reported as ``truncated: true``.
_MAX_SCAN_PAGES = 25
_MAX_SCOPE_PAGES = 100


def _query_keyword_citations(keyword: str, max_pages: int = _MAX_SCAN_PAGES) -> tuple[list[dict[str, Any]], bool]:
    """Query the Citations partition of one keyword, bounded by ``max_pages``."""
    return collect_capped_partition(citations_table, 'keyword', keyword, max_pages)


def _query_scope_citations(keywords: list[str]) -> tuple[list[dict[str, Any]], bool]:
    """Every keyword's partition, in parallel, sharing the scope's page cap."""
    pages_per_keyword = min(_MAX_SCAN_PAGES, max(1, _MAX_SCOPE_PAGES // max(1, len(keywords))))
    partitions = map_scope_keywords(
        keywords,
        lambda keyword: _query_keyword_citations(keyword, pages_per_keyword),
        lambda _keyword: ([], True),
    )
    items = [item for partition_items, _ in partitions for item in partition_items]
    return items, any(truncated for _, truncated in partitions)


def _scan_all_citations(keyword=None, keywords=None) -> tuple[list[dict[str, Any]], bool]:
    """
    Read the deduplicated Citations table: ``(rows, truncated)``.

    ``keyword`` queries one partition; ``keywords`` (a resolved group / id
    scope) queries one partition per keyword instead of scanning; with
    neither, a full scan covers every keyword.

    Every path is capped (see ``_MAX_SCOPE_PAGES``) and logs a warning when the
    cap is hit so the truncation is visible in CloudWatch.
    """
    if keyword:
        items, truncated = _query_keyword_citations(keyword)
    elif keywords is not None:
        items, truncated = _query_scope_citations(keywords)
    else:
        # Full scan for all keywords
        items, truncated = collect_capped_items(citations_table.scan, _MAX_SCAN_PAGES)

    if truncated:
        logger.warning(
            "Citations read hit its page cap (keyword=%s, keywords=%d, workers=%d, items=%d). "
            "Results are truncated.",
            keyword or '<scope>', len(keywords or ()), SCOPE_MAX_WORKERS, len(items),
        )

    return items, truncated


def _aggregate_citations(items, tracked_brands):
    """
    Aggregate citations by normalized_url across all keywords.
    Each item in the Citations table has: keyword, normalized_url, citation_count,
    citing_providers, priority, content_type, first_seen, last_updated.
    Rows stored before ``content_type`` existed carry none; theirs is derived
    from the URL (``shared.youtube.stored_content_type``).
    """
    # Group by normalized_url across keywords
    url_data = defaultdict(lambda: {
        'total_count': 0,
        'keywords': set(),
        'providers': set(),
        'provider_counts': Counter(),
        'content_type': None,
    })

    provider_totals = Counter()
    brand_mentions = Counter()

    for item in items:
        url = item.get('normalized_url', '')
        if not url:
            continue

        kw = item.get('keyword', '')
        count = int(item.get('citation_count', 0))
        providers = item.get('citing_providers', [])

        entry = url_data[url]
        entry['total_count'] += count
        if entry['content_type'] is None:
            entry['content_type'] = stored_content_type(item.get('content_type'), url)
        if kw:
            entry['keywords'].add(kw)
        for p in providers:
            entry['providers'].add(p)
            entry['provider_counts'][p] += 1

        # Provider stats
        for p in providers:
            provider_totals[p] += 1

        # Brand detection
        url_lower = url.lower()
        detected_brand = _detect_brand_in_url(url_lower, tracked_brands)
        brand_mentions[detected_brand] += count

    return url_data, provider_totals, brand_mentions


def content_type_counts(top_urls: list[dict[str, Any]]) -> dict[str, int]:
    """Distinct URLs per content type, every type present (``{'video': 2, 'page': 40}``)."""
    counts: dict[str, int] = dict.fromkeys(CONTENT_TYPES, 0)
    for top_url in top_urls:
        counts[top_url['content_type']] += 1
    return counts


def _top_urls(url_data) -> list[dict[str, Any]]:
    """Every distinct URL of the scope, in the base order (most cited first)."""
    return base_order([
        {
            'url': url,
            'citation_count': data['total_count'],
            'by_provider': dict(data['provider_counts']),
            'keyword_count': len(data['keywords']),
            'keywords': sorted(data['keywords']),
            'content_type': data['content_type'],
        }
        for url, data in url_data.items()
    ])


def _page_start(event, offset, next_token) -> tuple[int, dict[str, Any] | None]:
    """Where the page starts: ``next_token`` wins over ``offset``; the 400 for a malformed token."""
    if next_token is None:
        return offset or 0, None
    start = decode_offset_cursor(next_token)
    if start is None:
        return 0, validation_error(CURSOR_ERROR_MESSAGE, event, 'next_token')
    return start, None


def _read_scope(report_scope) -> tuple[list[dict[str, Any]], bool]:
    if report_scope is None:
        return _scan_all_citations()
    if report_scope.is_single_keyword:
        return _scan_all_citations(keyword=report_scope.keywords[0])
    return _scan_all_citations(keywords=list(report_scope.keywords))


@api_handler
@validate({**SCOPE_QUERY_PARAMS, **CITATION_QUERY_PARAMS})
def handler(
    event, context, limit=DEFAULT_LIMIT, offset=None, sort=None, order=None, url_contains=None,
    min_citations=None, content_type=None, include_keywords=False, next_token=None, **scope_params,
):
    """
    GET /api/citations?keyword= | group_id= | keyword_ids= | market_id=
        &limit=&next_token=|offset=&sort=citations|keywords|domain&order=desc|asc
        &url_contains=&min_citations=&content_type=all|video|page&include_keywords=

    Returns one page of the scope's distinct citation URLs (all keywords when
    no scope is given) in the requested order, after the filters:
    ``top_urls`` (at most ``limit``, default 100, cut to the page budget),
    ``next_token`` (``null`` on the last page) and ``matched_urls`` (URLs
    passing the filters). Every page also carries the scope-wide totals,
    whatever the filters: ``total_citations`` (Citations rows),
    ``total_urls``, ``total_citation_count``, ``content_type_counts``,
    ``provider_stats``, ``brand_stats``, and ``truncated`` (a read cap was hit).
    """
    start, rejected = _page_start(event, offset, next_token)
    if rejected:
        return rejected
    report_scope, rejected = scope_from_request(event, scope_params, dynamodb.Table(KEYWORDS_TABLE))
    if rejected:
        return rejected

    tracked_brands = _get_tracked_brands()
    items, truncated = _read_scope(report_scope)
    logger.info('Fetched %s citation records from Citations table', len(items))

    url_data, provider_totals, brand_mentions = _aggregate_citations(items, tracked_brands)
    top_urls = _top_urls(url_data)
    query = CitationQuery(
        sort=sort or 'citations', order=order or 'desc', url_contains=url_contains or '',
        min_citations=min_citations, content_type=content_type or 'all',
    )
    matching = query.apply(top_urls)
    window = [list_entry(entry, include_keywords) for entry in matching[start:start + limit]]
    page, _ = take_within_budget(window)

    return success_response({
        'scope': report_scope.describe() if report_scope is not None else None,
        'total_citations': len(items),
        'total_urls': len(top_urls),
        'total_citation_count': sum(entry['citation_count'] for entry in top_urls),
        'matched_urls': len(matching),
        'top_urls': page,
        'next_token': encode_offset_cursor(start + len(page), len(matching)),
        'truncated': truncated,
        'content_type_counts': content_type_counts(top_urls),
        'provider_stats': [{'provider': p, 'citation_count': c} for p, c in provider_totals.items()],
        'brand_stats': [{'brand': b, 'mention_count': c} for b, c in brand_mentions.items()],
    }, event)
