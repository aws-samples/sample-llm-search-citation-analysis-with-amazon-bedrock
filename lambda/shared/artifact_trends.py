"""Artifacts ``trends/<period>-<days>`` (track S2): the trend presets of ``/trends`` and ``/reports/overview``.

One artifact per preset (``PERIODS`` x ``PRESET_DAYS``): the whole trend body
of the scope over the ``days`` before the build (``since``), from
``shared.visibility_views.trend_view`` over each keyword's run tallies, so a
served preset equals the live view at the build time. ``keyword_trends`` is
served in pages of ``KEYWORD_TRENDS_PAGE`` (``keyword_trends_next_token``;
``view=keyword_trends`` answers the next page); ``/reports/overview`` takes
the whole list for its top movers. Full lists (2.45.0 wave 5): the preset
keeps the whole ``latest_brands`` leaderboard; a body lists its first
``LATEST_BRANDS_LIMIT`` (``latest_brands_total``, ``latest_brands_next_token``,
``view=latest_brands`` pages the rest) and ``top_movers`` ranks every
keyword, not only the first page. Every brand's KPIs per period sit in their
own artifact (``trends_brands_key``), paged by ``view=brand_series``.

The runs of a keyword come from its KeywordLatest object (``keyword_runs``):

- ``tallies``: its latest and previous run with every brand;
- ``recent``: its base tallies (no brands) of the ``RECENT_DAYS`` before its latest run;
- ``history`` (optional): every run of the window with its brands, attached
  by a view job or a build that read KeywordRunKpis / KeywordRunBrands.

A preset is written only when it is exact: every run of its window holds its
brands (``latest_brands`` and ``brand_trends`` pool them) and the window is
covered (``RECENT_DAYS`` without ``history``). Any other preset, and any
``days`` that is not a preset, is not served (``serve`` answers ``None``) and
the route answers with a view job: never a partial trend.
"""

from __future__ import annotations

from collections.abc import Callable, Generator, Iterable, Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any

from shared.answer_queries import history_since
from shared.artifact_latest import keyword_page, list_page
from shared.keyword_run_kpis import tally_from_item
from shared.kpi_tally import RunTally
from shared.partial_contract import KeywordLatest
from shared.snapshot_artifacts import ArtifactBuilder, SnapshotArtifacts, encode_snapshot_cursor, keywords_served
from shared.view_builder import ViewBuilder, params_of
from shared.visibility_views import LATEST_BRANDS_LIMIT, PERIODS, trend_view

NAME = 'trends'

#: The ``days`` a build precomputes.
PRESET_DAYS = (7, 30, 90, 180, 365)

#: Days of base tallies a KeywordLatest object keeps before its latest run (``recent``).
RECENT_DAYS = 62

#: The longest preset a scope without ``history`` can be exact for (its window is covered by ``recent``).
LONGEST_RECENT_PRESET = max(days for days in PRESET_DAYS if days <= RECENT_DAYS)
#: Days of runs a keyword without ``history`` keeps: ``LONGEST_RECENT_PRESET`` before its newest run, and one day of slack
#: for a build clock behind the run's (a window starts ``days`` before the build, never before the newest run).
KEPT_RECENT_DAYS = LONGEST_RECENT_PRESET + 1

#: ``keyword_trends`` rows a body or a ``view=keyword_trends`` page holds.
KEYWORD_TRENDS_PAGE = 100

#: The views answering one page of a list (the others answer the body).
PAGED_VIEWS = ('keyword_trends', 'latest_brands', 'brand_series')
#: The view paging every brand's KPIs per period (its own artifact, ``trends_brands_key``).
BRAND_SERIES_VIEW = 'brand_series'

#: Keywords ``top_movers`` lists each way (ranked over every keyword of the scope).
TOP_MOVERS = 5


#: The time the window presets end at while a build finalizes (``build_clock``); unset: now.
_BUILD_NOW: ContextVar[datetime | None] = ContextVar('build_now', default=None)


@contextmanager
def build_clock(now: datetime) -> Generator[None]:
    """Window presets finalized in the block end at ``now`` (the build's start): every scope and every invocation of one build agree."""
    token = _BUILD_NOW.set(now)
    try:
        yield
    finally:
        _BUILD_NOW.reset(token)


def build_now() -> datetime:
    """The end of the window presets: the build's time inside ``build_clock``, else now."""
    return _BUILD_NOW.get() or datetime.now(UTC)


def trends_key(period: str, days: int) -> str:
    return f'trends/{period}-{days}'


def trends_brands_key(period: str, days: int) -> str:
    """The artifact of every brand's KPIs per period of a preset (``view=brand_series``), apart: only that view reads it."""
    return f'trends/{period}-{days}-brands'


@dataclass(frozen=True)
class KeywordRun:
    """One run of a keyword and whether its tally holds the run's brands."""

    tally: RunTally
    has_brands: bool


def _entries(value: object) -> list[Mapping[str, Any]]:
    """The tally entries of a KeywordLatest block (a list, or a mapping by timestamp)."""
    items = value.values() if isinstance(value, Mapping) else value
    return [entry for entry in items if isinstance(entry, Mapping)] if isinstance(items, Iterable) and not isinstance(items, str) else []


def keyword_runs(latest: KeywordLatest, *, brands: bool = True) -> tuple[list[KeywordRun], bool]:
    """The keyword's runs the object holds, oldest first (a run with brands wins), and whether ``history`` covers the window.

    ``brands`` false: the runs without their brand tallies (``has_brands`` kept), for a window builder that
    reads none (most of a run's memory: ~55 KB a run with brands at 4 engines).

    A build folds one object into every scope it belongs to (~9 at the 10x point) and into both window
    builders, one call after the other: the last object's runs are kept and handed out again, so every
    scope's accumulator shares one decoded list per keyword instead of a copy each (read-only).
    """
    last = _LAST_RUNS[0]
    if last is None or last.latest is not latest:
        last = _DecodedRuns(latest, *_decode_runs(latest))
        _LAST_RUNS[0] = last
    if brands:
        return last.runs, last.has_history
    if last.without_brands is None:
        last.without_brands = without_brands(last.runs)
    return last.without_brands, last.has_history


@dataclass
class _DecodedRuns:
    latest: KeywordLatest
    runs: list[KeywordRun]
    has_history: bool
    without_brands: list[KeywordRun] | None = None


#: The object ``keyword_runs`` decoded last and what it answered (one entry, swapped whole: safe across threads).
_LAST_RUNS: list[_DecodedRuns | None] = [None]


def without_brands(runs: list[KeywordRun]) -> list[KeywordRun]:
    """``runs`` with empty brand tallies (``has_brands`` kept: whether a window is exact does not change)."""
    return [KeywordRun(replace(run.tally, brands=()), run.has_brands) if run.tally.brands else run for run in runs]


def no_brand_window_exact(runs: list[KeywordRun]) -> bool:
    """Whether, in a build (``build_clock``), no preset can pool brands because of this keyword's runs.

    A preset pools brands only when every run of its window holds them; every window of ``PRESET_DAYS``
    reaches back at least ``min(PRESET_DAYS)`` days from the build, so a run without brands from then
    until the build is in every window, and the scope writes no brand preset at all. Outside a build the
    finalize time is not known yet: never.
    """
    now = _BUILD_NOW.get()
    if now is None:
        return False
    since, until = history_since(min(PRESET_DAYS), now), history_since(0, now)
    return any(since <= run.tally.timestamp <= until for run in runs if not run.has_brands)


def _decode_runs(latest: KeywordLatest) -> tuple[list[KeywordRun], bool]:
    doc: Mapping[str, object] = latest
    keyword = latest['keyword']
    runs: dict[str, KeywordRun] = {}
    for block in ('recent', 'tallies', 'history'):
        for entry in _entries(doc.get(block)):
            tally = tally_from_item({**entry, 'keyword': keyword})
            if tally is None:
                continue
            run = KeywordRun(tally, 'brands' in entry)
            known = runs.get(tally.timestamp)
            if known is None or (run.has_brands and not known.has_brands):
                runs[tally.timestamp] = run
    ordered = [runs[stamp] for stamp in sorted(runs)]
    has_history = 'history' in doc
    return (ordered if has_history else recent_runs(ordered)), has_history


def recent_runs(runs: list[KeywordRun]) -> list[KeywordRun]:
    """The runs (oldest first) a scope without ``history`` can ever use: the ``KEPT_RECENT_DAYS`` before the newest one.

    Such a scope is exact for no preset longer than ``LONGEST_RECENT_PRESET`` (``covered_days``), and a
    preset's window starts ``days`` before the build, which is after the newest run; so an older run is
    never in a window. A year of runs is not held for a 30-day window (~3 KB a run at 4 engines).
    """
    if not runs:
        return runs
    newest = datetime.fromisoformat(runs[-1].tally.timestamp)
    since = history_since(KEPT_RECENT_DAYS, newest)
    return runs if runs[0].tally.timestamp >= since else [run for run in runs if run.tally.timestamp >= since]


def _owned_domains(latest: KeywordLatest) -> list[str] | None:
    """The owned domains the keyword's ``kpi`` partial counted citations against (``None`` without one)."""
    run = latest['latest']
    part = run['parts'].get('kpi') if run is not None else None
    domains = part.get('owned_domains') if isinstance(part, Mapping) else None
    return [str(domain) for domain in domains] if isinstance(domains, list) else None


@dataclass
class WindowAcc:
    """Each keyword's runs, in scope order, and how far back every keyword's runs are known (``trends``, ``group-kpis``)."""

    runs: dict[str, list[KeywordRun]] = field(default_factory=dict)
    covered_days: int | None = None
    """Days back from the build every keyword's runs are complete (``None``: no limit, every object had ``history``)."""
    owned_domains: list[str] = field(default_factory=list)
    with_brands: bool = True
    """Whether the runs keep their brand tallies (false once no brand preset can be exact, or for a builder that reads none)."""

    def add(self, keyword: str, runs: list[KeywordRun], has_history: bool, owned_domains: list[str] | None) -> None:
        if not has_history and self.covered_days is None:
            # The scope is now exact for no preset beyond the recent ones: the runs kept so far drop what no window can use.
            self.runs = {known: recent_runs(kept) for known, kept in self.runs.items()}
        self.runs[keyword] = runs if has_history and self.covered_days is None else recent_runs(runs)
        if not has_history:
            self.covered_days = RECENT_DAYS if self.covered_days is None else min(self.covered_days, RECENT_DAYS)
        if owned_domains is not None:
            self.owned_domains = owned_domains

    def window(self, days: int, now: datetime, *, brands: bool) -> tuple[str, dict[str, list[RunTally]]] | None:
        """``since`` and each keyword's tallies of the ``days`` before ``now``; ``None`` when they are not all known.

        ``brands``: the window also needs every run's brands.
        """
        if self.covered_days is not None and days > self.covered_days:
            return None
        since = history_since(days, now)
        runs = {keyword: [run for run in known if run.tally.timestamp >= since] for keyword, known in self.runs.items()}
        if brands and not all(run.has_brands for kept in runs.values() for run in kept):
            return None
        return since, {keyword: [run.tally for run in kept] for keyword, kept in runs.items()}


    def presets(self, now: datetime, make: Callable[[int, str, dict[str, list[RunTally]]], dict[str, Any]], *, brands: bool) -> dict[str, Any]:
        """The artifacts ``make(days, since, tallies)`` gives for every ``PRESET_DAYS`` whose window is known."""
        artifacts: dict[str, Any] = {}
        for days in PRESET_DAYS:
            window = self.window(days, now, brands=brands)
            if window is not None:
                artifacts.update(make(days, *window))
        return artifacts


def add_keyword_latest(acc: WindowAcc | None, latest: KeywordLatest) -> WindowAcc:
    """``acc`` with one more keyword's runs (the ``add`` of the trends builder).

    The brand tallies are kept until a keyword shows that no brand preset of the scope can be exact
    (``no_brand_window_exact``); from then on the scope's runs are held without them.
    """
    folded = acc or WindowAcc()
    if folded.with_brands and no_brand_window_exact(keyword_runs(latest)[0]):
        folded.with_brands = False
        folded.runs = {known: without_brands(kept) for known, kept in folded.runs.items()}
    return _add_runs(folded, latest)


def add_keyword_runs_without_brands(acc: WindowAcc | None, latest: KeywordLatest) -> WindowAcc:
    """``acc`` with one more keyword's runs, without brand tallies (the ``add`` of a window builder that reads none: ``group-kpis``)."""
    return _add_runs(acc or WindowAcc(with_brands=False), latest)


def _add_runs(folded: WindowAcc, latest: KeywordLatest) -> WindowAcc:
    runs, has_history = keyword_runs(latest, brands=folded.with_brands)
    folded.add(latest['keyword'], runs, has_history, _owned_domains(latest))
    return folded


def trend_body(
    keywords: list[str], runs_by_keyword: Mapping[str, Iterable[RunTally]], period: str, days: int, since: str, owned_domains: list[str],
    *, with_brand_series: bool = False,
) -> dict[str, Any]:
    """The trend fields of ``/trends`` over the runs from ``since`` on (the live view and every preset; ``brand_series`` when asked)."""
    return {
        'period_type': period,
        'days_analyzed': days,
        'since': since,
        'citations_configured': bool(owned_domains),
        **trend_view(keywords, runs_by_keyword, period, owned_domains, with_brand_series=with_brand_series),
    }


def preset_artifacts(body: dict[str, Any], period: str, days: int) -> dict[str, Any]:
    """The artifacts of one preset: the trend body and, apart, its ``brand_series``."""
    series = body.pop('brand_series', [])
    return {trends_key(period, days): body, trends_brands_key(period, days): series}


def trends_artifacts(acc: WindowAcc | None, now: datetime | None = None) -> dict[str, Any]:
    """Every exact preset of the scope (see the module docstring), as of ``now`` (the build)."""
    if acc is None:
        return {}
    keywords, owned = list(acc.runs), acc.owned_domains

    def periods(days: int, since: str, tallies: dict[str, list[RunTally]]) -> dict[str, Any]:
        artifacts: dict[str, Any] = {}
        for period in PERIODS:
            artifacts.update(preset_artifacts(trend_body(keywords, tallies, period, days, since, owned, with_brand_series=True), period, days))
        return artifacts

    return acc.presets(now or build_now(), periods, brands=True)


@dataclass(frozen=True)
class TrendsParams:
    """What a trends request asks of a build: the preset, the view and the page."""

    period: str = 'day'
    days: int = 30
    view: str = 'summary'
    offset: int = 0
    page_size: int | None = KEYWORD_TRENDS_PAGE


def _mover(row: Mapping[str, Any]) -> dict[str, Any]:
    return {'keyword': row['keyword'], 'visibility_score': row['kpis']['visibility_score'], 'change': row['change']['deltas']['visibility_score']}


def top_movers(keyword_trends: Iterable[Mapping[str, Any]], limit: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The ``limit`` keywords whose visibility score rose the most, and those whose score fell the most, since their previous period."""
    changed = [_mover(row) for row in keyword_trends if row.get('change') and row['change']['deltas']['visibility_score'] is not None]
    improvers = sorted((mover for mover in changed if mover['change'] > 0), key=lambda mover: -mover['change'])
    decliners = sorted((mover for mover in changed if mover['change'] < 0), key=lambda mover: mover['change'])
    return improvers[:limit], decliners[:limit]


def trend_answer(stored: Mapping[str, Any], request: TrendsParams, build_id: str) -> dict[str, Any]:
    """The body (or the ``view`` page) a whole trend body ``stored`` answers ``request`` with: from a build, or live (``build_id`` ``live``).

    ``latest_brands`` keeps its first ``LATEST_BRANDS_LIMIT`` rows
    (``latest_brands_total``; ``latest_brands_next_token`` and
    ``view=latest_brands`` page the rest), ``keyword_trends`` its first page,
    and ``top_movers`` ranks every keyword of the scope.
    """
    if request.view == BRAND_SERIES_VIEW:
        return list_page(stored['brand_series'], BRAND_SERIES_VIEW, request.offset, build_id)
    rows: list[dict[str, Any]] = stored['keyword_trends']
    if request.view == 'latest_brands':
        return list_page(stored['latest_brands'], 'latest_brands', request.offset, build_id)
    page, next_token = keyword_page(rows, request.offset, request.page_size, build_id)
    if request.view == 'keyword_trends':
        return {'keyword_trends': page, 'keyword_trends_total': len(rows), 'next_token': next_token}
    brands: list[dict[str, Any]] = stored['latest_brands']
    improving, declining = top_movers(rows, TOP_MOVERS)
    return {
        **stored,
        'latest_brands': brands[:LATEST_BRANDS_LIMIT],
        'latest_brands_total': len(brands),
        'latest_brands_next_token': encode_snapshot_cursor(LATEST_BRANDS_LIMIT, len(brands), build_id),
        'keyword_trends': page,
        'keyword_trends_total': len(rows),
        'keyword_trends_next_token': next_token,
        'top_movers': {'improving': improving, 'declining': declining},
    }


def serve_trends(artifacts: SnapshotArtifacts, request: TrendsParams) -> dict[str, Any] | None:
    """The trend body (or one ``keyword_trends`` / ``latest_brands`` page) of ``request``; ``None`` when the build does not hold its preset."""
    if request.view == BRAND_SERIES_VIEW:
        series = artifacts.load(trends_brands_key(request.period, request.days))
        return None if series is None else list_page(series, BRAND_SERIES_VIEW, request.offset, artifacts.build_id)
    stored = artifacts.load(trends_key(request.period, request.days))
    if stored is None:
        return None
    answer = trend_answer(stored, request, artifacts.build_id)
    if request.view in PAGED_VIEWS:
        return answer
    return {**answer, 'truncated_before': None, 'keywords_analyzed': keywords_served(artifacts)}


#: The ``trends`` presets of a scope (see the module docstring).
TRENDS_BUILDER: ViewBuilder[WindowAcc] = ViewBuilder(
    NAME, add_keyword_latest, trends_artifacts, lambda artifacts, params: serve_trends(artifacts, params_of(TrendsParams, params)),
)

#: This module's ``shared.snapshot_artifacts.ArtifactBuilder`` instances (``shared.artifact_registry`` collects them).
BUILDERS: tuple[ArtifactBuilder[Any], ...] = (TRENDS_BUILDER,)

__all__ = [
    'BRAND_SERIES_VIEW',
    'BUILDERS',
    'KEYWORD_TRENDS_PAGE',
    'NAME',
    'PAGED_VIEWS',
    'PRESET_DAYS',
    'RECENT_DAYS',
    'TOP_MOVERS',
    'TRENDS_BUILDER',
    'KeywordRun',
    'TrendsParams',
    'WindowAcc',
    'add_keyword_latest',
    'add_keyword_runs_without_brands',
    'build_clock',
    'build_now',
    'keyword_runs',
    'no_brand_window_exact',
    'preset_artifacts',
    'recent_runs',
    'serve_trends',
    'top_movers',
    'trend_answer',
    'trend_body',
    'trends_artifacts',
    'trends_brands_key',
    'trends_key',
    'without_brands',
]
