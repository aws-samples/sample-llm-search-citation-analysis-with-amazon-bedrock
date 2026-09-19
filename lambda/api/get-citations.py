"""
Get Citations API Lambda

Returns deduplicated citation URLs sorted by total mentions across all keywords.
Queries the CitationAnalysis-Citations table (deduplicated data) instead of raw search results.
"""

import logging
import os
import sys
from collections import Counter, defaultdict
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import success_response
from shared.decorators import api_handler, validate
from shared.scope_params import SCOPE_QUERY_PARAMS, keywords_table_name, scope_from_request
from shared.utils import get_brand_config

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
CITATIONS_TABLE = os.environ['DYNAMODB_TABLE_CITATIONS']
citations_table = dynamodb.Table(CITATIONS_TABLE)
KEYWORDS_TABLE = keywords_table_name()

# Optional: Brand config table for dynamic brand detection
BRAND_CONFIG_TABLE = os.environ.get('DYNAMODB_TABLE_BRAND_CONFIG')


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


# Cap paginated scans/queries to prevent runaway cost and Lambda timeouts.
# At 1 MB per page (DynamoDB limit), 25 pages is ~25 MB of item data — plenty
# for the Citations table which is bounded to ~20 items per keyword after
# deduplication, and a safety net if the table ever grows unexpectedly.
# See audit item 13.
_MAX_SCAN_PAGES = 25


def _query_keyword_citations(keyword: str) -> tuple[list[dict[str, Any]], bool]:
    """Query the Citations partition of one keyword, bounded by ``_MAX_SCAN_PAGES``."""
    items: list[dict[str, Any]] = []
    params: dict[str, Any] = {'KeyConditionExpression': Key('keyword').eq(keyword)}
    response = citations_table.query(**params)
    items.extend(response.get('Items', []))
    pages = 1
    last_evaluated_key = response.get('LastEvaluatedKey')
    while last_evaluated_key and pages < _MAX_SCAN_PAGES:
        response = citations_table.query(**params, ExclusiveStartKey=last_evaluated_key)
        items.extend(response.get('Items', []))
        pages += 1
        last_evaluated_key = response.get('LastEvaluatedKey')
    return items, bool(last_evaluated_key)


def _scan_all_citations(keyword=None, keywords=None) -> list[dict[str, Any]]:
    """
    Read the deduplicated Citations table.

    ``keyword`` queries one partition; ``keywords`` (a resolved group / id
    scope) queries one partition per keyword instead of scanning; with
    neither, a full scan covers every keyword.

    Every path is bounded by ``_MAX_SCAN_PAGES`` and logs a warning when the
    cap is hit so the truncation is visible in CloudWatch.
    """
    items: list[dict[str, Any]] = []
    truncated = False

    if keyword:
        items, truncated = _query_keyword_citations(keyword)
    elif keywords is not None:
        for text in keywords:
            partition_items, partition_truncated = _query_keyword_citations(text)
            items.extend(partition_items)
            truncated = truncated or partition_truncated
    else:
        # Full scan for all keywords
        response = citations_table.scan()
        items.extend(response.get('Items', []))
        pages_scanned = 1
        last_evaluated_key = response.get('LastEvaluatedKey')
        while last_evaluated_key and pages_scanned < _MAX_SCAN_PAGES:
            response = citations_table.scan(ExclusiveStartKey=last_evaluated_key)
            items.extend(response.get('Items', []))
            pages_scanned += 1
            last_evaluated_key = response.get('LastEvaluatedKey')
        truncated = bool(last_evaluated_key)

    if truncated:
        logger.warning(
            "Citations read hit the %d-page cap (keyword=%s, items=%d). "
            "Results are truncated.",
            _MAX_SCAN_PAGES, keyword or '<scope>', len(items),
        )

    return items


def _aggregate_citations(items, tracked_brands):
    """
    Aggregate citations by normalized_url across all keywords.
    Each item in the Citations table has: keyword, normalized_url, citation_count,
    citing_providers, priority, first_seen, last_updated.
    """
    # Group by normalized_url across keywords
    url_data = defaultdict(lambda: {
        'total_count': 0,
        'keywords': set(),
        'providers': set(),
        'provider_counts': Counter(),
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


@api_handler
@validate(SCOPE_QUERY_PARAMS)
def handler(event, context, **scope_params):
    """
    GET /api/citations?keyword=xxx | ?group_id=xxx | ?keyword_ids=a,b

    Returns all distinct citation URLs from the deduplicated Citations table,
    sorted by total mentions across the scope's keywords (all keywords when no
    scope is given). No server-side limit so the frontend receives the full
    dataset for client-side sorting and Excel export.
    """
    report_scope, rejected = scope_from_request(event, scope_params, dynamodb.Table(KEYWORDS_TABLE))
    if rejected:
        return rejected

    tracked_brands = _get_tracked_brands()

    # Query the deduplicated Citations table
    if report_scope is None:
        items = _scan_all_citations()
    elif report_scope.is_single_keyword:
        items = _scan_all_citations(keyword=report_scope.keywords[0])
    else:
        items = _scan_all_citations(keywords=list(report_scope.keywords))
    logger.info(f"Fetched {len(items)} citation records from Citations table")

    # Aggregate by URL across all keywords
    url_data, provider_totals, brand_mentions = _aggregate_citations(items, tracked_brands)

    # Build sorted list of distinct URLs by total citation count
    top_urls = sorted(
        [
            {
                'url': url,
                'citation_count': data['total_count'],
                'by_provider': dict(data['provider_counts']),
                'keyword_count': len(data['keywords']),
                'keywords': sorted(list(data['keywords'])),
            }
            for url, data in url_data.items()
        ],
        key=lambda x: (-x['citation_count'], -x['keyword_count'], x['url'])
    )

    provider_stats = [
        {'provider': p, 'citation_count': c}
        for p, c in provider_totals.items()
    ]

    brand_stats = [
        {'brand': b, 'mention_count': c}
        for b, c in brand_mentions.items()
    ]

    return success_response({
        'scope': report_scope.describe() if report_scope is not None else None,
        'total_citations': len(items),
        'top_urls': top_urls,
        'provider_stats': provider_stats,
        'brand_stats': brand_stats,
    }, event)
