"""
Reports Competitor Rollup API

Per-competitor rollup that powers the Competitor Gap print report and
ad-hoc "where is X eating our lunch" lookups. Combines:

- Outranked keywords: keywords where the competitor's best rank beats
  every first-party brand's best rank.
- Exclusive citation sources: URLs that cite this competitor but no
  first-party brand (a subset of citation gaps, filtered by competitor),
  counted in full (``exclusive_source_count``, ``high_priority_source_count``).
- Outreach targets: the ``OUTREACH_TARGETS_LIMIT`` exclusive sources with the
  best outreach lift score, so a PR strategist can plan a sprint.

Why this exists rather than client-side composition

The competitor view requires a join across keyword * provider * brand
that the existing /visibility and /citation-gaps endpoints don't surface
directly. Doing it server-side reads each keyword once per request, however
many competitors are rolled up.

Reads and size, by design

Each analysed keyword costs one projected SearchResults query of its latest
run (``shared.search_results.query_latest_run``: no answer text), ``SCOPE_MAX_WORKERS`` at
a time; no crawl lookups. The rows give both the brand ranks and the gaps,
and every competitor's rollup is built from the same rows. A rollup holds at
most ``keyword_limit`` outranked keywords and ``OUTREACH_TARGETS_LIMIT``
targets, and at most ``MAX_ROLLUP_COMPETITORS`` rollups are built.

Routes

  GET /api/reports/competitor?competitor=<name>
    Returns a single competitor's rollup.

  GET /api/reports/competitor
    Returns the configured competitors and the rollups of the first
    ``MAX_ROLLUP_COMPETITORS`` of them (``competitors_truncated`` when more
    are configured).

Query params

  competitor (str, optional)  — when omitted, the configured competitors.
  keyword_limit (int, 1-100, default 50) — the active keywords analysed, in
                                            keyword order
                                            (``keywords_truncated`` when
                                            more exist).
"""

from __future__ import annotations

import logging
import math
import sys
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

# Shared layer path
sys.path.insert(0, '/opt/python')

from shared.api_response import success_response, validation_error
from shared.constants import priority_rank
from shared.decorators import api_handler, validate
from shared.scope_params import (
    all_active_scope,
    keywords_table_name,
    load_sibling_function,
    map_scope_keywords,
    scoped_dynamodb_resource,
)
from shared.search_results import query_latest_run, search_results_table_name
from shared.utils import get_brand_config, get_timestamp

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# One latest-run read per keyword, SCOPE_MAX_WORKERS at a time (map_scope_keywords).
dynamodb = scoped_dynamodb_resource()

SEARCH_RESULTS_TABLE = search_results_table_name()
KEYWORDS_TABLE = keywords_table_name()

#: The exclusive sources each rollup lists, best lift first.
OUTREACH_TARGETS_LIMIT = 10

#: The most rollups one request without ``competitor`` builds.
MAX_ROLLUP_COMPETITORS = 10

_UNRANKED = 999


# ----------------------------------------------------------------------
# Sibling helper loader (same lazy pattern as get-reports-overview).
# Lazy so module-level boto3 calls in the sibling files don't fire at
# import time and so unit tests can stub the helpers via the cache.
# ----------------------------------------------------------------------

_sibling_cache: dict[str, Callable] = {}


def _load_sibling(filename: str, attr: str) -> Callable:
    return load_sibling_function(__file__, filename, attr, '_for_competitor')


def _gap_helper() -> Callable:
    """Lazy-load ``classify_latest_run(latest_items, config)`` from get-citation-gaps.py."""
    if 'gap' not in _sibling_cache:
        _sibling_cache['gap'] = _load_sibling(
            'get-citation-gaps.py', 'classify_latest_run'
        )
    return _sibling_cache['gap']


# ----------------------------------------------------------------------
# Keyword discovery + per-keyword evidence
# ----------------------------------------------------------------------

@dataclass(frozen=True)
class KeywordEvidence:
    """What one keyword's latest run says: each brand's best rank, and its citation gaps."""

    keyword: str
    ranks: dict[str, dict[str, Any]] = field(default_factory=dict)
    gaps: list[dict[str, Any]] = field(default_factory=list)


def _list_tracked_keywords(limit: int) -> tuple[list[str], int]:
    """The first ``limit`` active keywords in keyword order, and how many active keywords exist."""
    keywords = list(all_active_scope(dynamodb.Table(KEYWORDS_TABLE)).keywords)
    return keywords[:limit], len(keywords)


def _latest_run_rows(keyword: str) -> list[dict[str, Any]]:
    """The rows of ``keyword``'s latest run: brands, citations and provider only."""
    return query_latest_run(dynamodb.Table(SEARCH_RESULTS_TABLE), keyword)[1]


def _rank_of(brand: dict[str, Any]) -> int:
    try:
        return int(brand.get('rank') or _UNRANKED)
    except (TypeError, ValueError):
        return _UNRANKED


def _brand_ranks(latest_items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """The latest run's brand ranks indexed by lower-cased brand name (empty without rows)."""
    aggregated: dict[str, dict[str, Any]] = defaultdict(lambda: {
        'best_rank': _UNRANKED,
        'providers': set(),
        'classification': 'other',
    })
    for item in latest_items:
        provider = item.get('provider', '')
        for brand in item.get('brands', []) or []:
            name = (brand.get('name') or '').strip().lower()
            if not name:
                continue
            row = aggregated[name]
            row['best_rank'] = min(row['best_rank'], _rank_of(brand))
            row['providers'].add(provider)
            classification = brand.get('classification')
            if classification:
                row['classification'] = classification

    # Convert sets to sorted lists for stable JSON serialization
    return {
        name: {
            'best_rank': data['best_rank'],
            'providers': sorted(data['providers']),
            'classification': data['classification'],
        }
        for name, data in aggregated.items()
    }


def _keyword_evidence(keyword: str, config: dict[str, Any]) -> KeywordEvidence:
    """One read of ``keyword``'s latest run, turned into brand ranks and citation gaps.

    The gap helper is a sibling module's aggregation, so any failure in it is
    logged with its traceback and the keyword keeps its rank data.
    """
    rows = _latest_run_rows(keyword)
    try:
        gaps = _gap_helper()(rows, config)[0] if rows else []
    except Exception:
        logger.exception('gap helper failed for %r', keyword)
        gaps = []
    return KeywordEvidence(keyword, _brand_ranks(rows), gaps)


def _collect_evidence(keywords: list[str], config: dict[str, Any]) -> list[KeywordEvidence]:
    """Every keyword's evidence, read in parallel; a keyword whose read fails has none."""
    return map_scope_keywords(
        keywords,
        lambda keyword: _keyword_evidence(keyword, config),
        KeywordEvidence,
    )


# ----------------------------------------------------------------------
# Rollup composition
# ----------------------------------------------------------------------

def _outreach_lift(citation_count: int, provider_count: int) -> float:
    """
    Lift heuristic for outreach prioritisation. Sources cited by many
    providers + many times have higher lift. We use log scaling on
    citation_count to dampen the very-cited outliers (a single domain
    with 50 citations should not dwarf 5 domains with 10 each).
    """
    return round(provider_count * math.log(max(citation_count, 1) + 1), 2)


def _outranked_row(evidence: KeywordEvidence, their: dict[str, Any], first_party: list[str]) -> dict[str, Any] | None:
    """The keyword's outranked row when the competitor's best rank (``their``) beats every first-party brand's."""
    our_best = min((evidence.ranks[fp]['best_rank'] for fp in first_party if fp in evidence.ranks), default=_UNRANKED)
    if their['best_rank'] >= our_best:
        return None
    ranked = our_best < _UNRANKED
    return {
        'keyword': evidence.keyword,
        'their_best_rank': their['best_rank'],
        'our_best_rank': our_best if ranked else None,
        'rank_delta': (our_best - their['best_rank']) if ranked else None,
        'providers': their['providers'],
    }


def _exclusive_sources(evidence: KeywordEvidence, competitor_lc: str) -> list[dict[str, Any]]:
    """The keyword's gaps that name the competitor, with their outreach lift."""
    sources = []
    for gap in evidence.gaps:
        named = [b.lower() for b in gap.get('competitor_brands', []) or []]
        if competitor_lc not in named:
            continue
        citation_count = int(gap.get('citation_count', 0) or 0)
        provider_count = int(gap.get('provider_count', 0) or 0)
        sources.append({
            'keyword': evidence.keyword,
            'url': gap.get('url'),
            'domain': gap.get('domain'),
            'priority': gap.get('priority', 'low'),
            'citation_count': citation_count,
            'provider_count': provider_count,
            'providers': gap.get('providers', []),
            'lift_score': _outreach_lift(citation_count, provider_count),
        })
    return sources


def _build_competitor_rollup(
    competitor: str,
    evidence: list[KeywordEvidence],
    config: dict[str, Any],
) -> dict[str, Any]:
    """Compose one competitor's rollup.

    Exclusive sources are only gathered on keywords the competitor ranks on
    (as before); every one is counted, the best ``OUTREACH_TARGETS_LIMIT`` listed.
    """
    competitor_lc = competitor.lower()
    first_party = [
        b.lower() for b in config.get('tracked_brands', {}).get('first_party', [])
    ]

    outranked: list[dict[str, Any]] = []
    exclusive_sources: list[dict[str, Any]] = []

    for keyword_evidence in evidence:
        their = keyword_evidence.ranks.get(competitor_lc)
        if not their or their['best_rank'] >= _UNRANKED:
            continue
        row = _outranked_row(keyword_evidence, their, first_party)
        if row is not None:
            outranked.append(row)
        exclusive_sources.extend(_exclusive_sources(keyword_evidence, competitor_lc))

    # Order outranked keywords by the size of the gap to us — biggest
    # delta first. Order outreach by lift (descending), then priority.
    outranked.sort(
        key=lambda r: (r['rank_delta'] if r['rank_delta'] is not None else -1),
        reverse=True,
    )
    exclusive_sources.sort(
        key=lambda s: (-s['lift_score'], priority_rank(s['priority'])),
    )

    return {
        'competitor': competitor,
        'outranked_keywords': outranked,
        'exclusive_source_count': len(exclusive_sources),
        'high_priority_source_count': sum(source['priority'] == 'high' for source in exclusive_sources),
        'outreach_targets': exclusive_sources[:OUTREACH_TARGETS_LIMIT],
    }


def build_competitor_rollups(
    config: dict[str, Any],
    competitor: str | None,
    keyword_limit: int,
) -> dict[str, Any]:
    """
    Top-level composer. When `competitor` is provided, returns a single
    rollup. Otherwise rolls up the first ``MAX_ROLLUP_COMPETITORS``
    configured competitors. Each keyword is read once either way.
    """
    tracked_brands = config.get('tracked_brands', {})
    configured = [str(b) for b in tracked_brands.get('competitors', []) or []]

    if competitor and competitor.lower() not in {c.lower() for c in configured}:
        # Returning a 400 on an unconfigured name is more helpful than
        # silently returning an empty rollup which the UI would then misinterpret.
        return {
            'error': f'Unknown competitor: {competitor!r}',
            'configured_competitors': configured,
        }

    keywords, active_count = _list_tracked_keywords(keyword_limit)
    evidence = _collect_evidence(keywords, config)
    header = {
        'generated_at': get_timestamp(),
        'keywords_analyzed': len(keywords),
        'keywords_truncated': active_count > len(keywords),
    }

    if competitor:
        return {
            **header,
            'competitor': competitor,
            'rollup': _build_competitor_rollup(competitor, evidence, config),
        }

    rolled_up = configured[:MAX_ROLLUP_COMPETITORS]
    return {
        **header,
        'competitors': configured,
        'competitors_truncated': len(configured) > len(rolled_up),
        'rollups': [_build_competitor_rollup(c, evidence, config) for c in rolled_up],
    }


# ----------------------------------------------------------------------
# Lambda entry point
# ----------------------------------------------------------------------

@api_handler
@validate({
    'competitor': {'type': str, 'max_length': 200},
    'keyword_limit': {'type': int, 'min': 1, 'max': 100, 'default': 50},
})
def handler(
    event: dict[str, Any],
    context: Any,
    competitor: str | None = None,
    keyword_limit: int = 50,
) -> dict[str, Any]:
    """API handler for GET /api/reports/competitor."""
    config = get_brand_config()
    payload = build_competitor_rollups(
        config, competitor=competitor, keyword_limit=keyword_limit,
    )
    if 'error' in payload:
        return validation_error(payload['error'], event, 'competitor')
    return success_response(payload, event)
