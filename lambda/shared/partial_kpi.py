"""
The ``kpi`` partial (track S2): what one keyword's run adds to the KPI views.

A partial is a **pool**: the additive counts of some answers, kept per
persona slice (``ALL`` for every answer, then one slice per persona that
answered), each also narrowed to the answers of queries that do not name the
brand and of those that do (``slice_key``). ``build`` pools one keyword's run; ``merge`` adds a pool to
another, so a scope's pool is the sum of its keywords' pools, in any order.
A pool slice holds (all JSON, it is stored in S3):

- ``engines``: ``{provider: COUNT_FIELDS counts}`` of the engines that answered;
- ``engine_keywords``: ``{provider: [keywords answered, keywords naming the brand]}``;
- ``keywords``: ``[keywords answered, keywords naming the brand]``;
- ``models``: ``{provider: [model, ...]}``;
- ``brands``: ``{key: [name, classification, mentions, points, rank_sum,
  rank_count, best_rank, [positive, neutral, negative, mixed], [engine, ...],
  keywords, order]}`` with **every** brand named (no cap). ``order`` is the
  scope-order key (``order_key``) of the keyword that named it first; the
  name and classification shown are that keyword's, as a pooled
  ``brand_table`` takes them from the first answer of the scope naming it;
- ``domains``: ``{domain: [citations, [engine, ...], keywords]}`` (``source_table``'s input);
- ``timestamp``: the newest answer's run.

Besides the slices a partial names its ``keyword`` (one keyword's), its
``timestamp``, and the ``owned_domains`` (and their ``owned`` fingerprint)
its citation counts were counted against.

The KPIs of a pool come from ``shared.kpi_tally`` / ``shared.kpi_engine``
(``kpis``, ``engine_rows``, ``brand_rows``, ``source_rows_of``): the formulas
live there only. Counting keywords instead of naming them is exact because a
scope adds each keyword once.
"""

from __future__ import annotations

import copy
from collections import defaultdict
from collections.abc import Iterable, Mapping
from typing import Any

from shared.kpi_engine import (
    BRANDED_FILTERS,
    Answer,
    DomainCount,
    answers_from_rows,
    filter_branded,
    leaderboard,
    owned_domains_from,
    source_rows,
)
from shared.kpi_tally import (
    COUNT_FIELDS,
    BrandTally,
    PooledCounts,
    brand_row,
    count_index,
    owned_fingerprint,
    pooled_kpis,
    run_tally,
)
from shared.partial_contract import Partial, PartialConfig, RunRows

PREVIOUS_RUN = True

#: The slice of every answer, whatever the persona.
ALL = '_all'

_ANSWERS = count_index('answers')
_MENTIONING = count_index('mentioning')
_TOTAL_MENTIONS = count_index('total_mentions')

# Positions in a ``brands`` entry.
_NAME, _CLASS, _MENTIONS, _POINTS, _RANK_SUM, _RANK_COUNT, _BEST, _SPLIT, _ENGINES, _KEYWORDS, _ORDER = range(11)


def order_key(keyword: str) -> list[str]:
    """Where ``keyword`` sorts in a scope (``resolve_scope`` sorts by ``casefold``; the text breaks ties)."""
    return [keyword.casefold(), keyword]


# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------

def _slice(keyword: str, timestamp: str, answers: list[Answer], owned: list[str]) -> dict[str, Any]:
    """The pool of one keyword's ``answers`` (one run)."""
    tally = run_tally(keyword, timestamp, answers, owned)
    order = order_key(keyword)
    citing: dict[str, set[str]] = defaultdict(set)
    citations: dict[str, int] = defaultdict(int)
    for answer in answers:
        for domain in answer.cited_domains:
            citations[domain] += 1
            citing[domain].add(answer.provider)
    naming = any(counts[_MENTIONING] for counts in tally.engines.values())
    return {
        'timestamp': timestamp,
        'engines': {provider: list(counts) for provider, counts in tally.engines.items()},
        'engine_keywords': {provider: [1, int(bool(counts[_MENTIONING]))] for provider, counts in tally.engines.items()},
        'keywords': [1, int(naming)],
        'models': {provider: list(names) for provider, names in tally.models.items()},
        'brands': {
            brand.key: [brand.name, brand.classification, *brand[3:8], list(brand.split), list(brand.engines), 1, order]
            for brand in tally.brands
        },
        'domains': {domain: [count, sorted(citing[domain]), 1] for domain, count in citations.items()},
    }


def slice_key(persona: str | None = None, branded: str = 'all') -> str:
    """The slice of one persona's answers (``None``: every persona), narrowed by a ``BRANDED_FILTERS`` value.

    ``all`` keeps the plain persona key (``ALL`` or the persona id); ``neutral``
    and ``branded`` add ``@neutral`` / ``@branded`` to it.
    """
    base = ALL if persona is None else persona
    return base if branded == 'all' else f'{base}@{branded}'


def build(rows: RunRows, config: PartialConfig) -> Partial | None:
    """The pool of one keyword's run ``rows``, per persona slice and branded filter; ``None`` when no row is an answer.

    Every slice comes three ways: every answer, the answers to queries that do
    not name the brand (``@neutral``) and those that do (``@branded``); a
    narrowed slice without answers is left out. A run holding a row stored
    before the branded flag (2.43.0) has no narrowed slices at all: its old
    rows would read as neutral, so a filtered view would mix two definitions
    (and compare a filtered run with an unfiltered one). Filtered views leave
    such a run out instead.
    """
    answers = answers_from_rows(rows)
    if not answers:
        return None
    keyword = answers[0].keyword
    timestamp = max(answer.timestamp for answer in answers)
    owned = owned_domains_from(config.brand_config)
    groups: dict[str | None, list[Answer]] = {None: answers}
    for persona in sorted({answer.persona for answer in answers}):
        groups[persona] = [answer for answer in answers if answer.persona == persona]
    slices: dict[str, dict[str, Any]] = {}
    classified = all(answer.branded_classified for answer in answers)
    for persona, persona_answers in groups.items():
        for branded in BRANDED_FILTERS if classified else ('all',):
            kept = filter_branded(persona_answers, branded)
            if kept or branded == 'all':
                slices[slice_key(persona, branded)] = _slice(keyword, timestamp, kept, owned)
    return {'keyword': keyword, 'timestamp': timestamp, 'owned': owned_fingerprint(owned), 'owned_domains': owned, 'slices': slices}


# ---------------------------------------------------------------------------
# merge
# ---------------------------------------------------------------------------

def _add_counts(total: list[int], added: Iterable[int]) -> None:
    for index, value in enumerate(added):
        total[index] += value


def _merge_brand(kept: list[Any], added: list[Any]) -> None:
    for index in (_MENTIONS, _POINTS, _RANK_SUM, _RANK_COUNT, _KEYWORDS):
        kept[index] += added[index]
    if added[_BEST] is not None and (kept[_BEST] is None or added[_BEST] < kept[_BEST]):
        kept[_BEST] = added[_BEST]
    _add_counts(kept[_SPLIT], added[_SPLIT])
    kept[_ENGINES] = sorted({*kept[_ENGINES], *added[_ENGINES]})
    if added[_ORDER] < kept[_ORDER]:
        kept[_NAME], kept[_CLASS], kept[_ORDER] = added[_NAME], added[_CLASS], added[_ORDER]


def _merge_domain(kept: list[Any], added: list[Any]) -> None:
    kept[0] += added[0]
    kept[1] = sorted({*kept[1], *added[1]})
    kept[2] += added[2]


def merge_slice(acc: dict[str, Any] | None, part: Mapping[str, Any]) -> dict[str, Any]:
    """``part``'s pool slice added into ``acc`` (a copy of ``part`` when ``acc`` is ``None``); ``part`` is never changed."""
    if acc is None:
        return copy.deepcopy(dict(part))
    acc['timestamp'] = max(filter(None, (acc.get('timestamp'), part.get('timestamp'))), default=None)
    for provider, counts in part['engines'].items():
        _add_counts(acc['engines'].setdefault(provider, [0] * len(COUNT_FIELDS)), counts)
    for provider, counts in part['engine_keywords'].items():
        _add_counts(acc['engine_keywords'].setdefault(provider, [0, 0]), counts)
    _add_counts(acc['keywords'], part['keywords'])
    for provider, names in part['models'].items():
        acc['models'][provider] = sorted({*acc['models'].get(provider, ()), *names})
    for table, merge_entry in (('brands', _merge_brand), ('domains', _merge_domain)):
        entries = acc[table]
        for key, entry in part[table].items():
            if key in entries:
                merge_entry(entries[key], entry)
            else:
                entries[key] = copy.deepcopy(entry)
    return acc


def merge(acc: Partial | None, part: Partial) -> Partial:
    """``part``'s pools added into ``acc``, slice by slice (associative and order-free); ``part`` is never changed."""
    if acc is None:
        merged: Partial = {
            'timestamp': part.get('timestamp'), 'owned': part.get('owned', ''), 'owned_domains': list(part.get('owned_domains', ())), 'slices': {},
        }
    else:
        merged = acc
        merged['timestamp'] = max(filter(None, (acc.get('timestamp'), part.get('timestamp'))), default=None)
    for name, pool in part['slices'].items():
        merged['slices'][name] = merge_slice(merged['slices'].get(name), pool)
    return merged


# ---------------------------------------------------------------------------
# KPIs of a pool (formulas in shared.kpi_tally / shared.kpi_engine)
# ---------------------------------------------------------------------------

def empty_slice() -> dict[str, Any]:
    """The pool of no answer."""
    return {'timestamp': None, 'engines': {}, 'engine_keywords': {}, 'keywords': [0, 0], 'models': {}, 'brands': {}, 'domains': {}}


def _answers(pool: Mapping[str, Any]) -> int:
    return sum(counts[_ANSWERS] for counts in pool['engines'].values())


def kpis(pool: Mapping[str, Any], citations_configured: bool) -> dict[str, Any]:
    """``brand_kpis`` of every answer ``pool`` counts."""
    totals = [0] * len(COUNT_FIELDS)
    for counts in pool['engines'].values():
        _add_counts(totals, counts)
    answered = [counts for counts in pool['engines'].values() if counts[_ANSWERS]]
    return pooled_kpis(
        PooledCounts(
            counts=totals,
            engines=len(answered),
            engines_naming=sum(1 for counts in answered if counts[_MENTIONING]),
            keywords=pool['keywords'][0],
            keywords_naming=pool['keywords'][1],
        ),
        citations_configured,
    )


def engine_rows(pool: Mapping[str, Any], citations_configured: bool) -> list[dict[str, Any]]:
    """``engine_breakdown`` of the answers ``pool`` counts: every KPI per AI engine, engines in name order."""
    rows = []
    for provider in sorted(pool['engines']):
        counts = pool['engines'][provider]
        answered, naming = pool['engine_keywords'][provider]
        engine = PooledCounts(
            counts=counts, engines=int(bool(counts[_ANSWERS])), engines_naming=int(bool(counts[_ANSWERS] and counts[_MENTIONING])),
            keywords=answered, keywords_naming=naming,
        )
        rows.append({'engine': provider, 'kpis': pooled_kpis(engine, citations_configured)})
    return rows


def brand_rows(pool: Mapping[str, Any]) -> list[dict[str, Any]]:
    """``brand_table`` of the answers ``pool`` counts: the whole leaderboard."""
    answers = _answers(pool)
    total_mentions = sum(counts[_TOTAL_MENTIONS] for counts in pool['engines'].values())
    return leaderboard([
        brand_row(_brand_tally(key, entry), keywords=entry[_KEYWORDS], answers=answers, total_mentions=total_mentions)
        for key, entry in pool['brands'].items()
    ])


def _brand_tally(key: str, entry: list[Any]) -> BrandTally:
    """The ``BrandTally`` of a ``brands`` entry."""
    return BrandTally(
        key, entry[_NAME], entry[_CLASS], entry[_MENTIONS], entry[_POINTS], entry[_RANK_SUM], entry[_RANK_COUNT],
        entry[_BEST], tuple(entry[_SPLIT]), tuple(entry[_ENGINES]),
    )


def source_rows_of(pool: Mapping[str, Any], owned_domains: Iterable[str]) -> list[dict[str, Any]]:
    """``source_table`` of the answers ``pool`` counts: one row per cited domain, most cited first."""
    counted = {
        domain: DomainCount(citations=entry[0], engines=frozenset(entry[1]), keywords=entry[2])
        for domain, entry in pool['domains'].items()
    }
    return source_rows(counted, _answers(pool), owned_domains)


def has_answers(pool: Mapping[str, Any] | None) -> bool:
    """Whether ``pool`` counts any answer."""
    return pool is not None and _answers(pool) > 0


__all__ = [
    'ALL',
    'PREVIOUS_RUN',
    'brand_rows',
    'build',
    'empty_slice',
    'engine_rows',
    'has_answers',
    'kpis',
    'merge',
    'merge_slice',
    'order_key',
    'slice_key',
    'source_rows_of',
]
