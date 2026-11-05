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
from typing import Any

import boto3

from shared.api_response import success_response, validation_error
from shared.citation_pages import (
    CONTENT_TYPE_FILTERS,
    DICT_VIEW,
    SORT_COLUMNS,
    SORT_ORDERS,
    BrandTerms,
    CitationQuery,
    aggregate_citations,
    list_entry,
    tracked_brand_terms,
)
from shared.citation_rollup_source import (
    query_keyword_citations,
    query_scope_citations,
    reading_deadline,
    scan_citations,
)
from shared.cursors import CURSOR_ERROR_MESSAGE, CURSOR_QUERY_PARAM, decode_offset_cursor, encode_offset_cursor
from shared.decorators import api_handler, optional_limit, validate
from shared.request_deadline import current_deadline
from shared.response_budget import take_within_budget
from shared.scope_params import (
    SCOPE_QUERY_PARAMS,
    ReportScope,
    keywords_table_name,
    scope_from_request,
)
from shared.utils import get_brand_config

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Fail-fast: Required environment variables
CITATIONS_TABLE = os.environ['DYNAMODB_TABLE_CITATIONS']
dynamodb = boto3.resource('dynamodb')
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


def _brand_config() -> dict[str, Any]:
    """The brand config (``{}`` without a table): its tracked brands and ``updated_at``."""
    return get_brand_config(BRAND_CONFIG_TABLE)


def _get_tracked_brands(brand_config: dict[str, Any]) -> BrandTerms:
    """The tracked brands URLs are matched on."""
    return tracked_brand_terms(brand_config)


# Read bounds, to keep the read inside the API's 29 s and the Lambda's memory.
# A 1 MB DynamoDB page holds about 2,800 Citations rows (the limit counts rows
# before the projection). The table scan reads ``SCAN_SEGMENTS`` segments in
# parallel, at most ``_MAX_SEGMENT_PAGES`` pages each; one keyword's
# partition stops after ``_MAX_KEYWORD_PAGES``; a multi-keyword scope shares
# ONE budget of ``_MAX_SCOPE_PAGES`` pages and ``_MAX_SCOPE_ROWS`` rows across
# its keywords, read ``SCOPE_MAX_WORKERS`` partitions at a time. Every read
# also stops ``_AGGREGATE_RESERVE_SECONDS`` before the request's deadline,
# which leaves that time for aggregating, sorting and serializing the rows.
# A cut read is logged and reported as ``truncated: true``.
_MAX_SEGMENT_PAGES = 8
_MAX_KEYWORD_PAGES = 25
_MAX_SCOPE_PAGES = 100
_MAX_SCOPE_ROWS = 200_000
_AGGREGATE_RESERVE_SECONDS = 6.0


def _read_citations(report_scope: ReportScope | None) -> tuple[list[dict[str, Any]], bool]:
    """The scope's projected Citations rows: ``(rows, truncated)``.

    No scope scans the table; one keyword queries its partition; a group,
    market, id or ``all`` scope queries one partition per keyword.
    """
    if report_scope is None:
        return scan_citations(citations_table, _MAX_SEGMENT_PAGES)
    if report_scope.is_single_keyword:
        return query_keyword_citations(citations_table, report_scope.keywords[0], _MAX_KEYWORD_PAGES)
    return query_scope_citations(
        citations_table, report_scope.keywords,
        max_pages=_MAX_SCOPE_PAGES, max_rows=_MAX_SCOPE_ROWS, max_pages_per_keyword=_MAX_KEYWORD_PAGES,
    )


def _read_scope(report_scope: ReportScope | None) -> tuple[list[dict[str, Any]], bool]:
    """``_read_citations`` stopping early enough to answer, logged when cut."""
    with reading_deadline(_AGGREGATE_RESERVE_SECONDS) as deadline:
        items, truncated = _read_citations(report_scope)
    truncated = truncated or deadline.cut
    if truncated:
        logger.warning(
            "Citations read stopped at its cap or time budget (scope=%s, keywords=%d, items=%d). "
            "Results are truncated.",
            report_scope.label if report_scope else '<table>',
            len(report_scope.keywords) if report_scope else 0, len(items),
        )
    return items, truncated


def _page_start(event, offset, next_token) -> tuple[int, dict[str, Any] | None]:
    """Where the page starts: ``next_token`` wins over ``offset``; the 400 for a malformed token."""
    if next_token is None:
        return offset or 0, None
    start = decode_offset_cursor(next_token)
    if start is None:
        return 0, validation_error(CURSOR_ERROR_MESSAGE, event, 'next_token')
    return start, None


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

    tracked_brands = _get_tracked_brands(_brand_config())
    items, truncated = _read_scope(report_scope)
    logger.info('Fetched %s citation records from Citations table', len(items))

    aggregate = aggregate_citations(items, tracked_brands)
    query = CitationQuery(
        sort=sort or 'citations', order=order or 'desc', url_contains=url_contains or '',
        min_citations=min_citations, content_type=content_type or 'all',
    )
    matching = query.apply(aggregate.top_urls, DICT_VIEW)
    window = [list_entry(entry, include_keywords) for entry in matching[start:start + limit]]
    page, _ = take_within_budget(window)

    return success_response({
        'scope': report_scope.describe() if report_scope is not None else None,
        **aggregate.totals(),
        'matched_urls': len(matching),
        'top_urls': page,
        'next_token': encode_offset_cursor(start + len(page), len(matching)),
        'truncated': truncated or current_deadline().cut,
    }, event)
