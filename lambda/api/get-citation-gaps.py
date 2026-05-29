"""
Citation Gap Analysis API

Identifies citation sources where competitors are mentioned but your brand isn't.
Helps discover opportunities to get mentioned on high-value sources.

Features:
- Gap identification: Sources citing competitors but not you
- Source ranking by citation frequency
- Domain authority indicators
- Actionable recommendations
"""

import logging
import os
import sys
from collections import defaultdict
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import success_response
from shared.decorators import api_handler, validate
from shared.dynamodb_batch import query_latest_per_key
from shared.utils import classify_brand, extract_domain, get_brand_config

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = os.environ['DYNAMODB_TABLE_SEARCH_RESULTS']
CITATIONS_TABLE = os.environ['DYNAMODB_TABLE_CITATIONS']
CRAWLED_CONTENT_TABLE = os.environ['DYNAMODB_TABLE_CRAWLED_CONTENT']
KEYWORDS_TABLE = os.environ.get('DYNAMODB_TABLE_KEYWORDS')  # Optional for fallback


def is_first_party_domain(domain: str, config: dict[str, Any]) -> bool:
    """
    Check whether `domain` belongs to a first-party brand.

    Uses ONLY the explicit `first_party_domains` allow-list from brand config.
    Match rules, in order of specificity:

    1. Exact match on the registered hostname (`example.com` == `example.com`)
    2. Subdomain match (`blog.example.com` ends with `.example.com`)

    The previous implementation also fell back to substring matching against
    tracked brand names ("Inn" matching both "Holiday Inn" and "linkedin.com"),
    which produced false positives that silently flipped competitor URLs into
    the first-party bucket. That fallback is removed — if a deployment wants
    a domain treated as first-party, it must be in the config.

    Args:
        domain: Hostname to test (may be lowercase or mixed case; leading
            `www.` is tolerated).
        config: Brand config dict. Only `first_party_domains` is read.

    Returns:
        True if the domain matches the allow-list exactly or as a subdomain.
    """
    if not domain or not isinstance(domain, str):
        return False

    # Normalize both sides: lowercase and strip leading www.
    domain_lower = domain.lower().lstrip('.')
    if domain_lower.startswith('www.'):
        domain_lower = domain_lower[4:]

    first_party_domains = config.get('first_party_domains', []) or []
    for fp in first_party_domains:
        if not fp or not isinstance(fp, str):
            continue
        fp_norm = fp.lower().lstrip('.')
        if fp_norm.startswith('www.'):
            fp_norm = fp_norm[4:]
        if not fp_norm:
            continue

        # Exact host match.
        if domain_lower == fp_norm:
            return True
        # Subdomain match — require the '.' boundary so 'evilexample.com'
        # does NOT match 'example.com'.
        if domain_lower.endswith('.' + fp_norm):
            return True

    return False


def _batch_crawled_info(urls: list[str]) -> dict[str, dict[str, Any]]:
    """Fetch the latest CrawledContent row for each URL in parallel.

    Returns a dict mapping each input URL to its shaped crawled-info
    payload (only the fields consumed by `analyze_citation_gaps`).
    Missing URLs get no entry so callers can safely `map.get(url, {})`.

    Replaces the per-URL `get_crawled_content_info` call that used to
    live inside `analyze_citation_gaps`'s loop (audit item 16).
    Per-URL query failures are logged inside `query_latest_per_key`
    and surface here as missing keys in the returned dict.
    """
    if not urls:
        return {}

    table = dynamodb.Table(CRAWLED_CONTENT_TABLE)
    raw = query_latest_per_key(
        table=table,
        partition_key_name='normalized_url',
        partition_values=urls,
    )

    shaped: dict[str, dict[str, Any]] = {}
    for url, item in raw.items():
        if not item:
            continue
        shaped[url] = {
            'title': item.get('title', ''),
            'seo_analysis': item.get('seo_analysis', {}),
            'domain_authority': item.get('domain_authority'),
            'last_crawled': item.get('crawled_at'),
        }
    return shaped


def classify_response_brands(
    brands: list[dict[str, Any]],
    first_party_list: list[str],
    competitors_list: list[str],
) -> tuple[set[str], set[str]]:
    """Split a response's brands into first-party and competitor name sets.

    Reconciles citation-gap classification with get-visibility-metrics so the
    two features agree on first-party presence. Per-brand classification is
    delegated to ``shared.utils.classify_brand``: the LLM-assigned
    ``classification`` field (``first_party`` | ``competitor`` | ``other``) is
    authoritative, and its exact-name fallback fires ONLY for legacy records
    that predate the field (``classification is None``), never via substring or
    word overlap. This is what keeps an LLM-classified ``other`` brand that
    merely shares a word with a tracked brand (e.g. "Istanbul Grand Hotel" vs a
    first-party "Marmara Istanbul") from being flipped into first-party, which
    was the root cause of the gap analyzer reporting full coverage while the
    visibility metric reported the brand absent.

    Args:
        brands: The ``brands`` list from a search-result item.
        first_party_list: Configured first-party brand names (any case).
        competitors_list: Configured competitor brand names (any case).

    Returns:
        ``(mentioned_first_party, mentioned_competitors)`` as sets of brand
        names. Brands with an empty name are ignored.
    """
    mentioned_first_party: set[str] = set()
    mentioned_competitors: set[str] = set()

    for brand in brands:
        name = brand.get('name', '')
        if not name:
            continue

        is_first_party, is_competitor = classify_brand(brand, first_party_list, competitors_list)

        if is_first_party:
            mentioned_first_party.add(name)
        elif is_competitor:
            mentioned_competitors.add(name)

    return mentioned_first_party, mentioned_competitors


def analyze_citation_gaps(keyword: str, config: dict[str, Any]) -> dict[str, Any]:
    """
    Analyze citation gaps for a keyword.

    Identifies sources that cite competitors but not first-party brands.
    Brand classification uses the LLM-assigned 'classification' field as the
    source of truth (via classify_response_brands), with an exact brand-name
    fallback only for legacy records missing that field.
    """
    search_table = dynamodb.Table(SEARCH_RESULTS_TABLE)

    # Get tracked brands for fallback matching
    tracked_brands = config.get("tracked_brands", {})
    first_party_list = [b.lower() for b in tracked_brands.get("first_party", [])]
    competitors_list = [b.lower() for b in tracked_brands.get("competitors", [])]

    if not first_party_list:
        return {"error": "No first-party brands configured"}

    # Query search results for keyword
    response = search_table.query(
        KeyConditionExpression=Key('keyword').eq(keyword)
    )
    items = response.get('Items', [])

    if not items:
        return {"error": f"No data found for keyword: {keyword}"}

    # Get latest results
    latest_ts = max(item.get('timestamp', '') for item in items)
    latest_items = [item for item in items if item.get('timestamp') == latest_ts]

    # Track which sources mention which brands
    source_brand_map = defaultdict(lambda: {
        'first_party': set(),
        'competitors': set(),
        'providers': set(),
        'citation_count': 0
    })

    for item in latest_items:
        provider = item.get('provider', '')
        citations = item.get('citations', [])
        brands = item.get('brands', [])

        # Classify the brands mentioned in this response. Mirrors
        # get-visibility-metrics: the LLM 'classification' field is
        # authoritative, with an exact-name fallback only for legacy records
        # that predate the field. first_party_list/competitors_list are
        # already lowercased above; brand_names_match normalizes case itself.
        mentioned_first_party, mentioned_competitors = classify_response_brands(
            brands, first_party_list, competitors_list
        )

        # Map citations to brands
        for citation in citations:
            domain = extract_domain(citation)
            source_brand_map[citation]['providers'].add(provider)
            source_brand_map[citation]['citation_count'] += 1
            source_brand_map[citation]['domain'] = domain
            source_brand_map[citation]['first_party'].update(mentioned_first_party)
            source_brand_map[citation]['competitors'].update(mentioned_competitors)

    # Identify gaps: sources with competitors but no first-party
    gaps = []
    covered_sources = []

    # Batch-fetch crawled content for all relevant URLs up front. The
    # previous per-URL query inside the loop was O(N) round-trips to
    # DynamoDB (audit item 16); this collapses it to ~1 RTT worth of
    # parallel work.
    relevant_urls = [
        url for url, data in source_brand_map.items()
        if not is_first_party_domain(data['domain'], config)
    ]
    crawled_info_map = _batch_crawled_info(relevant_urls)

    for url, data in source_brand_map.items():
        domain = data['domain']

        # Skip first-party domains - these are never gaps
        # Your own website URLs should not appear as citation gaps
        if is_first_party_domain(domain, config):
            continue

        source_info = {
            'url': url,
            'domain': domain,
            'citation_count': data['citation_count'],
            'providers': list(data['providers']),
            'provider_count': len(data['providers']),
            'first_party_brands': list(data['first_party']),
            'competitor_brands': list(data['competitors'])
        }

        # Pull crawled info from the prefetched batch.
        crawled_info = crawled_info_map.get(url, {})
        if crawled_info:
            source_info.update(crawled_info)

        if data['competitors'] and not data['first_party']:
            # Gap: competitors mentioned but not first-party
            # These are high-value opportunities - sources citing competitors but not you
            source_info['gap_type'] = 'competitor_only'
            source_info['priority'] = 'high' if len(data['providers']) >= 2 else 'medium'
            gaps.append(source_info)
        elif data['first_party']:
            # Covered: first-party is mentioned on this third-party source
            covered_sources.append(source_info)
        # Note: We no longer add "neutral" sources (neither first-party nor competitors)
        # as gaps - they're not actionable opportunities

    # Sort gaps by priority and citation count
    priority_order = {'high': 0, 'medium': 1, 'low': 2}
    gaps.sort(key=lambda x: (priority_order.get(x.get('priority', 'low'), 2), -x['citation_count']))
    covered_sources.sort(key=lambda x: -x['citation_count'])

    # Group gaps by domain
    domain_gaps = defaultdict(list)
    for gap in gaps:
        domain_gaps[gap['domain']].append(gap)

    # Calculate summary stats
    high_priority_gaps = [g for g in gaps if g.get('priority') == 'high']

    return {
        'keyword': keyword,
        'timestamp': latest_ts,
        'gaps': gaps[:50],  # Top 50 gaps
        'covered_sources': covered_sources[:20],  # Top 20 covered
        'domain_summary': [
            {
                'domain': domain,
                'gap_count': len(urls),
                'total_citations': sum(u['citation_count'] for u in urls)
            }
            for domain, urls in sorted(domain_gaps.items(), key=lambda x: -len(x[1]))[:20]
        ],
        'summary': {
            'total_sources': len(source_brand_map),
            'gap_count': len(gaps),
            'covered_count': len(covered_sources),
            'high_priority_gaps': len(high_priority_gaps),
            'coverage_rate': round(len(covered_sources) / len(source_brand_map) * 100, 1) if source_brand_map else 0
        }
    }


def analyze_all_keywords_gaps(config: dict[str, Any], limit: int = 10) -> dict[str, Any]:
    """Analyze citation gaps across all keywords."""
    # Get keywords from the Keywords table instead of scanning SearchResults
    # This is more efficient as Keywords table is small and purpose-built
    keywords_table_name = os.environ.get('DYNAMODB_TABLE_KEYWORDS')
    if keywords_table_name:
        keywords_table = dynamodb.Table(keywords_table_name)
        response = keywords_table.scan(
            ProjectionExpression='keyword',
            Limit=500
        )
        keywords = list(set(item.get('keyword', '') for item in response.get('Items', []) if item.get('keyword')))
    else:
        # Fallback to scanning SearchResults if Keywords table not configured
        search_table = dynamodb.Table(SEARCH_RESULTS_TABLE)
        response = search_table.scan(
            ProjectionExpression='keyword',
            Limit=500
        )
        keywords = list(set(item.get('keyword', '') for item in response.get('Items', []) if item.get('keyword')))

    # Analyze each keyword
    all_gaps = []
    keyword_summaries = []

    for keyword in keywords[:limit]:
        result = analyze_citation_gaps(keyword, config)
        if 'error' not in result:
            keyword_summaries.append({
                'keyword': keyword,
                'gap_count': result['summary']['gap_count'],
                'high_priority_gaps': result['summary']['high_priority_gaps'],
                'coverage_rate': result['summary']['coverage_rate']
            })
            # Add top gaps from this keyword
            for gap in result['gaps'][:5]:
                gap['keyword'] = keyword
                all_gaps.append(gap)

    # Sort all gaps by priority
    priority_order = {'high': 0, 'medium': 1, 'low': 2}
    all_gaps.sort(key=lambda x: (priority_order.get(x.get('priority', 'low'), 2), -x['citation_count']))

    return {
        'keywords_analyzed': len(keyword_summaries),
        'keyword_summaries': sorted(keyword_summaries, key=lambda x: -x['high_priority_gaps']),
        'top_gaps': all_gaps[:30],
        'total_gaps': sum(k['gap_count'] for k in keyword_summaries),
        'total_high_priority': sum(k['high_priority_gaps'] for k in keyword_summaries)
    }


@api_handler
@validate({
    'keyword': {'type': str, 'max_length': 500},
    'limit': {'type': int, 'min': 1, 'max': 100, 'default': 10}
})
def handler(event: dict[str, Any], context: Any, keyword: str | None = None, limit: int = 10) -> dict[str, Any]:
    """
    API handler for citation gap analysis.

    Query params:
        - keyword: Specific keyword to analyze (optional)
        - limit: Number of keywords to analyze if no keyword specified (default: 10)
    """
    config = get_brand_config()

    if keyword:
        # Analyze specific keyword
        result = analyze_citation_gaps(keyword, config)
    else:
        # Analyze across all keywords
        result = analyze_all_keywords_gaps(config, limit)

    return success_response(result, event)
