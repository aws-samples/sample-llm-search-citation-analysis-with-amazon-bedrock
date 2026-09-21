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
from shared.scope_params import (
    SCOPE_QUERY_PARAMS,
    ReportScope,
    all_active_scope,
    keywords_table_name,
    scope_from_request,
)
from shared.utils import extract_domain, get_brand_config

# Classification runs in at most six threads, then final response enrichment
# runs in a separate pool capped at ten. The phases never nest, so ten is both
# the DynamoDB HTTP connection ceiling and the endpoint's maximum I/O fan-out.
CRAWLED_CONTENT_MAX_WORKERS = 10
dynamodb = boto3.resource(
    'dynamodb',
    config=Config(max_pool_connections=CRAWLED_CONTENT_MAX_WORKERS),
)

KEYWORDS_TABLE = keywords_table_name()

# Upper bound on items fetched per keyword when isolating the latest
# analysis run. One run writes one SearchResults item per provider x
# persona (9 providers x a handful of personas today), so 50 comfortably
# covers a full run while keeping the read small.
LATEST_RUN_ITEM_LIMIT = 50

# Concurrency for SearchResults classification in the all-keywords path.
# Crawl enrichment starts only after this pool has closed.
_KEYWORD_ANALYSIS_WORKERS = 6

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = os.environ['DYNAMODB_TABLE_SEARCH_RESULTS']
CITATIONS_TABLE = os.environ['DYNAMODB_TABLE_CITATIONS']
CRAWLED_CONTENT_TABLE = os.environ['DYNAMODB_TABLE_CRAWLED_CONTENT']


def is_first_party_domain(domain: object, config: dict[str, Any]) -> bool:
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
    """
    if not domain or not isinstance(domain, str):
        return False

    domain_lower = domain.lower().lstrip('.')
    if domain_lower.startswith('www.'):
        domain_lower = domain_lower[4:]

    first_party_domains = config.get('first_party_domains', []) or []
    for first_party_domain in first_party_domains:
        if not first_party_domain or not isinstance(first_party_domain, str):
            continue
        normalized_first_party = first_party_domain.lower().lstrip('.')
        if normalized_first_party.startswith('www.'):
            normalized_first_party = normalized_first_party[4:]
        if not normalized_first_party:
            continue

        if domain_lower == normalized_first_party:
            return True
        if domain_lower.endswith('.' + normalized_first_party):
            return True

    return False


def _batch_crawled_info(urls: list[str]) -> dict[str, dict[str, Any]]:
    """Fetch only consumed fields from the latest crawl row of each URL.

    URL queries are deduplicated by ``query_latest_per_key`` and bounded to ten
    workers. Missing rows and per-URL failures produce no metadata entry, so a
    partial crawl-table failure never discards an otherwise valid gap.
    """
    if not urls:
        return {}

    table = dynamodb.Table(CRAWLED_CONTENT_TABLE)
    raw = query_latest_per_key(
        table=table,
        partition_key_name='normalized_url',
        partition_values=urls,
        max_workers=CRAWLED_CONTENT_MAX_WORKERS,
        projection_expression='#title, #seo, #authority, #crawled',
        expression_attribute_names={
            '#title': 'title',
            '#seo': 'seo_analysis',
            '#authority': 'domain_authority',
            '#crawled': 'crawled_at',
        },
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


def _enrich_sources(sources: list[dict[str, Any]]) -> None:
    """Attach crawl metadata after final response selection.

    Repeated URLs remain repeated response records, including their keyword
    attribution, but share one crawl lookup.
    """
    urls = list(dict.fromkeys(source['url'] for source in sources))
    crawled_info = _batch_crawled_info(urls)
    for source in sources:
        source.update(crawled_info.get(source['url'], {}))


def fuzzy_match_brand(brand_name: str, parent_company: str, tracked_list: list[str]) -> bool:
    """Fuzzy-match one extracted brand against tracked brand names."""
    brand_name_lower = brand_name.lower()
    parent_company_lower = (parent_company or '').lower()

    for tracked in tracked_list:
        tracked_lower = tracked.lower()
        tracked_words = set(tracked_lower.split())

        if tracked_lower in brand_name_lower or brand_name_lower in tracked_lower:
            return True

        if parent_company_lower and (tracked_lower in parent_company_lower or parent_company_lower in tracked_lower):
            return True

        significant_words = [word for word in tracked_words if len(word) > 3]
        for word in significant_words:
            if word in brand_name_lower:
                return True

        core_brand = tracked_words - {'hotels', 'hotel', 'international', 'group', 'inc', 'corp', 'company'}
        for core in core_brand:
            if len(core) > 3 and core in brand_name_lower:
                return True

    return False


def _classify_mentioned_brands(
    brands: list[dict[str, Any]], first_party_list: list[str], competitors_list: list[str]
) -> tuple[set[str], set[str]]:
    """Split one answer's brand mentions into first-party and competitor names."""
    mentioned_first_party: set[str] = set()
    mentioned_competitors: set[str] = set()

    for brand in brands:
        brand_name = brand.get('name', '')
        parent_company = brand.get('parent_company', '')
        classification = brand.get('classification', '')

        if classification == 'first_party':
            mentioned_first_party.add(brand_name)
        elif classification == 'competitor':
            mentioned_competitors.add(brand_name)
        elif fuzzy_match_brand(brand_name, parent_company, first_party_list):
            mentioned_first_party.add(brand_name)
        elif fuzzy_match_brand(brand_name, parent_company, competitors_list):
            mentioned_competitors.add(brand_name)

    return mentioned_first_party, mentioned_competitors


def _map_sources_to_brands(
    latest_items: list[dict[str, Any]], first_party_list: list[str], competitors_list: list[str]
) -> dict[str, dict[str, Any]]:
    """Index citations by URL with provider, count, and mentioned-brand data."""
    source_brand_map: dict[str, dict[str, Any]] = defaultdict(lambda: {
        'first_party': set(),
        'competitors': set(),
        'providers': set(),
        'citation_count': 0,
    })

    for item in latest_items:
        provider = item.get('provider', '')
        mentioned_first_party, mentioned_competitors = _classify_mentioned_brands(
            item.get('brands', []), first_party_list, competitors_list
        )

        for citation in item.get('citations', []):
            domain = extract_domain(citation)
            source_brand_map[citation]['providers'].add(provider)
            source_brand_map[citation]['citation_count'] += 1
            source_brand_map[citation]['domain'] = domain
            source_brand_map[citation]['first_party'].update(mentioned_first_party)
            source_brand_map[citation]['competitors'].update(mentioned_competitors)

    return source_brand_map


def _gaps_and_covered_sources(
    source_brand_map: dict[str, dict[str, Any]], config: dict[str, Any]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Classify and rank third-party sources without crawl enrichment."""
    third_party = {
        url: data for url, data in source_brand_map.items()
        if not is_first_party_domain(data['domain'], config)
    }

    gaps: list[dict[str, Any]] = []
    covered_sources: list[dict[str, Any]] = []

    for url, data in third_party.items():
        source_info = {
            'url': url,
            'domain': data['domain'],
            'citation_count': data['citation_count'],
            'providers': list(data['providers']),
            'provider_count': len(data['providers']),
            'first_party_brands': list(data['first_party']),
            'competitor_brands': list(data['competitors']),
        }

        if data['competitors'] and not data['first_party']:
            source_info['priority'] = 'high' if len(data['providers']) >= 2 else 'medium'
            gaps.append(source_info)
        elif data['first_party']:
            covered_sources.append(source_info)

    priority_order = {'high': 0, 'medium': 1, 'low': 2}
    gaps.sort(key=lambda source: (
        priority_order.get(source.get('priority', 'low'), 2),
        -source['citation_count'],
    ))
    covered_sources.sort(key=lambda source: -source['citation_count'])

    return gaps, covered_sources


def _first_party_brand_error(config: dict[str, Any]) -> dict[str, str] | None:
    """Return the public error contract when first-party brands are missing."""
    tracked_brands = config.get('tracked_brands', {})
    if tracked_brands.get('first_party', []):
        return None
    return {'error': 'No first-party brands configured'}


def _build_citation_gap_result(keyword: str, config: dict[str, Any]) -> dict[str, Any]:
    """Build one keyword response with final slices but without crawl metadata."""
    configuration_error = _first_party_brand_error(config)
    if configuration_error is not None:
        return configuration_error

    search_table = dynamodb.Table(SEARCH_RESULTS_TABLE)
    tracked_brands = config.get('tracked_brands', {})
    first_party_list = [brand.lower() for brand in tracked_brands.get('first_party', [])]
    competitors_list = [brand.lower() for brand in tracked_brands.get('competitors', [])]

    response = search_table.query(
        KeyConditionExpression=Key('keyword').eq(keyword),
        ScanIndexForward=False,
        Limit=LATEST_RUN_ITEM_LIMIT,
        ProjectionExpression='#ts, provider, citations, brands',
        ExpressionAttributeNames={'#ts': 'timestamp'},
    )
    items: list[dict[str, Any]] = response.get('Items', [])

    if not items:
        return {'error': f'No data found for keyword: {keyword}'}

    latest_timestamp = max(item.get('timestamp', '') for item in items)
    latest_items = [item for item in items if item.get('timestamp') == latest_timestamp]

    source_brand_map = _map_sources_to_brands(latest_items, first_party_list, competitors_list)
    gaps, covered_sources = _gaps_and_covered_sources(source_brand_map, config)

    domain_gaps: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for gap in gaps:
        domain_gaps[gap['domain']].append(gap)

    high_priority_gaps = [gap for gap in gaps if gap.get('priority') == 'high']

    return {
        'keyword': keyword,
        'timestamp': latest_timestamp,
        'gaps': gaps[:50],
        'covered_sources': covered_sources[:20],
        'domain_summary': [
            {
                'domain': domain,
                'gap_count': len(urls),
                'total_citations': sum(url['citation_count'] for url in urls),
            }
            for domain, urls in sorted(domain_gaps.items(), key=lambda item: -len(item[1]))[:20]
        ],
        'summary': {
            'gap_count': len(gaps),
            'covered_count': len(covered_sources),
            'high_priority_gaps': len(high_priority_gaps),
            'coverage_rate': round(len(covered_sources) / len(source_brand_map) * 100, 1) if source_brand_map else 0,
        },
    }


def analyze_citation_gaps(keyword: str, config: dict[str, Any]) -> dict[str, Any]:
    """Analyze one keyword and enrich only its returned response slices."""
    result = _build_citation_gap_result(keyword, config)
    if 'error' in result:
        return result

    _enrich_sources([*result['gaps'], *result['covered_sources']])
    return result


def analyze_all_keywords_gaps(config: dict[str, Any], limit: int = 10, scope: ReportScope | None = None) -> dict[str, Any]:
    """Analyze citation gaps across the active keywords of a scope."""
    configuration_error = _first_party_brand_error(config)
    if configuration_error is not None:
        return configuration_error

    keywords_table = dynamodb.Table(KEYWORDS_TABLE)
    resolved = scope if scope is not None else all_active_scope(keywords_table)
    keywords = sorted(resolved.keywords, key=str.casefold)
    if scope is not None and scope.kind != 'all':
        limit = max(limit, len(keywords))

    selected_keywords = keywords[:limit]
    all_gaps: list[dict[str, Any]] = []
    keyword_summaries: list[dict[str, Any]] = []

    if not selected_keywords:
        results: list[dict[str, Any]] = []
    else:
        workers = min(_KEYWORD_ANALYSIS_WORKERS, len(selected_keywords))
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
            results = list(pool.map(
                lambda keyword: _build_citation_gap_result(keyword, config),
                selected_keywords,
            ))

    for keyword, result in zip(selected_keywords, results, strict=True):
        if 'error' not in result:
            keyword_summaries.append({
                'keyword': keyword,
                'gap_count': result['summary']['gap_count'],
                'high_priority_gaps': result['summary']['high_priority_gaps'],
                'coverage_rate': result['summary']['coverage_rate'],
            })
            for gap in result['gaps'][:5]:
                gap['keyword'] = keyword
                all_gaps.append(gap)

    priority_order = {'high': 0, 'medium': 1, 'low': 2}
    all_gaps.sort(key=lambda gap: (
        priority_order.get(gap.get('priority', 'low'), 2),
        -gap['citation_count'],
    ))
    top_gaps = all_gaps[:30]
    _enrich_sources(top_gaps)

    return {
        'scope': resolved.describe(),
        'keywords_analyzed': len(keyword_summaries),
        'keyword_summaries': sorted(keyword_summaries, key=lambda summary: -summary['high_priority_gaps']),
        'top_gaps': top_gaps,
        'total_gaps': sum(summary['gap_count'] for summary in keyword_summaries),
        'total_high_priority': sum(summary['high_priority_gaps'] for summary in keyword_summaries),
    }


def gaps_for_scope(scope: ReportScope | None, config: dict[str, Any], limit: int) -> dict[str, Any]:
    """Return one-keyword analysis or a rollup for the requested scope."""
    if scope is not None and scope.is_single_keyword:
        return analyze_citation_gaps(scope.keywords[0], config)
    return analyze_all_keywords_gaps(config, limit, scope=scope)


@api_handler
@validate({
    **SCOPE_QUERY_PARAMS,
    'limit': {'type': int, 'min': 1, 'max': 100, 'default': 10},
})
def handler(event: dict[str, Any], context: Any, limit: int = 10, **scope_params: str | None) -> dict[str, Any]:
    """Return citation gaps for one keyword, a group, explicit ids, or all active keywords."""
    report_scope, rejected = scope_from_request(event, scope_params, dynamodb.Table(KEYWORDS_TABLE))
    if rejected:
        return rejected

    return success_response(gaps_for_scope(report_scope, get_brand_config(), limit), event)
