"""
What one keyword's latest run says about each tracked competitor, and the per-competitor rollup
of ``GET /api/reports/competitor``.

Per keyword (``keyword_evidence``), for every configured competitor the run
names at a known rank: its best rank and providers, and its *exclusive
sources* (citation gaps naming it, ``shared.citation_gap_rules``) with their
outreach lift; plus the first party's best rank. Per competitor, over a
scope (``competitor_rollup``): the keywords where it outranks every
first-party brand, biggest gap first, and every exclusive source, best lift
first (an answer lists the ``OUTREACH_TARGETS_LIMIT`` best; ``view=outreach``
pages the rest, 2.45.0 wave 5).

The rules were in ``api/get-reports-competitor.py``; the handler's live path,
the ``actions`` partial and the ``competitor`` artifact share them here.
Every order ends on the scope's keyword order, so a rollup never depends on
the order keywords were merged in.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from shared.citation_gap_rules import classify_latest_run
from shared.constants import priority_rank
from shared.scope_order import brand_mentions, keyword_order

#: The exclusive sources an answer lists first for each competitor, best lift first.
OUTREACH_TARGETS_LIMIT = 10

UNRANKED = 999


def configured_competitors(config: Mapping[str, Any]) -> list[str]:
    """The tracked competitors' names, as configured."""
    tracked = config.get('tracked_brands') or {}
    return [str(name) for name in tracked.get('competitors') or []]


def _first_party_names(config: Mapping[str, Any]) -> list[str]:
    tracked = config.get('tracked_brands') or {}
    return [str(name).lower() for name in tracked.get('first_party') or []]


def _rank_of(brand: Mapping[str, Any]) -> int:
    try:
        return int(brand.get('rank') or UNRANKED)
    except (TypeError, ValueError):
        return UNRANKED


def brand_ranks(rows: Iterable[Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    """The run's best rank and providers of every brand named, by lower-cased name."""
    best: dict[str, int] = {}
    providers: dict[str, set[str]] = {}
    for provider, brand in brand_mentions(rows):
        name = (brand.get('name') or '').strip().lower()
        if name:
            best[name] = min(best.get(name, UNRANKED), _rank_of(brand))
            providers.setdefault(name, set()).add(provider)
    return {name: {'best_rank': best[name], 'providers': sorted(providers[name])} for name in best}


def outreach_lift(citation_count: int, provider_count: int) -> float:
    """Outreach priority of a source: providers times log-scaled citations (one very cited domain must not dwarf many)."""
    return round(provider_count * math.log(max(citation_count, 1) + 1), 2)


def _exclusive_sources(keyword: str, gaps: Iterable[Mapping[str, Any]], competitor_lc: str) -> list[dict[str, Any]]:
    sources = []
    for gap in gaps:
        if competitor_lc not in [name.lower() for name in gap.get('competitor_brands') or []]:
            continue
        citation_count = int(gap.get('citation_count', 0) or 0)
        provider_count = int(gap.get('provider_count', 0) or 0)
        sources.append({
            'keyword': keyword,
            'url': gap.get('url'),
            'domain': gap.get('domain'),
            'priority': gap.get('priority', 'low'),
            'citation_count': citation_count,
            'provider_count': provider_count,
            'providers': list(gap.get('providers') or []),
            'lift_score': outreach_lift(citation_count, provider_count),
        })
    return sources


def keyword_evidence(keyword: str, rows: Sequence[Mapping[str, Any]], config: Mapping[str, Any]) -> dict[str, Any] | None:
    """One keyword's competitor evidence from its latest run's rows; ``None`` when no configured competitor ranks.

    ``competitors`` holds, per configured competitor (lower-cased) the run
    names at a known rank, ``their`` (best rank, providers) and its exclusive
    ``sources``; ``our_best`` is the first party's best rank (``UNRANKED``
    when none is named).
    """
    if not rows:
        return None
    ranks = brand_ranks(rows)
    ranked = {name.lower() for name in configured_competitors(config)} & {name for name, rank in ranks.items() if rank['best_rank'] < UNRANKED}
    if not ranked:
        return None
    gaps = classify_latest_run(rows, config)[0]
    our_best = min((ranks[name]['best_rank'] for name in _first_party_names(config) if name in ranks), default=UNRANKED)
    return {
        'keyword': keyword,
        'our_best': our_best,
        'competitors': {name: {'their': ranks[name], 'sources': _exclusive_sources(keyword, gaps, name)} for name in sorted(ranked)},
    }


def _outranked_row(keyword: str, their: Mapping[str, Any], our_best: int) -> dict[str, Any] | None:
    if their['best_rank'] >= our_best:
        return None
    ranked = our_best < UNRANKED
    return {
        'keyword': keyword,
        'their_best_rank': their['best_rank'],
        'our_best_rank': our_best if ranked else None,
        'rank_delta': (our_best - their['best_rank']) if ranked else None,
        'providers': list(their['providers']),
    }


def outranked_order(row: Mapping[str, Any]) -> tuple[int, str, str]:
    """Biggest rank gap first (an unranked first party last), then the scope's keyword order."""
    delta = row['rank_delta']
    return -(delta if delta is not None else -1), *keyword_order(str(row['keyword']))


def source_order(source: Mapping[str, Any]) -> tuple[float, int, str, str]:
    """Best outreach lift first, then priority, then the scope's keyword order."""
    return -float(source['lift_score']), priority_rank(source['priority']), *keyword_order(str(source['keyword']))


def competitor_rollup(competitor: str, evidence: Iterable[Mapping[str, Any]]) -> dict[str, Any]:
    """One competitor's rollup over a scope's ``keyword_evidence`` values (any order): ``outreach_targets`` holds every exclusive source."""
    competitor_lc = competitor.lower()
    outranked: list[dict[str, Any]] = []
    sources: list[Mapping[str, Any]] = []
    for entry in sorted(evidence, key=lambda item: keyword_order(str(item['keyword']))):
        seen = entry['competitors'].get(competitor_lc)
        if seen is None:
            continue
        row = _outranked_row(str(entry['keyword']), seen['their'], int(entry['our_best']))
        if row is not None:
            outranked.append(row)
        sources.extend(seen['sources'])
    outranked.sort(key=outranked_order)
    sources.sort(key=source_order)
    return {
        'competitor': competitor,
        'outranked_keywords': outranked,
        'exclusive_source_count': len(sources),
        'high_priority_source_count': sum(source['priority'] == 'high' for source in sources),
        'outreach_targets': [dict(source) for source in sources],
    }


def unknown_competitor_error(competitor: str | None, config: Mapping[str, Any]) -> dict[str, Any] | None:
    """The 400 body for a ``competitor`` that is not configured (an empty rollup would read as "no gap")."""
    configured = configured_competitors(config)
    if competitor and competitor.lower() not in {name.lower() for name in configured}:
        return {'error': f'Unknown competitor: {competitor!r}', 'configured_competitors': configured}
    return None


__all__ = [
    'OUTREACH_TARGETS_LIMIT',
    'brand_ranks',
    'competitor_rollup',
    'configured_competitors',
    'keyword_evidence',
    'outranked_order',
    'outreach_lift',
    'source_order',
    'unknown_competitor_error',
]
