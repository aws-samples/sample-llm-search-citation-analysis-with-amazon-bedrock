"""Artifacts ``latest/<variant>``, ``latest/brands-<variant>`` and ``latest/keywords-<variant>`` (track S2): the visibility view.

A *variant* is ``_all`` (every answer) or one persona (``query_prompt_id``),
either one narrowed by the ``branded`` filter (``_all@neutral``,
``<persona>@branded``; ``shared.partial_kpi.slice_key``).
Folded from each keyword's ``kpi`` partial (``shared.partial_kpi``) of its
latest and previous run:

- ``latest/<variant>``: the view without the keyword rows and brands:
  ``timestamp``, ``keywords_analyzed``, ``keywords_with_data``, ``kpis``,
  ``change`` (like for like over the keywords answered in both runs),
  ``engines``, the ``SOURCES_LIMIT`` most cited ``sources`` and ``sources_total``;
- ``latest/brands-<variant>``: the whole leaderboard, each row with its
  ``position``, so the ``brand`` filter and the tracked brands listed below
  the top ``BRANDS_LIMIT`` are exact whatever the request asks;
- ``latest/keywords-<variant>``: a row per keyword of the scope, in scope
  order, served in pages of ``KEYWORDS_PAGE`` (``keywords_next_token``);
- ``latest/sources-<variant>``: every cited domain, most cited first.

Full lists (2.45.0): the body's ``brands`` and ``sources`` are the first page
of the whole leaderboard and source table; ``brands_next_token`` and
``sources_next_token`` page the rest through ``view=brands`` and
``view=sources`` (``LIST_PAGE`` rows a page, the first page from the top
when no token is given). The live path (``shared.kpi_scope_serve``) folds
the same partials and serves the same way, so a snapshot answer equals the
live one; its tokens name the ``live`` build.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from shared import partial_kpi
from shared.brand_names import FIRST_PARTY
from shared.partial_contract import KeywordLatest, KeywordLatestRun, Partial
from shared.snapshot_artifacts import ArtifactBuilder, SnapshotArtifacts, encode_snapshot_cursor
from shared.view_builder import ViewBuilder, params_of
from shared.visibility_views import BRANDS_LIMIT, SOURCES_LIMIT, run_change_fields

NAME = 'latest'

#: Keyword rows a body or a ``view=keywords`` page holds.
KEYWORDS_PAGE = 100

#: Rows a ``view=brands`` or ``view=sources`` page holds.
LIST_PAGE = 100

#: The views paging one whole list of the body.
LIST_VIEWS = ('brands', 'sources')


def variant_of(persona: str | None, branded: str = 'all') -> str:
    """The variant of a request's ``query_prompt_id`` (``None``: every answer) and ``branded`` filter."""
    return partial_kpi.slice_key(persona, branded)


def view_key(variant: str) -> str:
    return f'latest/{variant}'


def brands_key(variant: str) -> str:
    return f'latest/brands-{variant}'


def keywords_key(variant: str) -> str:
    return f'latest/keywords-{variant}'


def sources_key(variant: str) -> str:
    return f'latest/sources-{variant}'


def _kpi_part(run: KeywordLatestRun | None) -> Partial | None:
    return None if run is None else run['parts'].get('kpi')


@dataclass
class _VariantPools:
    """One variant's pools: every keyword's latest run, and the keywords answered in both runs, per run (their counts only)."""

    latest: dict[str, Any] | None = None
    compared_latest: dict[str, Any] | None = None
    compared_previous: dict[str, Any] | None = None
    compared: int = 0


#: The fields of a slice a keyword row reads (``_keyword_row``: ``has_answers``, ``kpis`` and the timestamp).
_ROW_FIELDS = ('timestamp', 'engines', 'keywords')


def _row_slice(pool: Mapping[str, Any]) -> dict[str, Any]:
    """What a keyword's row needs of its slice: the brand and domain tables (most of a slice) are pooled, never kept per keyword."""
    return {name: pool[name] for name in _ROW_FIELDS}


def _merge_row_counts(acc: dict[str, Any] | None, pool: Mapping[str, Any]) -> dict[str, Any]:
    """``pool``'s row fields added into ``acc``: all a compared pool is read for (``kpis`` of the ``change``), not its brand tables."""
    if acc is None:
        return {'timestamp': pool['timestamp'], 'engines': {provider: list(counts) for provider, counts in pool['engines'].items()}, 'keywords': list(pool['keywords'])}
    acc['timestamp'] = max(filter(None, (acc['timestamp'], pool['timestamp'])), default=None)
    for provider, counts in pool['engines'].items():
        total = acc['engines'].setdefault(provider, [0] * len(counts))
        total[:] = [kept + added for kept, added in zip(total, counts, strict=True)]
    acc['keywords'] = [kept + added for kept, added in zip(acc['keywords'], pool['keywords'], strict=True)]
    return acc


@dataclass
class LatestAcc:
    """What the fold keeps: the pools per variant and each keyword's own row slices (its row in every variant)."""

    variants: dict[str, _VariantPools] = field(default_factory=dict)
    keywords: list[tuple[list[str], str, dict[str, Any]]] = field(default_factory=list)
    """``(order key, keyword, {variant: _row_slice of its latest slice})`` per keyword folded (~5 KB at 10 personas, was ~250 KB)."""
    owned_domains: list[str] | None = None
    """The owned domains the partials were counted against (``None`` before the first partial)."""

    def add(self, keyword: str, latest: Partial | None, previous: Partial | None) -> None:
        if latest is not None and self.owned_domains is None:
            self.owned_domains = list(latest.get('owned_domains', ()))
        slices = (latest or {}).get('slices', {})
        before = (previous or {}).get('slices', {})
        self.keywords.append((partial_kpi.order_key(keyword), keyword, {variant: _row_slice(pool) for variant, pool in slices.items()}))
        for variant, pool in slices.items():
            pools = self.variants.setdefault(variant, _VariantPools())
            pools.latest = partial_kpi.merge_slice(pools.latest, pool)
            if partial_kpi.has_answers(pool) and partial_kpi.has_answers(before.get(variant)):
                pools.compared_latest = _merge_row_counts(pools.compared_latest, pool)
                pools.compared_previous = _merge_row_counts(pools.compared_previous, before[variant])
                pools.compared += 1


def _change(pools: _VariantPools, configured: bool) -> dict[str, Any] | None:
    if not pools.compared or pools.compared_latest is None or pools.compared_previous is None:
        return None
    return {
        'keywords_compared': pools.compared,
        **run_change_fields(partial_kpi.kpis(pools.compared_latest, configured), partial_kpi.kpis(pools.compared_previous, configured)),
    }


def _keyword_row(keyword: str, pool: Mapping[str, Any] | None, configured: bool) -> dict[str, Any]:
    if pool is None or not partial_kpi.has_answers(pool):
        return {'keyword': keyword, 'timestamp': None, 'has_data': False, 'kpis': None}
    return {'keyword': keyword, 'timestamp': pool['timestamp'], 'has_data': True, 'kpis': partial_kpi.kpis(pool, configured)}


def latest_artifacts(acc: LatestAcc | None) -> dict[str, Any]:
    """Every variant's three artifacts (see the module docstring), the citation KPIs against the partials' owned domains.

    A scope without any partial does not know them: its views say so
    (``owned_known`` false) and ``serve`` answers the KPIs of no answer for
    the request's configuration.
    """
    folded = acc or LatestAcc()
    domains = list(folded.owned_domains or ())
    configured = bool(domains)
    ordered = sorted(folded.keywords, key=lambda entry: entry[0])
    artifacts: dict[str, Any] = {}
    for variant in sorted({partial_kpi.ALL, *folded.variants}):
        pools = folded.variants.get(variant, _VariantPools())
        pool = pools.latest or partial_kpi.empty_slice()
        rows = [_keyword_row(keyword, slices.get(variant), configured) for _order, keyword, slices in ordered]
        sources = partial_kpi.source_rows_of(pool, domains)
        artifacts[view_key(variant)] = {
            'timestamp': pool['timestamp'],
            'keywords_analyzed': len(rows),
            'keywords_with_data': sum(row['has_data'] for row in rows),
            'kpis': partial_kpi.kpis(pool, configured),
            'change': _change(pools, configured),
            'engines': partial_kpi.engine_rows(pool, configured),
            'sources': sources[:SOURCES_LIMIT],
            'sources_total': len(sources),
            'owned_known': folded.owned_domains is not None,
        }
        artifacts[brands_key(variant)] = [{**row, 'position': index + 1} for index, row in enumerate(partial_kpi.brand_rows(pool))]
        artifacts[keywords_key(variant)] = rows
        artifacts[sources_key(variant)] = sources
    return artifacts


def narrowed_brands(leaderboard: list[dict[str, Any]], brand: str | None) -> list[dict[str, Any]]:
    """The leaderboard rows whose name contains ``brand`` (every row without one)."""
    return [row for row in leaderboard if brand.lower() in row['name'].lower()] if brand else leaderboard


def listed_brands(leaderboard: list[dict[str, Any]], brand: str | None, tracked_brands: Iterable[str]) -> tuple[list[dict[str, Any]], int]:
    """``visibility_view``'s ``brands`` and ``brands_total``: the leaderboard narrowed to ``brand``, its top ``BRANDS_LIMIT``, then the first-party and tracked brands below."""
    rows = narrowed_brands(leaderboard, brand)
    tracked = {name.lower() for name in tracked_brands}
    beyond = [row for row in rows[BRANDS_LIMIT:] if row['classification'] == FIRST_PARTY or row['name'].lower() in tracked]
    return rows[:BRANDS_LIMIT] + beyond, len(rows)


@dataclass(frozen=True)
class LatestParams:
    """What a visibility request asks the artifacts for."""

    persona: str | None = None
    branded: str = 'all'
    """A ``BRANDED_FILTERS`` value: every answer, or only those to queries that do not (``neutral``) or do (``branded``) name the brand."""
    brand: str | None = None
    tracked_brands: tuple[str, ...] = ()
    view: str = 'summary'
    """``summary`` (the whole view, the first keyword page), ``keywords`` (one keyword page), ``brands`` or ``sources`` (one page of that list)."""
    citations_configured: bool = False
    """Whether the request's brand configuration has owned domains (read only for a scope without any answer)."""
    offset: int = 0
    page_size: int | None = KEYWORDS_PAGE
    """``None``: every keyword row in one body (the live path)."""


def keyword_page(rows: list[dict[str, Any]], offset: int, page_size: int | None, build_id: str) -> tuple[list[dict[str, Any]], str | None]:
    """The rows of one page from ``offset`` and the token of the next (``None`` past the end, or for one whole-list page)."""
    if page_size is None:
        return rows[offset:], None
    end = offset + page_size
    return rows[offset:end], encode_snapshot_cursor(end, len(rows), build_id)


def keyword_rows_page(rows: list[dict[str, Any]], offset: int, page_size: int | None, build_id: str) -> dict[str, Any]:
    """A ``view=keywords`` page of ``rows``: ``keywords``, ``keywords_total`` and the ``next_token`` of the rest."""
    page, next_token = keyword_page(rows, offset, page_size, build_id)
    return {'keywords': page, 'keywords_total': len(rows), 'next_token': next_token}


def list_page(rows: list[dict[str, Any]], name: str, offset: int, build_id: str) -> dict[str, Any]:
    """A ``view=brands`` / ``view=sources`` page: ``LIST_PAGE`` rows of ``rows`` from ``offset``, ``<name>_total`` and the ``next_token``."""
    end = offset + LIST_PAGE
    return {name: rows[offset:end], f'{name}_total': len(rows), 'next_token': encode_snapshot_cursor(end, len(rows), build_id)}


def _list_view(artifacts: SnapshotArtifacts, request: LatestParams, variant: str) -> dict[str, Any] | None:
    if request.view == 'brands':
        leaderboard = artifacts.load(brands_key(variant))
        if leaderboard is None:
            return None
        return list_page(narrowed_brands(leaderboard, request.brand), 'brands', request.offset, artifacts.build_id)
    sources = artifacts.load(sources_key(variant))
    return None if sources is None else list_page(sources, 'sources', request.offset, artifacts.build_id)


def serve_latest(artifacts: SnapshotArtifacts, request: LatestParams) -> dict[str, Any] | None:
    """The visibility body (or one keyword, brand or source page) of ``request``; ``None`` when the build does not hold its variant."""
    variant = variant_of(request.persona, request.branded)
    if request.view in LIST_VIEWS:
        return _list_view(artifacts, request, variant)
    rows = artifacts.load(keywords_key(variant))
    if rows is None:
        return None
    listing = keyword_rows_page(rows, request.offset, request.page_size, artifacts.build_id)
    if request.view == 'keywords':
        return listing
    view = artifacts.load(view_key(variant))
    leaderboard = artifacts.load(brands_key(variant))
    if view is None or leaderboard is None:
        return None
    brands, brands_total = listed_brands(leaderboard, request.brand, request.tracked_brands)
    kpis = view['kpis'] if view['owned_known'] else partial_kpi.kpis(partial_kpi.empty_slice(), request.citations_configured)
    return {
        **{name: view[name] for name in ('timestamp', 'keywords_analyzed', 'keywords_with_data')},
        'kpis': kpis,
        'change': view['change'],
        'brands': brands,
        'brands_total': brands_total,
        'brands_next_token': encode_snapshot_cursor(BRANDS_LIMIT, brands_total, artifacts.build_id),
        **{name: view[name] for name in ('engines', 'sources', 'sources_total')},
        'sources_next_token': encode_snapshot_cursor(SOURCES_LIMIT, view['sources_total'], artifacts.build_id),
        'keywords': listing['keywords'],
        'keywords_total': len(rows),
        'keywords_next_token': listing['next_token'],
    }


def _add(acc: LatestAcc | None, latest: KeywordLatest) -> LatestAcc:
    folded = acc or LatestAcc()
    folded.add(latest['keyword'], _kpi_part(latest['latest']), _kpi_part(latest['previous']))
    return folded


#: The ``latest`` artifacts of a scope (see the module docstring).
LATEST_BUILDER: ViewBuilder[LatestAcc] = ViewBuilder(
    NAME, _add, latest_artifacts, lambda artifacts, params: serve_latest(artifacts, params_of(LatestParams, params)),
)


def live_latest_artifacts(latests: Iterable[KeywordLatest], variant: str) -> dict[str, Any]:
    """The artifacts of keywords read for one request, ``variant`` included even when no answer asked it (its view is then empty)."""
    acc = LatestAcc()
    for latest in latests:
        acc.add(latest['keyword'], _kpi_part(latest['latest']), _kpi_part(latest['previous']))
    acc.variants.setdefault(variant, _VariantPools())
    return latest_artifacts(acc)


#: This module's ``shared.snapshot_artifacts.ArtifactBuilder`` instances (``shared.artifact_registry`` collects them).
BUILDERS: tuple[ArtifactBuilder[Any], ...] = (LATEST_BUILDER,)
