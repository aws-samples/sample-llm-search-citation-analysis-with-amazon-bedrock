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

import concurrent.futures
import logging
import os
import sys
from collections import defaultdict
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key
from botocore.config import Config

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import success_response
from shared.decorators import api_handler, validate
from shared.dynamodb_batch import query_latest_per_key
from shared.utils import extract_domain, get_brand_config

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Raised connection pool: the all-keywords path fans out
# _KEYWORD_ANALYSIS_WORKERS keyword threads, each running up to 10
# parallel CrawledContent queries (query_latest_per_key). botocore's
# default pool of 10 would serialize that fan-out at the HTTP layer.
dynamodb = boto3.resource('dynamodb', config=Config(max_pool_connections=50))

# Upper bound on items fetched per keyword when isolating the latest
# analysis run. One run writes one SearchResults item per provider x
# persona (9 providers x a handful of personas today), so 50 comfortably
# covers a full run while keeping the read small.
LATEST_RUN_ITEM_LIMIT = 50

# Concurrency for the all-keywords analysis loop. Keyword analyses are
# I/O bound (DynamoDB queries), so a small pool cuts wall-clock roughly
# linearly; kept modest to stay within the connection pool above.
_KEYWORD_ANALYSIS_WORKERS = 6

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


def fuzzy_match_brand(brand_name: str, parent_company: str, tracked_list: list[str]) -> bool:
    """
    Fuzzy match a brand against a list of tracked brands.
    Uses intelligent matching to handle variations like "Brand Premium" matching "Brand".
    """
    brand_name_lower = brand_name.lower()
    parent_company_lower = (parent_company or "").lower()

    for tracked in tracked_list:
        tracked_lower = tracked.lower()
        # Extract key words from tracked brand
        tracked_words = set(tracked_lower.split())

        # Direct substring match
        if tracked_lower in brand_name_lower or brand_name_lower in tracked_lower:
            return True

        # Parent company match
        if parent_company_lower and (tracked_lower in parent_company_lower or parent_company_lower in tracked_lower):
            return True

        # Word overlap match (e.g., "Brand" matches "Brand Garden Inn")
        significant_words = [w for w in tracked_words if len(w) > 3]
        for word in significant_words:
            if word in brand_name_lower:
                return True

        # Check if brand contains the core brand name
        core_brand = tracked_words - {'hotels', 'hotel', 'international', 'group', 'inc', 'corp', 'company'}
        for core in core_brand:
            if len(core) > 3 and core in brand_name_lower:
                return True

    return False


def analyze_citation_gaps(keyword: str, config: dict[str, Any]) -> dict[str, Any]:
    """
    Analyze citation gaps for a keyword.

    Identifies sources that cite competitors but not first-party brands.
    Uses the 'classification' field from brand extraction (LLM-based) as primary,
    with fuzzy matching as fallback.
    """
    search_table = dynamodb.Table(SEARCH_RESULTS_TABLE)

    # Get tracked brands for fallback matching
    tracked_brands = config.get("tracked_brands", {})
    first_party_list = [b.lower() for b in tracked_brands.get("first_party", [])]
    competitors_list = [b.lower() for b in tracked_brands.get("competitors", [])]

    if not first_party_list:
        return {"error": "No first-party brands configured"}

    # Query search results for keyword — newest first, bounded, and
    # projected down to the fields the analysis reads. The partition
    # accumulates one item per provider x persona per run, each carrying
    # the FULL LLM response text; the previous unbounded ascending query
    # re-read that entire history per request (~1MB/keyword), which
    # dominated this endpoint's ~60s latency. Worse, once a partition
    # exceeded DynamoDB's 1MB page, "latest" was computed from the
    # OLDEST page, silently returning stale runs. Descending + Limit
    # fixes both; the projection drops the response text we never read.
    response = search_table.query(
        KeyConditionExpression=Key('keyword').eq(keyword),
        ScanIndexForward=False,
        Limit=LATEST_RUN_ITEM_LIMIT,
        ProjectionExpression='#ts, provider, citations, brands',
        ExpressionAttributeNames={'#ts': 'timestamp'},
    )
    items = response.get('Items', [])

    if not items:
        return {"error": f"No data found for keyword: {keyword}"}

    # Get latest results (items are newest-first, so the max timestamp
    # is in this window by construction)
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

        # Get brand names mentioned in this response
        # Use the 'classification' field from LLM extraction as primary source
        mentioned_first_party = set()
        mentioned_competitors = set()

        for brand in brands:
            brand_name = brand.get('name', '')
            parent_company = brand.get('parent_company', '')
            classification = brand.get('classification', '')

            # Primary: use LLM classification
            if classification == 'first_party':
                mentioned_first_party.add(brand_name)
            elif classification == 'competitor':
                mentioned_competitors.add(brand_name)
            else:
                # Fallback: use fuzzy matching against tracked brands
                if fuzzy_match_brand(brand_name, parent_company, first_party_list):
                    mentioned_first_party.add(brand_name)
                elif fuzzy_match_brand(brand_name, parent_company, competitors_list):
                    mentioned_competitors.add(brand_name)

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
        keywords = sorted(set(item.get('keyword', '') for item in response.get('Items', []) if item.get('keyword')))
    else:
        # Fallback to scanning SearchResults if Keywords table not configured
        search_table = dynamodb.Table(SEARCH_RESULTS_TABLE)
        response = search_table.scan(
            ProjectionExpression='keyword',
            Limit=500
        )
        keywords = sorted(set(item.get('keyword', '') for item in response.get('Items', []) if item.get('keyword')))

    # Analyze keywords in parallel — each analysis is I/O bound (one
    # SearchResults query + a CrawledContent fan-out), so the previous
    # strictly sequential loop multiplied per-keyword latency by `limit`.
    # sorted() above makes WHICH keywords get analyzed deterministic when
    # more exist than `limit` (set order used to vary per invocation).
    # pool.map preserves input order, so response ordering is unchanged.
    selected_keywords = keywords[:limit]
    all_gaps = []
    keyword_summaries = []

    if not selected_keywords:
        results: list[dict[str, Any]] = []
    else:
        workers = min(_KEYWORD_ANALYSIS_WORKERS, len(selected_keywords))
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            results = list(pool.map(
                lambda kw: analyze_citation_gaps(kw, config),
                selected_keywords,
            ))

    for keyword, result in zip(selected_keywords, results, strict=True):
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
