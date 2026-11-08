"""
Artifacts ``mentions/<persona>-<provider>`` and ``mentions/brand-index`` (track S3): the Brands view and the brand drill-down.

The fold merges every keyword's ``mentions`` partial (``shared.partial_mentions``)
and remembers, per brand, which keywords name it. ``finalize`` writes:

- ``mentions/<persona>-<provider>`` per combo (``_all`` = no filter): the
  ``aggregated`` block of ``GET /brand-mentions`` for each ``classification``
  filter (the best ``BRAND_LIMIT`` brands with their counts), the combo's
  ``timestamp``, ``keywords_with_data`` and ``available_runs``. Each brand
  carries ``preview_keys`` (keyword, sort key, brand index) of its best
  appearances instead of their text; ``serve`` reads those rows per request
  (``MentionReaders.preview_rows``: at most 500 rows, five BatchGets).
- ``mentions/brands/<persona>-<provider>`` per combo: every brand of the
  combo ranked, the same entries; ``view=brands`` pages it (``BRAND_LIMIT``
  brands a page, filtered by ``classification``) after the summary's first
  ``BRAND_LIMIT`` (``aggregated.brands_next_token``, 2.45.0 wave 5).
- ``mentions/brand-index``: the scope's keywords in scope order with their
  latest run and appearance counts per classification; per brand, the
  keywords naming it and, per combo, ``[overall_rank, appearances,
  classification, name]``; per combo its newest timestamp. The
  ``view=appearances`` pages walk it keyword by keyword and read only the
  keywords the page covers (``MentionReaders.run_rows``).

Equal to the live answer (``shared.brand_mention_views``) over the same runs:
``lambda/shared/test_artifact_mentions.py`` holds the uncapped live path as
the oracle.
"""

from __future__ import annotations

import hashlib
import re
from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from shared.brand_mention_views import (
    BRAND_LIMIT,
    RUN_LISTING_LIMIT,
    SENTIMENT_LABELS,
    aggregated_block,
    appearance_from_row,
    appearance_page,
    brands_page_block,
    filter_rows,
    keyword_appearances,
    with_brands_cursor,
)
from shared.keyword_major_pages import PageRequest, Slot, list_fingerprint, snapshot_page_fields
from shared.partial_contract import KeywordLatest, Partial
from shared.partial_mentions import ALL_COMBO, UNRANKED, aggregate_score, combo_key, merge, ranked_brands
from shared.request_deadline import current_deadline
from shared.snapshot_artifacts import (
    ArtifactBuilder,
    KeywordCursor,
    SnapshotArtifacts,
    SnapshotScope,
    cursor_expired_body,
    keywords_served,
)

BRAND_INDEX_KEY = 'mentions/brand-index'

#: The ``classification`` filters a combo artifact answers ('' = every classification).
CLASSIFICATION_FILTERS = ('', 'first_party', 'competitor', 'other')

_SAFE_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,63}')

RowKey = tuple[str, str]
"""A SearchResults row key: ``(keyword, timestamp_provider)``."""

PreviewRows = Callable[[list[RowKey]], Mapping[RowKey, Mapping[str, Any]]]
"""The rows at the given keys (a missing key is absent)."""


@dataclass(frozen=True)
class MentionReaders:
    """The reads a snapshot answer needs besides the build."""

    run_rows: Callable[[str, str], Sequence[Mapping[str, Any]]]
    """One keyword's rows of one run (``brand_mention_views.SCOPE_PROJECTION``), in sort-key order."""
    preview_rows: PreviewRows
    """The rows at the given keys (a missing key is absent), projected like ``run_rows``."""


def _id_part(value: str | None) -> str:
    if not value:
        return '_all'
    if _SAFE_ID.fullmatch(value):
        return value
    return 'h' + hashlib.sha256(value.encode('utf-8')).hexdigest()[:16]


def combo_artifact_key(query_prompt_id: str | None, provider: str | None) -> str:
    """``mentions/<persona>-<provider>`` (``_all`` for no filter; an id outside ``[A-Za-z0-9_.-]`` is hashed)."""
    return f'mentions/{_id_part(query_prompt_id)}-{_id_part(provider)}'


def combo_brands_key(query_prompt_id: str | None, provider: str | None) -> str:
    """``mentions/brands/<persona>-<provider>``: every brand of the combo, ranked (``view=brands``)."""
    return f'mentions/brands/{_id_part(query_prompt_id)}-{_id_part(provider)}'


def _combo_parts(combo: str) -> tuple[str, str]:
    persona, _separator, provider = combo.partition(ALL_COMBO)
    return persona, provider


# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

@dataclass
class MentionsAcc:
    merged: Partial | None
    keywords: dict[str, str]
    """Keyword -> the timestamp of the run its partial was built from."""
    brand_keywords: dict[str, dict[str, int]]
    """Brand key -> keyword -> appearances (every persona and provider)."""
    runs: set[str]


def _summary_entry(position: int, stats: Mapping[str, Any]) -> dict[str, Any]:
    """``brand_mention_views.summarize_brand`` of a merged brand, with preview keys instead of appearances."""
    ranks: dict[str, int] = dict(stats['r'])
    name, parent_company, classification = stats['meta']
    return {
        'name': name,
        'parent_company': parent_company,
        'classification': classification,
        'providers': sorted(ranks),
        'provider_count': len(ranks),
        'provider_ranks': ranks,
        'total_mentions': stats['m'],
        'best_rank': min(ranks.values(), default=UNRANKED),
        'aggregate_score': aggregate_score(stats),
        'overall_rank': position,
        'keyword_count': stats['k'],
        'appearance_count': stats['a'],
        'sentiment_counts': {label: stats['s'][label] for label in SENTIMENT_LABELS if stats['s'].get(label)},
        'appearances': [],
        'preview_keys': [[keyword, sort_key, index] for _rank, _folded, keyword, sort_key, index in stats['p']],
    }


def _aggregated(ranked: list[tuple[str, Mapping[str, Any]]], classification: str) -> dict[str, Any]:
    matching = [
        (position, stats) for position, (_key, stats) in enumerate(ranked, 1)
        if not classification or stats['meta'][2] == classification
    ]
    return aggregated_block(
        [_summary_entry(position, stats) for position, stats in matching[:BRAND_LIMIT]],
        total=len(ranked),
        matching=len(matching),
        classifications=Counter(stats['meta'][2] for _key, stats in ranked),
    )


def _brand_index(acc: MentionsAcc, rank_rows: dict[str, dict[str, list[Any]]]) -> dict[str, Any]:
    """The ``mentions/brand-index`` artifact."""
    ordered = sorted(acc.keywords, key=lambda keyword: (keyword.casefold(), keyword))
    positions = {keyword: position for position, keyword in enumerate(ordered)}
    counts: list[dict[str, int]] = [{} for _ in ordered]
    brands: dict[str, Any] = {}
    for key, per_keyword in acc.brand_keywords.items():
        combos = rank_rows.get(key, {})
        classification = combos.get(ALL_COMBO, [0, 0, 'other'])[2]
        for keyword, appearances in per_keyword.items():
            bucket = counts[positions[keyword]]
            bucket[classification] = bucket.get(classification, 0) + appearances
        brands[key] = {'kw': sorted([positions[keyword], appearances] for keyword, appearances in per_keyword.items()), 'c': combos}
    merged = acc.merged or {'combos': {}}
    return {
        'keywords': [[keyword, acc.keywords[keyword], counts[position]] for position, keyword in enumerate(ordered)],
        'combos': {combo: entry['ts'] or None for combo, entry in merged['combos'].items()},
        'brands': brands,
    }


@dataclass(frozen=True)
class MentionsBuilder:
    """``mentions/<persona>-<provider>`` and ``mentions/brand-index`` (see the module docstring)."""

    name: str = 'mentions'

    def fold(self, acc: MentionsAcc | None, latest: KeywordLatest, scope: SnapshotScope) -> MentionsAcc:
        del scope
        acc = MentionsAcc(None, {}, {}, set()) if acc is None else acc
        run, previous = latest.get('latest'), latest.get('previous')
        acc.runs.update(each['timestamp'] for each in (run, previous) if each is not None)
        part = None if run is None else run['parts'].get('mentions')
        if run is None or part is None:
            return acc
        acc.merged = merge(acc.merged, part)
        acc.keywords[latest['keyword']] = run['timestamp']
        for key, stats in part['brands'].get(ALL_COMBO, {}).items():
            acc.brand_keywords.setdefault(key, {})[latest['keyword']] = stats['a']
        return acc

    def finalize(self, acc: MentionsAcc | None) -> dict[str, Any]:
        acc = MentionsAcc(None, {}, {}, set()) if acc is None else acc
        merged = acc.merged or {'combos': {}, 'brands': {}}
        runs = sorted(acc.runs, reverse=True)[:RUN_LISTING_LIMIT]
        artifacts: dict[str, Any] = {}
        rank_rows: dict[str, dict[str, list[Any]]] = {}
        combos = dict(merged['combos'])
        combos.setdefault(ALL_COMBO, {'rows': 0, 'keywords': 0, 'ts': ''})
        for combo, entry in combos.items():
            ranked = ranked_brands(merged['brands'].get(combo, {}))
            for position, (key, stats) in enumerate(ranked, 1):
                rank_rows.setdefault(key, {})[combo] = [position, stats['a'], stats['meta'][2], stats['meta'][0]]
            artifacts[combo_brands_key(*_combo_parts(combo))] = [_summary_entry(position, stats) for position, (_key, stats) in enumerate(ranked, 1)]
            artifacts[combo_artifact_key(*_combo_parts(combo))] = {
                'timestamp': entry['ts'] or None,
                'keywords_with_data': entry['keywords'],
                'available_runs': runs,
                'aggregated': {classification: _aggregated(ranked, classification) for classification in CLASSIFICATION_FILTERS},
            }
        artifacts[BRAND_INDEX_KEY] = _brand_index(acc, rank_rows)
        return artifacts

    def serve(self, artifacts: SnapshotArtifacts, params: Mapping[str, Any]) -> dict[str, Any] | None:
        """The summary or the appearances page of ``params``; ``None`` for another run than each keyword's latest."""
        if params.get('timestamp'):
            return None
        if params.get('view') == 'appearances':
            return _serve_appearances(artifacts, params)
        if params.get('view') == 'brands':
            return _serve_brand_page(artifacts, params)
        return _serve_summary(artifacts, params)


# ---------------------------------------------------------------------------
# Serve
# ---------------------------------------------------------------------------

def hydrate_previews(aggregated: Mapping[str, Any], preview_rows: PreviewRows) -> dict[str, Any]:
    """``aggregated`` with each brand's ``appearances`` read from its ``preview_keys`` (one batch for every brand)."""
    keys = list(dict.fromkeys((keyword, sort_key) for brand in aggregated['brands'] for keyword, sort_key, _index in brand['preview_keys']))
    rows = preview_rows(keys) if keys else {}
    brands = []
    for brand in aggregated['brands']:
        appearances = []
        for keyword, sort_key, index in brand['preview_keys']:
            row = rows.get((keyword, sort_key))
            stored = (row.get('brands') or []) if row is not None else []
            if row is not None and index < len(stored):
                appearances.append(appearance_from_row(row, stored[index], row.get('provider') or 'unknown'))
        entry = {name: value for name, value in brand.items() if name != 'preview_keys'}
        brands.append({**entry, 'appearances': appearances})
    return {**aggregated, 'brands': brands}


def available_runs(artifacts: SnapshotArtifacts, stored: Mapping[str, Any]) -> list[str]:
    """The scope's newest ``RUN_LISTING_LIMIT`` runs: the scope series' runs (every run of the scope) with the build's own.

    The KeywordLatest objects hold only each keyword's two newest runs; the
    series (``load('series')``, outside the build) holds every run.
    """
    series = artifacts.load('series')
    rows = series.get('rows') if isinstance(series, Mapping) else None
    series_runs = {str(row['t']) for row in rows if isinstance(row, Mapping) and row.get('t') and row.get('k')} if isinstance(rows, list) else set()
    return sorted({*stored['available_runs'], *series_runs}, reverse=True)[:RUN_LISTING_LIMIT]


def _serve_summary(artifacts: SnapshotArtifacts, params: Mapping[str, Any]) -> dict[str, Any] | None:
    stored = artifacts.load(combo_artifact_key(params.get('query_prompt_id'), params.get('provider')))
    if stored is None:
        everything = artifacts.load(combo_artifact_key(None, None))
        if everything is None:
            return None
        # The build holds mentions but no row of this persona / provider.
        stored = {
            **everything, 'timestamp': None, 'keywords_with_data': 0,
            'aggregated': {classification: _aggregated([], classification) for classification in CLASSIFICATION_FILTERS},
        }
    readers: MentionReaders = params['readers']
    aggregated = hydrate_previews(stored['aggregated'][params.get('classification') or ''], readers.preview_rows)
    aggregated = with_brands_cursor(aggregated, artifacts.build_id)
    return {
        'keyword': None,
        'timestamp': stored['timestamp'],
        'available_runs': available_runs(artifacts, stored),
        'keywords_analyzed': keywords_served(artifacts),
        'keywords_with_data': stored['keywords_with_data'],
        'by_provider': [],
        'aggregated': aggregated,
        'keywords_truncated': False,
        'truncated': current_deadline().cut,
    }


def _serve_brand_page(artifacts: SnapshotArtifacts, params: Mapping[str, Any]) -> dict[str, Any] | None:
    """A ``view=brands`` page from ``params['offset']``; the ``cursor_expired`` body for a token of another build (``params['cursor_build']``)."""
    cursor_build = params.get('cursor_build')
    if cursor_build is not None and cursor_build != artifacts.build_id:
        return cursor_expired_body()
    query_prompt_id, provider = params.get('query_prompt_id'), params.get('provider')
    stored = artifacts.load(combo_artifact_key(query_prompt_id, provider))
    ranked = artifacts.load(combo_brands_key(query_prompt_id, provider)) if stored is not None else []
    if ranked is None or (stored is None and artifacts.load(combo_artifact_key(None, None)) is None):
        # A build of 2.45.0 wave 4 or older (no brand list), or a build without mentions: a view job answers.
        return None
    classification = params.get('classification')
    matching = [entry for entry in ranked if not classification or entry['classification'] == classification]
    offset = int(params.get('offset') or 0)
    readers: MentionReaders = params['readers']
    page = hydrate_previews({'brands': matching[offset:offset + BRAND_LIMIT]}, readers.preview_rows)
    return {
        'keyword': None,
        'timestamp': stored['timestamp'] if stored is not None else None,
        'aggregated': brands_page_block(page['brands'], len(matching), offset, artifacts.build_id),
        'keywords_truncated': False,
        'truncated': current_deadline().cut,
    }


def appearances_fingerprint(build_id: str, params: Mapping[str, Any]) -> str:
    """The ``f`` of an appearances cursor over the build ``build_id`` for these filters."""
    brand = params.get('brand')
    return list_fingerprint(
        'appearances', build_id, params.get('query_prompt_id'), params.get('provider'), params.get('classification'),
        brand.strip().lower() if brand else None,
    )


def _brand_slots(index: Mapping[str, Any], combo: str, classification: str | None, brand: str) -> tuple[list[Slot], int]:
    entry = index['brands'].get(brand.strip().lower())
    if entry is None:
        return [], 0
    ranked = entry['c'].get(combo)
    if ranked is None or (classification and ranked[2] != classification):
        return [], 0
    return [Slot(position, count) for position, count in entry['kw']], ranked[1]


def _scope_slots(index: Mapping[str, Any], combo: str, classification: str | None) -> tuple[list[Slot], int]:
    total = sum(
        ranked[1] for entry in index['brands'].values()
        if (ranked := entry['c'].get(combo)) is not None and (not classification or ranked[2] == classification)
    )
    # A keyword's counts are by each brand's classification over every persona and provider;
    # a narrower combo may classify a brand by another first mention, so it only skips empty keywords.
    exact = combo == ALL_COMBO
    slots = [
        Slot(position, counts.get(classification, 0) if classification and exact else sum(counts.values()))
        for position, (_keyword, _timestamp, counts) in enumerate(index['keywords'])
    ]
    return slots, total


def _serve_appearances(artifacts: SnapshotArtifacts, params: Mapping[str, Any]) -> dict[str, Any] | None:
    index = artifacts.load(BRAND_INDEX_KEY)
    if index is None:
        return None
    readers: MentionReaders = params['readers']
    query_prompt_id, provider = params.get('query_prompt_id'), params.get('provider')
    classification, brand = params.get('classification'), params.get('brand')
    combo = combo_key(query_prompt_id, provider)
    ranks = {key: ranked for key, entry in index['brands'].items() if (ranked := entry['c'].get(combo)) is not None}
    slots, total = _brand_slots(index, combo, classification, brand) if brand else _scope_slots(index, combo, classification)
    keywords: list[list[Any]] = index['keywords']

    def read(position: int) -> list[dict[str, Any]]:
        keyword, timestamp, _counts = keywords[position]
        rows = filter_rows([dict(row) for row in readers.run_rows(keyword, timestamp)], query_prompt_id, provider)
        return keyword_appearances(rows, ranks, classification, brand)

    cursor: KeywordCursor = params['cursor']
    appearances, token = appearance_page(PageRequest(slots, cursor, params['limit'], read, len(keywords)))
    return {
        'keyword': None,
        'timestamp': index['combos'].get(combo),
        'brand': brand,
        'appearances': appearances,
        'total_appearances': total,
        **snapshot_page_fields(token),
    }


#: This module's ``shared.snapshot_artifacts.ArtifactBuilder`` instances (``shared.artifact_registry`` collects them).
BUILDERS: tuple[ArtifactBuilder[Any], ...] = (MentionsBuilder(),)

__all__ = [
    'BRAND_INDEX_KEY',
    'BUILDERS',
    'CLASSIFICATION_FILTERS',
    'MentionReaders',
    'MentionsAcc',
    'MentionsBuilder',
    'PreviewRows',
    'appearances_fingerprint',
    'combo_artifact_key',
    'combo_brands_key',
    'hydrate_previews',
]
