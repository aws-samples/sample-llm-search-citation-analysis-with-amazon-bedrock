"""A deterministic tenant at any size, up to the 10x design point (design 2.45.0 §0, §5).

``ScaleSpec()`` is small and fast (40 keywords, 2 personas x 4 engines, 3
runs); ``TEN_X`` is the design point (5,000 keywords, 710 groups of at most
160, 15 markets, 10 personas x 4 engines, 365 daily runs). Every value is a
pure function of the spec and the indices, so two calls give equal data and
a test can regenerate one keyword's rows without holding the tenant.

- ``market_items`` / ``group_items`` / ``keyword_items``: the BrandConfig
  ``markets`` list, KeywordGroups rows and Keywords rows (``group_ids`` set).
- ``search_result_rows(spec, k, r)``: keyword ``k``'s SearchResults rows of
  run ``r`` (one per persona x engine), brands with ranks and sentiment,
  owned and third-party citations.
- ``keyword_run_kpis_item(spec, k, r)``: the KeywordRunKpis row the writer
  stores for that run (through the real ``run_tally`` / ``tally_item``).
- ``iter_search_results`` / ``iter_keyword_run_kpis``: lazy, keyword-major,
  oldest run first; at ``TEN_X`` they yield 73M / 1.8M rows, so slice them.
"""

from __future__ import annotations

import itertools
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import partial
from typing import Any

from shared.keyword_run_kpis import BRANDS_PER_RUN, tally_item, tracked_brand_names
from shared.keyword_store import build_keyword_item
from shared.kpi_engine import answers_from_rows, owned_domains_from
from shared.kpi_tally import run_tally

FIRST_PARTY = 'Hotel Coruña Mar'
OWNED_DOMAIN = 'hotel-coruna-mar.es'
COMPETITORS = ('Meliá Galicia', 'NH Collection Coruña', 'Eurostars Ciudad', 'Hesperia Finisterre', 'Silken Atlántida')

#: The tenant's BrandConfig ``default`` item: one first party, the competitors tracked, one owned domain.
BRAND_CONFIG: dict[str, Any] = {
    'config_id': 'default',
    'tracked_brands': {'first_party': [FIRST_PARTY], 'competitors': list(COMPETITORS)},
    'first_party_domains': [OWNED_DOMAIN],
    'updated_at': '2026-09-01T08:00:00Z',
}

ENGINES = ('openai', 'perplexity', 'gemini', 'claude')
_SENTIMENTS = ('positive', 'neutral', 'negative', 'mixed')
_COUNTRIES = ('ES', 'PT', 'FR', 'IT', 'DE', 'GB', 'IE', 'NL', 'BE', 'MX', 'AR', 'CL', 'CO', 'PE', 'US')
_FIRST_RUN = datetime(2025, 10, 6, 6, 0, tzinfo=UTC)
_CREATED = '2025-09-01T08:00:00Z'


@dataclass(frozen=True)
class ScaleSpec:
    """The size of a generated tenant."""

    keywords: int = 40
    groups: int = 6
    largest_group: int = 16
    markets: int = 3
    """Markets keywords are spread over; 0 = every keyword global."""
    personas: int = 2
    """Enabled personas; 0 = only the plain keyword (persona ``default``)."""
    engines: tuple[str, ...] = ENGINES
    runs: int = 3
    long_tail: int = 400
    """Distinct non-tracked brands the answers draw from."""


#: The 10x design point (design §0).
TEN_X = ScaleSpec(keywords=5_000, groups=710, largest_group=160, markets=15, personas=10, runs=365, long_tail=20_000)


def _mix(*values: int) -> int:
    """A deterministic, well-spread non-negative hash of ``values`` (no ``random``, no ``hash()`` seeding)."""
    state = 0x9E3779B97F4A7C15
    for value in values:
        state = (state ^ (value + 0x632BE59BD9B4E019)) * 0xBF58476D1CE4E5B9 % (1 << 64)
        state ^= state >> 29
    return state


def run_timestamp(run_index: int) -> str:
    """The SearchResults ``timestamp`` of daily run ``run_index`` (0 = the oldest)."""
    return (_FIRST_RUN + timedelta(days=run_index)).strftime('%Y-%m-%dT%H:%M:%S.000000Z')


def run_timestamps(spec: ScaleSpec) -> list[str]:
    return [run_timestamp(index) for index in range(spec.runs)]


def market_id(index: int) -> str:
    return f'{_COUNTRIES[index % len(_COUNTRIES)].lower()}-{index:02d}'


def market_items(spec: ScaleSpec) -> list[dict[str, Any]]:
    """The markets (``validate_market`` input shape)."""
    return [
        {
            'market_id': market_id(index),
            'country': _COUNTRIES[index % len(_COUNTRIES)],
            'country_name': f'Country {index:02d}',
            'language': 'es',
            'language_name': 'Spanish',
            'currency': 'EUR',
            'timezone': 'Europe/Madrid',
        }
        for index in range(spec.markets)
    ]


def persona_ids(spec: ScaleSpec) -> tuple[str, ...]:
    """The persona of every answer of a run: ``default`` alone when no persona is enabled."""
    return tuple(f'persona-{index:02d}' for index in range(spec.personas)) or ('default',)


def keyword_text(index: int) -> str:
    return f'hotel con encanto en galicia {index:05d}'


def group_id(index: int) -> str:
    return f'group-{index:04d}'


def group_size(spec: ScaleSpec, index: int) -> int:
    """Group 0 is the largest; the others are 1 .. ``largest_group`` keywords, never more than exist."""
    size = spec.largest_group if index == 0 else 1 + _mix(index, 7) % spec.largest_group
    return min(size, spec.keywords)


def group_members(spec: ScaleSpec, index: int) -> range:
    """The keyword indices of group ``index``: a contiguous block (wrapping at the end)."""
    start = _mix(index, 11) % spec.keywords if index else 0
    return range(start, start + group_size(spec, index))


def group_items(spec: ScaleSpec) -> list[dict[str, Any]]:
    return [
        {'id': group_id(index), 'name': f'Hotel group {index:04d}', 'description': '', 'created_at': _CREATED, 'updated_at': _CREATED}
        for index in range(spec.groups)
    ]


def keyword_items(spec: ScaleSpec) -> list[dict[str, Any]]:
    """Active Keywords rows; ``group_ids`` holds every group whose block covers the keyword."""
    memberships: dict[int, set[str]] = {}
    for index in range(spec.groups):
        for member in group_members(spec, index):
            memberships.setdefault(member % spec.keywords, set()).add(group_id(index))
    items = []
    for index in range(spec.keywords):
        market = market_id(index % spec.markets) if spec.markets else None
        item = build_keyword_item(keyword_text(index), timestamp=_CREATED, market_id=market)
        if index in memberships:
            item['group_ids'] = memberships[index]
        items.append(item)
    return items


def _brand(name: str, classification: str, rank: int, seed: int) -> dict[str, Any]:
    return {'name': name, 'classification': classification, 'rank': rank, 'sentiment': _SENTIMENTS[seed % len(_SENTIMENTS)]}


def _answer_brands(spec: ScaleSpec, seed: int) -> list[dict[str, Any]]:
    """Up to five brands in rank order: the first party in most answers, two competitors, long-tail names."""
    names: list[tuple[str, str]] = []
    if seed % 5:
        names.append((FIRST_PARTY, 'first_party'))
    names.extend((COMPETITORS[(seed >> shift) % len(COMPETITORS)], 'competitor') for shift in (3, 7))
    names.extend((f'Hostal {(seed >> shift) % spec.long_tail:05d}', 'other') for shift in (11, 17))
    unique = list(dict.fromkeys(names))
    offset = (seed >> 23) % 3
    return [_brand(name, classification, offset + position + 1, seed >> position) for position, (name, classification) in enumerate(unique)]


def _citations(seed: int) -> list[str]:
    owned = [f'https://www.{OWNED_DOMAIN}/habitaciones/{seed % 9}'] if seed % 3 == 0 else []
    return [*owned, f'https://guia-{seed % 37}.example/galicia/{seed % 101}', f'https://www.turismo-{seed % 13}.example/']


def search_result_rows(spec: ScaleSpec, keyword_index: int, run_index: int) -> list[dict[str, Any]]:
    """Keyword ``keyword_index``'s SearchResults rows of run ``run_index``: one answer per persona x engine."""
    keyword, timestamp = keyword_text(keyword_index), run_timestamp(run_index)
    rows = []
    for persona_index, persona in enumerate(persona_ids(spec)):
        for engine_index, engine in enumerate(spec.engines):
            seed = _mix(keyword_index, run_index, persona_index, engine_index)
            rows.append({
                'keyword': keyword,
                'timestamp': timestamp,
                'timestamp_provider': f'{timestamp}#{engine}#{persona}',
                'provider': engine,
                'query_prompt_id': persona,
                'status': 'success',
                'brands': _answer_brands(spec, seed),
                'citations': _citations(seed),
                'metadata': {'model': f'{engine}-model'},
                'response': f'Respuesta {seed % 1000} sobre {keyword}.',
            })
    return rows


def keyword_run_kpis_item(spec: ScaleSpec, keyword_index: int, run_index: int, built_at: str = _CREATED) -> dict[str, Any]:
    """The KeywordRunKpis row of that run, as ``record_run_kpis`` writes it for ``BRAND_CONFIG``."""
    tally = run_tally(
        keyword_text(keyword_index), run_timestamp(run_index),
        answers_from_rows(search_result_rows(spec, keyword_index, run_index)),
        owned_domains_from(BRAND_CONFIG), brand_cap=BRANDS_PER_RUN, tracked_brands=tracked_brand_names(BRAND_CONFIG),
    )
    return tally_item(tally, built_at)


def _keyword_runs(spec: ScaleSpec) -> Iterator[tuple[int, int]]:
    """Every (keyword index, run index), keyword-major, oldest run first."""
    return itertools.product(range(spec.keywords), range(spec.runs))


def iter_search_results(spec: ScaleSpec) -> Iterator[dict[str, Any]]:
    return itertools.chain.from_iterable(itertools.starmap(partial(search_result_rows, spec), _keyword_runs(spec)))


def iter_keyword_run_kpis(spec: ScaleSpec) -> Iterator[dict[str, Any]]:
    return itertools.starmap(partial(keyword_run_kpis_item, spec), _keyword_runs(spec))
