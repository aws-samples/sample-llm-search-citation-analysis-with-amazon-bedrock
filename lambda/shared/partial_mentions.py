"""
The ``mentions`` partial (track S3): one keyword's brand mentions for the Brands view and the sentiment examples.

``build`` reads one keyword's SearchResults rows of one run and keeps, per
**combo** (a persona filter x a provider filter, ``combo_key``; the empty
string is "every persona" / "every provider"), what
``shared.brand_mention_views.brand_summary`` computes over the rows that combo
keeps, in additive form:

- ``combos[combo]``: ``rows`` (rows kept), ``keywords`` (1 when any row was
  kept) and ``ts`` (the newest row timestamp),
- ``brands[combo][brand key]``: ``m`` total mentions, ``a`` appearances,
  ``k`` keywords, ``r`` best rank per provider (its keys are the providers),
  ``s`` sentiment label counts, ``p`` the ``APPEARANCE_PREVIEW_LIMIT`` best
  appearances as keys ``[rank, keyword casefold, keyword, sort key, brand
  index]`` (their text is read per request), ``f`` the order key of the
  first appearance and ``meta`` the ``[name, parent_company, classification]``
  of that first appearance (the live summary keeps the first mention's).

The order key ``[keyword casefold, keyword, sort key, brand index]`` is the
order the live path meets appearances in (scope keywords sorted
case-insensitively, a keyword's rows by sort key, a row's brands as stored),
so ties break the same way whatever order the keywords are merged in.

``sentiment`` counts the sightings ``shared.sentiment_examples`` lists, by
``classification|sentiment|provider``, so a sentiment-examples page reads
only the keywords that hold matches.

``merge`` sums counts, keeps minimum ranks and the smallest order keys: it is
associative and order-free, and never mutates ``part``.
"""

from __future__ import annotations

import copy
from collections.abc import Iterable, Mapping
from typing import Any

from shared.dynamo_decimal import to_int
from shared.kpi_engine import COMPETITOR, FIRST_PARTY, SENTIMENT_LABELS, answer_from_row
from shared.partial_contract import Partial, PartialConfig, RunRows

PREVIOUS_RUN = False

#: Best-ranked appearances kept per brand and combo (``brand_mention_views.APPEARANCE_PREVIEW_LIMIT``).
PREVIEW_LIMIT = 5

UNRANKED = 999

#: Appearance sentiment labels the summary counts (exact stored values, as the live summary does).
APPEARANCE_SENTIMENTS = ('positive', 'neutral', 'negative', 'mixed')

#: Separates the persona and provider parts of a combo key (neither id contains it).
_COMBO_SEPARATOR = '\x1f'

ALL_COMBO = _COMBO_SEPARATOR


def combo_key(persona: str | None, provider: str | None) -> str:
    """The key of the rows of ``persona`` (every persona when empty) and ``provider`` (every provider when empty)."""
    return f'{persona or ""}{_COMBO_SEPARATOR}{provider or ""}'


def order_key(keyword: str, sort_key: str, brand_index: int) -> list[Any]:
    """Where an appearance comes in the live path's reading order."""
    return [keyword.casefold(), keyword, sort_key, brand_index]


def _row_combos(row: Mapping[str, Any]) -> list[str]:
    """The combos whose filters keep ``row`` (``filter_rows`` semantics)."""
    persona = row.get('query_prompt_id', 'default')
    provider = row.get('provider')
    personas = [''] + ([persona] if isinstance(persona, str) and persona else [])
    providers = [''] + ([provider] if isinstance(provider, str) and provider else [])
    return [combo_key(each_persona, each_provider) for each_persona in personas for each_provider in providers]


def _new_stats(brand: Mapping[str, Any], first: list[Any]) -> dict[str, Any]:
    return {
        'm': 0, 'a': 0, 'k': 1, 'r': {}, 's': {}, 'p': [], 'f': first,
        'meta': [brand.get('name'), brand.get('parent_company'), brand.get('classification', 'other')],
    }


def _add_appearance(stats: dict[str, Any], brand: Mapping[str, Any], provider: str, position: list[Any]) -> None:
    rank = to_int(brand.get('rank'), UNRANKED)
    stats['m'] += to_int(brand.get('mention_count'), 1)
    stats['a'] += 1
    stats['r'][provider] = min(rank, stats['r'].get(provider, UNRANKED))
    sentiment = brand.get('sentiment')
    if sentiment in APPEARANCE_SENTIMENTS:
        stats['s'][sentiment] = stats['s'].get(sentiment, 0) + 1
    stats['p'] = sorted([*stats['p'], [rank, *position]])[:PREVIEW_LIMIT]


def _add_row_brands(brands: dict[str, dict[str, Any]], row: Mapping[str, Any], combos: list[str]) -> None:
    keyword = str(row.get('keyword') or '')
    sort_key = str(row.get('timestamp_provider') or '')
    provider = row.get('provider') or 'unknown'
    for index, brand in enumerate(row.get('brands') or []):
        name = brand.get('name')
        if not name:
            continue
        position = order_key(keyword, sort_key, index)
        for combo in combos:
            entries = brands.setdefault(combo, {})
            stats = entries.setdefault(name.lower(), _new_stats(brand, position))
            _add_appearance(stats, brand, provider, position)


def _sentiment_counts(rows: Iterable[Mapping[str, Any]]) -> dict[str, int]:
    """First-party and competitor sightings (``answer_from_row``) by ``classification|sentiment|provider``."""
    counts: dict[str, int] = {}
    for row in rows:
        answer = answer_from_row(row)
        if answer is None:
            continue
        for sighting in answer.sightings:
            if sighting.classification in (FIRST_PARTY, COMPETITOR) and sighting.sentiment in SENTIMENT_LABELS:
                key = sentiment_key(sighting.classification, sighting.sentiment, answer.provider)
                counts[key] = counts.get(key, 0) + 1
    return counts


def sentiment_key(classification: str, sentiment: str, provider: str) -> str:
    """The ``sentiment`` count key of one (classification, sentiment, provider)."""
    return f'{classification}|{sentiment}|{provider}'


def build(rows: RunRows, config: PartialConfig) -> Partial | None:
    """What one keyword's run adds to the brand-mention views; ``None`` for a run without rows."""
    del config  # The classification is stored per brand by the extraction step.
    if not rows:
        return None
    ordered = sorted(rows, key=lambda row: str(row.get('timestamp_provider') or ''))
    combos: dict[str, dict[str, Any]] = {}
    brands: dict[str, dict[str, dict[str, Any]]] = {}
    for row in ordered:
        row_combos = _row_combos(row)
        timestamp = str(row.get('timestamp') or '')
        for combo in row_combos:
            entry = combos.setdefault(combo, {'rows': 0, 'keywords': 1, 'ts': ''})
            entry['rows'] += 1
            entry['ts'] = max(entry['ts'], timestamp)
        _add_row_brands(brands, row, row_combos)
    return {'combos': combos, 'brands': brands, 'sentiment': _sentiment_counts(ordered)}


def _merge_stats(acc: dict[str, Any], part: Mapping[str, Any]) -> None:
    acc['m'] += part['m']
    acc['a'] += part['a']
    acc['k'] += part['k']
    for provider, rank in part['r'].items():
        acc['r'][provider] = min(rank, acc['r'].get(provider, UNRANKED))
    for label, count in part['s'].items():
        acc['s'][label] = acc['s'].get(label, 0) + count
    acc['p'] = sorted([*acc['p'], *copy.deepcopy(part['p'])])[:PREVIEW_LIMIT]
    if part['f'] < acc['f']:
        acc['f'], acc['meta'] = list(part['f']), list(part['meta'])


def merge(acc: Partial | None, part: Partial) -> Partial:
    """``acc`` with ``part`` added (``acc`` is mutated and returned; ``part`` is not touched)."""
    if acc is None:
        return copy.deepcopy(part)
    for combo, entry in part['combos'].items():
        current = acc['combos'].setdefault(combo, {'rows': 0, 'keywords': 0, 'ts': ''})
        current['rows'] += entry['rows']
        current['keywords'] += entry['keywords']
        current['ts'] = max(current['ts'], entry['ts'])
    for combo, entries in part['brands'].items():
        merged = acc['brands'].setdefault(combo, {})
        for key, stats in entries.items():
            if key in merged:
                _merge_stats(merged[key], stats)
            else:
                merged[key] = copy.deepcopy(stats)
    for key, count in part['sentiment'].items():
        acc['sentiment'][key] = acc['sentiment'].get(key, 0) + count
    return acc


def aggregate_score(stats: Mapping[str, Any]) -> int:
    """``brand_mention_views.collect_brands``' score: providers x 10 + (10 - best rank) + total mentions."""
    best = min(stats['r'].values(), default=UNRANKED)
    return len(stats['r']) * 10 + (10 - best) + stats['m']


def ranked_brands(entries: Mapping[str, Mapping[str, Any]]) -> list[tuple[str, Mapping[str, Any]]]:
    """``(brand key, stats)`` best aggregate score first, ties in reading order (``overall_rank`` = position + 1)."""
    return sorted(entries.items(), key=lambda item: (-aggregate_score(item[1]), item[1]['f']))


__all__ = [
    'ALL_COMBO',
    'PREVIEW_LIMIT',
    'PREVIOUS_RUN',
    'aggregate_score',
    'build',
    'combo_key',
    'merge',
    'order_key',
    'ranked_brands',
    'sentiment_key',
]
