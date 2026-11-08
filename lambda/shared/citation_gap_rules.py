"""
Citation gaps of one keyword's latest run, and their rollup over a scope (``GET /api/citation-gaps``).

A *gap* is a third-party URL the run's answers cite next to a competitor but
never next to a first-party brand; a *covered* source cites a first-party
brand. The rules were in ``api/get-citation-gaps.py``; they live here so the
handler's live path, the ``actions`` partial (``shared.partial_actions``) and
the ``gaps`` artifact (``shared.artifact_gaps``) apply the same ones.

Orders are total: a gap ranks by priority, then citations, then URL; list
fields built from sets are sorted. So a keyword's result does not depend on
the order its rows were read in, and a scope's rollup does not depend on the
order its keywords were merged in.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from shared.brand_visibility import tracked_brand_names
from shared.constants import priority_rank
from shared.kpi_engine import is_owned_domain, normalize_domain, percent
from shared.scope_order import keyword_order
from shared.utils import extract_domain
from shared.youtube import content_type_for

#: The first gaps, covered sources and domains one keyword's answer lists (``<list>_total`` counts them all;
#: ``view=gaps|covered|domains`` pages the rest, 2.45.0 wave 5).
KEYWORD_GAPS_LIMIT = 50
KEYWORD_COVERED_LIMIT = 20
KEYWORD_DOMAINS_LIMIT = 20
#: The first gaps of a scope's whole ranked gap list its answer lists (``top_gaps``, enriched with crawl data by the handler).
SCOPE_TOP_GAPS = 30

NO_FIRST_PARTY_ERROR = 'No first-party brands configured'

def is_first_party_domain(domain: object, config: Mapping[str, Any]) -> bool:
    """Whether ``domain`` belongs to a first-party brand.

    Uses ONLY the explicit ``first_party_domains`` allow-list from brand config,
    matched the KPI engine's way (``kpi_engine.is_owned_domain`` on
    ``normalize_domain`` hosts): the registered domain or a subdomain of it.
    A substring match against brand names ("Inn" matching "linkedin.com")
    is deliberately not done.
    """
    normalized = normalize_domain(domain)
    return normalized is not None and is_owned_domain(normalized, config.get('first_party_domains') or [])


def _word_match(tracked_lower: str, brand_name_lower: str) -> bool:
    # A significant (4+ letter) word of the tracked name inside the extracted name.
    return any(len(word) > 3 and word in brand_name_lower for word in tracked_lower.split())


def fuzzy_match_brand(brand_name: str, parent_company: str, tracked_list: Sequence[str]) -> bool:
    """Fuzzy-match one extracted brand (or its parent company) against tracked brand names."""
    brand_name_lower = brand_name.lower()
    parent_company_lower = (parent_company or '').lower()
    for tracked in tracked_list:
        tracked_lower = tracked.lower()
        if tracked_lower in brand_name_lower or brand_name_lower in tracked_lower:
            return True
        if parent_company_lower and (tracked_lower in parent_company_lower or parent_company_lower in tracked_lower):
            return True
        if _word_match(tracked_lower, brand_name_lower):
            return True
    return False


def _classify_mentioned_brands(
    brands: Iterable[Mapping[str, Any]], first_party_list: Sequence[str], competitors_list: Sequence[str],
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


def _new_source() -> dict[str, Any]:
    return {'first_party': set(), 'competitors': set(), 'providers': set(), 'citation_count': 0}


def _map_sources_to_brands(
    rows: Iterable[Mapping[str, Any]], first_party_list: Sequence[str], competitors_list: Sequence[str],
) -> dict[str, dict[str, Any]]:
    """Index citations by URL with provider, count, and mentioned-brand data."""
    source_brand_map: dict[str, dict[str, Any]] = defaultdict(_new_source)
    for item in rows:
        provider = item.get('provider', '')
        mentioned_first_party, mentioned_competitors = _classify_mentioned_brands(
            item.get('brands') or [], first_party_list, competitors_list,
        )
        for citation in item.get('citations') or []:
            source = source_brand_map[citation]
            source['providers'].add(provider)
            source['citation_count'] += 1
            source['domain'] = extract_domain(citation)
            source['first_party'].update(mentioned_first_party)
            source['competitors'].update(mentioned_competitors)
    return source_brand_map


def gap_order(source: Mapping[str, Any]) -> tuple[int, int, str]:
    """A gap's rank: priority, then citations (most first), then URL."""
    return priority_rank(source.get('priority')), -int(source['citation_count']), str(source['url'])


def _covered_order(source: Mapping[str, Any]) -> tuple[int, str]:
    return -int(source['citation_count']), str(source['url'])


def _source_info(url: str, data: Mapping[str, Any]) -> dict[str, Any]:
    return {
        'url': url,
        'domain': data['domain'],
        'content_type': content_type_for(url),
        'citation_count': data['citation_count'],
        'providers': sorted(data['providers']),
        'provider_count': len(data['providers']),
        'first_party_brands': sorted(data['first_party']),
        'competitor_brands': sorted(data['competitors']),
    }


def _gaps_and_covered_sources(
    source_brand_map: Mapping[str, Mapping[str, Any]], config: Mapping[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Classify and rank third-party sources without crawl enrichment."""
    gaps: list[dict[str, Any]] = []
    covered_sources: list[dict[str, Any]] = []
    for url, data in source_brand_map.items():
        if is_first_party_domain(data['domain'], config):
            continue
        source_info = _source_info(url, data)
        if data['competitors'] and not data['first_party']:
            source_info['priority'] = 'high' if len(data['providers']) >= 2 else 'medium'
            gaps.append(source_info)
        elif data['first_party']:
            covered_sources.append(source_info)
    gaps.sort(key=gap_order)
    covered_sources.sort(key=_covered_order)
    return gaps, covered_sources


def classify_latest_run(
    rows: Iterable[Mapping[str, Any]], config: Mapping[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], int]:
    """One keyword's latest-run rows (``provider``, ``citations``, ``brands``) as ``(gaps, covered_sources, cited_urls)``.

    Both lists ranked and not enriched; ``cited_urls`` counts every distinct
    URL the rows cite. ``shared.competitor_evidence`` classifies with it too.
    """
    first_party_list, competitors_list = tracked_brand_names(dict(config))
    source_brand_map = _map_sources_to_brands(rows, first_party_list, competitors_list)
    gaps, covered_sources = _gaps_and_covered_sources(source_brand_map, config)
    return gaps, covered_sources, len(source_brand_map)


def first_party_brand_error(config: Mapping[str, Any]) -> dict[str, str] | None:
    """The public error contract when no first-party brand is configured, else ``None``."""
    tracked_brands = config.get('tracked_brands') or {}
    if tracked_brands.get('first_party') or []:
        return None
    return {'error': NO_FIRST_PARTY_ERROR}


def _domain_summary(gaps: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Every domain of ``gaps``, most gaps first."""
    domain_gaps: dict[str, list[Mapping[str, Any]]] = defaultdict(list)
    for gap in gaps:
        domain_gaps[gap['domain']].append(gap)
    ranked = sorted(domain_gaps.items(), key=lambda item: -len(item[1]))
    return [
        {'domain': domain, 'gap_count': len(urls), 'total_citations': sum(url['citation_count'] for url in urls)}
        for domain, urls in ranked
    ]


def _gap_rates(gaps: Sequence[Mapping[str, Any]], covered_sources: Sequence[Mapping[str, Any]], cited_urls: int) -> dict[str, Any]:
    """How many gaps are high priority, and the share of cited URLs that name a first-party brand."""
    return {
        'high_priority_gaps': sum(gap.get('priority') == 'high' for gap in gaps),
        'coverage_rate': percent(len(covered_sources), cited_urls) if cited_urls else 0,
    }


def keyword_gap_result(keyword: str, timestamp: str, rows: Sequence[Mapping[str, Any]], config: Mapping[str, Any]) -> dict[str, Any]:
    """The one-keyword answer of ``/citation-gaps`` from its latest run's rows, every list whole, without crawl metadata.

    The handler pages ``gaps``, ``covered_sources`` and ``domain_summary``
    (``KEYWORD_LISTS``).
    """
    configuration_error = first_party_brand_error(config)
    if configuration_error is not None:
        return configuration_error
    if not rows:
        return {'error': f'No data found for keyword: {keyword}'}
    gaps, covered_sources, cited_urls = classify_latest_run(rows, config)
    return {
        'keyword': keyword,
        'timestamp': timestamp,
        'gaps': gaps,
        'covered_sources': covered_sources,
        'domain_summary': _domain_summary(gaps),
        'summary': {'gap_count': len(gaps), 'covered_count': len(covered_sources), **_gap_rates(gaps, covered_sources, cited_urls)},
    }


def keyword_gap_entry(keyword: str, rows: Sequence[Mapping[str, Any]], config: Mapping[str, Any]) -> dict[str, Any] | None:
    """What one keyword adds to a scope's gap rollup: its summary row and every gap (``complete``; ``None`` without rows).

    An entry without ``complete`` was written before 2.45.0 wave 5 and holds
    the keyword's five best gaps only.
    """
    if not rows or first_party_brand_error(config) is not None:
        return None
    gaps, covered_sources, cited_urls = classify_latest_run(rows, config)
    return {
        'summary': {'keyword': keyword, 'gap_count': len(gaps), **_gap_rates(gaps, covered_sources, cited_urls)},
        'top_gaps': [{**gap, 'keyword': keyword} for gap in gaps],
        'complete': True,
    }


def summary_order(summary: Mapping[str, Any]) -> tuple[int, str, str]:
    """A keyword summary's rank in a scope: most high-priority gaps first, then the scope's keyword order."""
    return -int(summary['high_priority_gaps']), *keyword_order(str(summary['keyword']))


def _scope_gap_order(gap: Mapping[str, Any]) -> tuple[int, int, str, str, str]:
    # Equal priority and citations keep the scope's keyword order, then the keyword's own (URL) order.
    return priority_rank(gap.get('priority')), -int(gap['citation_count']), *keyword_order(str(gap['keyword'])), str(gap['url'])


def scope_gap_rollup(entries: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    """A scope's rollup from its keywords' ``keyword_gap_entry`` values (any order): every summary, every gap ranked, the totals.

    ``gaps`` holds every gap of every keyword (``top_gaps`` its first
    ``SCOPE_TOP_GAPS``); ``gaps_truncated`` says an entry written before
    2.45.0 wave 5 contributed its best five gaps only (a KeywordLatest
    rebuild completes it).
    """
    summaries: list[Mapping[str, Any]] = []
    candidates: list[Mapping[str, Any]] = []
    truncated = False
    for entry in entries:
        summaries.append(entry['summary'])
        candidates.extend(entry['top_gaps'])
        truncated = truncated or not entry.get('complete')
    summaries.sort(key=summary_order)
    candidates.sort(key=_scope_gap_order)
    return {
        'keywords_analyzed': len(summaries),
        'keyword_summaries': [dict(summary) for summary in summaries],
        'top_gaps': [dict(gap) for gap in candidates[:SCOPE_TOP_GAPS]],
        'gaps': [dict(gap) for gap in candidates],
        'gaps_truncated': truncated,
        'total_gaps': sum(int(summary['gap_count']) for summary in summaries),
        'total_high_priority': sum(int(summary['high_priority_gaps']) for summary in summaries),
    }


__all__ = [
    'KEYWORD_COVERED_LIMIT',
    'KEYWORD_DOMAINS_LIMIT',
    'KEYWORD_GAPS_LIMIT',
    'NO_FIRST_PARTY_ERROR',
    'SCOPE_TOP_GAPS',
    'classify_latest_run',
    'first_party_brand_error',
    'fuzzy_match_brand',
    'gap_order',
    'is_first_party_domain',
    'keyword_gap_entry',
    'keyword_gap_result',
    'scope_gap_rollup',
    'summary_order',
]
