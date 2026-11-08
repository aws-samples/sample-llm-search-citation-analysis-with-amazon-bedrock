"""
Wiring shared by the report handlers whose scope is required.

``/visibility``, ``/visibility/sentiment-examples``, ``/brand-mentions`` and
``/reports/group-kpis`` answer 400 without exactly one scope parameter
(``required_report_scope``); the action lists resolve an optional one through
``scope_decorator``. Scope parsing itself lives in ``shared.scope_params``;
whether a scope is read live or served from its snapshot is
``shared.scope_source.route_scope`` (no keyword cap since 2.45.0). ``TREND_WINDOW_PARAMS`` are the ``period`` / ``days``
rules ``/trends`` and ``/reports/overview`` share. ``load_window_runs`` is
the bounded windowed read (per-run KPI rollups first, raw rows for runs
without one) behind ``/trends``, ``/reports/overview``,
``/reports/group-kpis`` and the stability facts of ``/reports/insights``.

Every read here honours the request's time budget (``shared.request_deadline``):
a keyword the budget leaves unread is left out of the answer and named in
``skipped`` (the routes report it as ``keywords_truncated``).
"""

from __future__ import annotations

import functools
import os
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from typing import Any, NamedTuple

from shared.answer_queries import query_keyword_rows_capped, query_keyword_run_rows
from shared.group_kpi_history import keyword_run_histories
from shared.keyword_run_brands import query_run_brands, with_all_brands
from shared.keyword_run_kpis import StoredRuns, query_stored_runs
from shared.kpi_engine import answers_from_rows
from shared.kpi_tally import RunTally, owned_fingerprint, run_tallies, run_tally
from shared.request_deadline import Deadline, current_deadline
from shared.scope_params import (
    MARKET_PARAM,
    SCOPE_PARAMS,
    map_scope_keywords,
    scope_from_request,
)
from shared.visibility_views import PERIODS

TREND_WINDOW_PARAMS: dict[str, dict[str, Any]] = {
    'period': {'type': str, 'choices': list(PERIODS), 'default': 'day'},
    'days': {'type': int, 'min': 1, 'max': 365, 'default': 30},
}
"""``@validate`` rules for a trend window: the bucket ``period`` and the last ``days`` days (1-365, default 30)."""


Decorator = Callable[[Callable[..., dict[str, Any]]], Callable[..., dict[str, Any] | None]]
"""A scope decorator: wraps ``handler(event, context, <scope>, **params)`` into ``(event, context, **params)``."""


def scope_decorator(
    keywords_table: Callable[[], Any],
    resolve: Callable[[dict[str, Any], dict[str, Any], Any], tuple[Any, dict[str, Any] | None]],
) -> Decorator:
    """Pop the scope parameters (and ``market_id``) ``@validate`` injected, resolve them, and hand the result to the handler.

    ``resolve`` answers ``(value, None)`` to call the handler with ``value`` as
    its third argument, or ``(None, response)`` to answer that 400 instead.
    ``keywords_table`` is called per request, so tests that patch the handler
    module's ``dynamodb`` resource are honoured.
    """
    def decorate(handler: Callable[..., dict[str, Any]]) -> Callable[..., dict[str, Any] | None]:
        @functools.wraps(handler)
        def with_scope(event: dict[str, Any], context: Any, **params: Any) -> dict[str, Any] | None:
            scope_params = {name: params.pop(name, None) for name in (*SCOPE_PARAMS, MARKET_PARAM)}
            value, rejected = resolve(event, scope_params, keywords_table())
            if rejected:
                return rejected
            return handler(event, context, value, **params)

        return with_scope

    return decorate


def required_report_scope(keywords_table: Callable[[], Any]) -> Decorator:
    """Resolve the scope parameters ``@validate`` injected into a ``ReportScope`` argument.

    Place it under ``@validate({**SCOPE_QUERY_PARAMS, ...})``; the handler
    receives ``(event, context, report_scope, **other_params)``. A missing or
    malformed scope is answered with the 400 of ``scope_from_request`` without
    calling the handler.
    """
    def resolve(event: dict[str, Any], scope_params: dict[str, Any], table: Any) -> tuple[Any, dict[str, Any] | None]:
        # A required scope resolves to exactly one of (scope, None) / (None, rejection).
        return scope_from_request(event, scope_params, table, required=True)

    return scope_decorator(keywords_table, resolve)


# ---------------------------------------------------------------------------
# Keyword fan-outs that honour the time budget
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ScopeRead[ValueT]:
    """What a scoped fan-out read: each keyword's value, in scope order, and the keywords the time budget left unread."""

    values: dict[str, ValueT]
    skipped: tuple[str, ...]

    @property
    def keywords(self) -> list[str]:
        """The keywords read, in scope order."""
        return list(self.values)


def read_scope_keywords[ValueT](
    keywords: Sequence[str],
    compute: Callable[[str], ValueT],
    fallback: Callable[[str], ValueT],
) -> ScopeRead[ValueT]:
    """``compute(keyword)`` for every keyword in parallel (``map_scope_keywords``), split into read and unread.

    A keyword whose ``compute`` fails gets ``fallback(keyword)`` and counts as
    read (it has no data), unless the time budget is spent: a keyword the
    budget stopped is ``skipped``, so the answer can leave it out and say so.
    """
    deadline = current_deadline()
    results = map_scope_keywords(keywords, compute, lambda keyword: None if deadline.cut else fallback(keyword))
    return ScopeRead(
        values={keyword: value for keyword, value in zip(keywords, results, strict=True) if value is not None},
        skipped=tuple(keyword for keyword, value in zip(keywords, results, strict=True) if value is None),
    )


# ---------------------------------------------------------------------------
# Windowed reads
# ---------------------------------------------------------------------------

#: Heap, in KiB, one deserialized projected row and its ``Answer`` hold at the
#: largest shape stored (10 brands, each with a ~150-character sentiment quote
#: and reason, 15 citations): 16.7 KiB measured with tracemalloc; 6-9 KiB for
#: rows of 2-4 brands.
ROW_HEAP_KIB = 17

#: Memory, in MB, a container uses before it reads a window (runtime, boto3, the layer's modules).
BASELINE_MEMORY_MB = 160

#: The share of the memory left after ``BASELINE_MEMORY_MB`` that window rows may hold;
#: the page being parsed and the view built from the rows need the rest. At 0.5 a
#: full cap peaks near 55% of the function's memory (710 MB of the windowed
#: readers' 1,280), under the 60% a function may use; the cap scales with
#: memory, so raising memory never helps.
WINDOW_MEMORY_SHARE = 0.5

#: The memory, in MB, assumed outside Lambda (tests, scripts): the smallest API function size.
DEFAULT_MEMORY_MB = 512

#: Bounds of ``window_rows_cap``: a few runs of a large scope, and the old size-only cap.
MIN_WINDOW_ROWS = 5_000
MAX_WINDOW_ROWS = 120_000


def window_rows_cap(memory_mb: int) -> int:
    """The SearchResults rows one windowed report reads at most in a container of ``memory_mb`` MB.

    The cap bounds memory (``ROW_HEAP_KIB`` per row, worst shape): about
    10,601 rows at 512 MB, 33,731 at 1,280 MB (the windowed readers' size). Time is bounded separately,
    by ``window_read_deadline``.
    """
    free_kib = max(0, memory_mb - BASELINE_MEMORY_MB) * 1024 * WINDOW_MEMORY_SHARE
    return max(MIN_WINDOW_ROWS, min(MAX_WINDOW_ROWS, int(free_kib // ROW_HEAP_KIB)))


def _function_memory_mb() -> int:
    """The memory Lambda gives this function (``AWS_LAMBDA_FUNCTION_MEMORY_SIZE``), ``DEFAULT_MEMORY_MB`` outside it."""
    value = os.environ.get('AWS_LAMBDA_FUNCTION_MEMORY_SIZE', '')
    return int(value) if value.isdigit() else DEFAULT_MEMORY_MB


#: SearchResults rows one windowed report reads at most, over all its keywords (``window_rows_cap``).
WINDOW_ROWS_CAP = window_rows_cap(_function_memory_mb())

#: The share of the request's remaining time budget a window read may spend.
#: Building the view costs about 0.4 of the read (measured: deserializing and
#: ``answers_from_rows`` run ~2.6x slower than ``trend_view`` per row), so
#: 0.6 of the budget for the read leaves the view and the response its time.
WINDOW_READ_SHARE = 0.6


def rows_per_keyword(keyword_count: int, cap: int | None = None) -> int:
    """The rows each of ``keyword_count`` keywords may read so that together they read at most ``cap`` (default ``WINDOW_ROWS_CAP``)."""
    total = WINDOW_ROWS_CAP if cap is None else cap
    return max(1, total // max(1, keyword_count))


def window_read_deadline() -> Deadline:
    """The deadline of one window read: ``WINDOW_READ_SHARE`` of what the request has left."""
    return Deadline(current_deadline().remaining() * WINDOW_READ_SHARE)


@dataclass(frozen=True)
class WindowRuns:
    """Each keyword's run tallies of a window (``shared.kpi_tally``), oldest first, cut at one run timestamp shared by every keyword read."""

    runs: dict[str, list[RunTally]]
    truncated_before: str | None
    """``None`` when the window was read whole; else the run timestamp at and before which no run was kept."""
    skipped: tuple[str, ...] = ()
    """Keywords the time budget left unread: they have no entry in ``runs``."""

    def read_keywords(self, keywords: Sequence[str]) -> list[str]:
        """``keywords`` without the ones left unread, in order."""
        return [keyword for keyword in keywords if keyword in self.runs]


class _KeywordWindow(NamedTuple):
    runs: list[RunTally]
    cut: str | None


@dataclass(frozen=True)
class _WindowRead:
    """What one keyword's window read is asked for."""

    table: Any
    rollups: Any | None
    since: str
    until: str | None
    limit: int
    owned_domains: list[str]
    brands: bool
    several: bool
    budget: Deadline
    brand_rows: Any | None = None
    """KeywordRunBrands: the complete brands of the runs whose rollup kept only ``BRANDS_PER_RUN``."""

    @property
    def fingerprint(self) -> str:
        return owned_fingerprint(self.owned_domains)


def _latest_cut(*cuts: str | None) -> str | None:
    return max((cut for cut in cuts if cut is not None), default=None)


def _rebuilt_runs(request: _WindowRead, keyword: str, timestamps: list[str]) -> tuple[list[RunTally], str | None]:
    """The runs whose rollup counted other owned domains, re-tallied from their rows, newest first until the budget stops.

    The second value is the run the budget stopped at (it and older runs are dropped), or ``None``.
    """
    rebuilt: list[RunTally] = []
    for timestamp in sorted(timestamps, reverse=True):
        if request.budget.stop_reading('a stale keyword rollup'):
            return rebuilt, timestamp
        rows = query_keyword_run_rows(request.table, keyword, timestamp)
        rebuilt.append(run_tally(keyword, timestamp, answers_from_rows(rows), request.owned_domains))
    return rebuilt, None


def _with_complete_brands(request: _WindowRead, keyword: str, runs: list[RunTally]) -> list[RunTally]:
    """``runs`` (rollups) with every brand where their row kept only ``BRANDS_PER_RUN`` (read from KeywordRunBrands)."""
    if not request.brands or request.brand_rows is None or not any(run.brands_total > len(run.brands) for run in runs):
        return runs
    complete = query_run_brands(request.brand_rows, keyword, request.since, request.until)
    return [with_all_brands(run, complete) for run in runs]


def _read_keyword_window(request: _WindowRead, keyword: str) -> _KeywordWindow | None:
    """``keyword``'s runs of the window: rollup rows first, its raw rows for the runs older than its first rollup.

    ``None`` when the keyword is not started, or (one of several) stopped inside its window.
    """
    if request.budget.stop_reading('a windowed report'):
        return None
    stored = StoredRuns([]) if request.rollups is None else query_stored_runs(
        request.rollups, keyword, request.since, until=request.until, brands=request.brands, deadline=request.budget,
    )
    if stored.cut is not None and request.several:
        return None
    fingerprint = request.fingerprint
    current = _with_complete_brands(request, keyword, [run for run in stored.runs if run.matches_owned(fingerprint)])
    rebuilt, rebuilt_cut = _rebuilt_runs(request, keyword, [run.timestamp for run in stored.runs if run.answers and not run.matches_owned(fingerprint)])
    raw: list[RunTally] = []
    raw_cut = None
    if stored.cut is None:
        oldest = stored.runs[0].timestamp if stored.runs else None
        capped = query_keyword_rows_capped(
            request.table, keyword, request.since, request.limit, until=request.until, before=oldest, deadline=request.budget,
        )
        if capped.stopped and request.several:
            return None
        raw, raw_cut = run_tallies(keyword, answers_from_rows(capped.rows), request.owned_domains), capped.cut
    cut = _latest_cut(stored.cut, rebuilt_cut, raw_cut)
    runs = sorted((run for run in (*raw, *current, *rebuilt) if run.answers and (cut is None or run.timestamp > cut)), key=lambda run: run.timestamp)
    return _KeywordWindow(runs, cut)


def load_window_runs(
    table: Any,
    keywords: list[str],
    since: str,
    owned_domains: Iterable[str] = (),
    *,
    rollups: Any | None = None,
    until: str | None = None,
    max_rows: int | None = None,
    brands: bool = True,
    brand_rows: Any | None = None,
) -> WindowRuns:
    """Each keyword's run tallies from ``since`` on (through the run ``until``), read in parallel and bounded.

    A keyword's runs come from its ``rollups`` rows (``shared.keyword_run_kpis``,
    one per run) where they exist: from its oldest rollup in the window on,
    its runs are read as rollups, and only older runs (before rollups were
    written or backfilled) are read from its SearchResults rows in ``table``.
    A rollup counted against other owned domains than ``owned_domains`` is
    re-tallied from that run's rows. ``brands`` False leaves the brand counts
    unread. Without ``rollups`` every run is read raw (2.42.0). With
    ``brand_rows`` (KeywordRunBrands) a rollup that kept only
    ``BRANDS_PER_RUN`` brands gets every brand of its run (2.45.0: complete
    brand leaderboards).

    The raw part reads at most ``max_rows`` rows a keyword (default
    ``rows_per_keyword``), newest first. When a keyword's read is cut, every
    keyword is cut at the latest of those cuts, so the runs kept are every run
    after ``truncated_before``: a shorter window, never a window with holes.
    A keyword whose read fails has no runs (logged by ``map_scope_keywords``).

    The read stops at ``window_read_deadline``. A keyword not started by then,
    or (when there are several) stopped inside its window, is ``skipped``
    rather than shortening every other keyword's window; a single keyword
    keeps the newest runs it read, with ``truncated_before`` where it stopped.
    """
    request = _WindowRead(
        table=table,
        rollups=rollups,
        since=since,
        until=until,
        limit=max_rows if max_rows is not None else rows_per_keyword(len(keywords)),
        owned_domains=list(owned_domains),
        brands=brands,
        several=len(keywords) > 1,
        budget=window_read_deadline(),
        brand_rows=brand_rows,
    )

    def unread_or_empty(_keyword: str) -> _KeywordWindow | None:
        return None if request.budget.cut or request.budget.expired() else _KeywordWindow([], None)

    results = dict(zip(keywords, map_scope_keywords(keywords, lambda keyword: _read_keyword_window(request, keyword), unread_or_empty), strict=True))
    if request.budget.cut:
        current_deadline().cut = True
    windows = {keyword: window for keyword, window in results.items() if window is not None}
    cut = _latest_cut(*(window.cut for window in windows.values()))
    return WindowRuns(
        runs={
            keyword: window.runs if cut is None else [run for run in window.runs if run.timestamp > cut]
            for keyword, window in windows.items()
        },
        truncated_before=cut,
        skipped=tuple(keyword for keyword, window in results.items() if window is None),
    )


def window_histories(
    table: Any, keywords: list[str], since: str, owned_domains: list[str], *, rollups: Any | None = None,
) -> tuple[list[dict[str, Any]], WindowRuns]:
    """Each read keyword's runs from ``since`` on with their KPIs (``keyword_run_histories``), and the window read."""
    window = load_window_runs(table, keywords, since, owned_domains, rollups=rollups, brands=False)
    return keyword_run_histories(window.read_keywords(keywords), window.runs, owned_domains), window


def load_window_histories(
    table: Any, keywords: list[str], since: str, owned_domains: list[str], *, rollups: Any | None = None,
) -> tuple[list[dict[str, Any]], str | None]:
    """Each keyword's runs from ``since`` on with their KPIs (``keyword_run_histories``), and ``truncated_before``.

    Read by ``load_window_runs``, so ``/reports/insights`` and the
    report-insights Lambda stop at the same run when the window holds more
    rows than one report reads.
    """
    histories, window = window_histories(table, keywords, since, owned_domains, rollups=rollups)
    return histories, window.truncated_before
