"""
Wiring shared by the report handlers whose scope is required.

``/visibility``, ``/visibility/sentiment-examples``, ``/brand-mentions`` and
``/reports/group-kpis`` answer 400 without exactly one scope parameter, then
read at most ``SCOPE_KEYWORDS_CAP`` of the scope's keywords and echo the scope
next to whether the cap cut it short. ``required_report_scope`` and
``capped_scope`` are those two steps; scope parsing itself lives in
``shared.scope_params``. ``TREND_WINDOW_PARAMS`` are the ``period`` / ``days``
rules ``/trends`` and ``/reports/overview`` share. ``load_window_answers`` is
the bounded windowed read behind ``/trends``, ``/reports/overview``,
``/reports/group-kpis`` and the stability facts of ``/reports/insights``.

Every read here honours the request's time budget (``shared.request_deadline``):
a keyword the budget leaves unread is left out of the answer and named in
``skipped``, and ``scope_read_fields`` turns that into ``keywords_truncated``.
"""

from __future__ import annotations

import functools
import os
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any, NamedTuple

from shared.answer_queries import query_keyword_rows_capped
from shared.group_kpi_history import keyword_run_histories
from shared.kpi_engine import Answer, answers_from_rows
from shared.request_deadline import Deadline, current_deadline
from shared.scope_params import (
    MARKET_PARAM,
    SCOPE_KEYWORDS_CAP,
    SCOPE_PARAMS,
    ReportScope,
    map_scope_keywords,
    scope_from_request,
    scope_keywords_from_request,
)
from shared.visibility_views import PERIODS

TREND_WINDOW_PARAMS: dict[str, dict[str, Any]] = {
    'period': {'type': str, 'choices': list(PERIODS), 'default': 'day'},
    'days': {'type': int, 'min': 1, 'max': 365, 'default': 30},
}
"""``@validate`` rules for a trend window: the bucket ``period`` and the last ``days`` days (1-365, default 30)."""


Decorator = Callable[[Callable[..., dict[str, Any]]], Callable[..., dict[str, Any] | None]]
"""A scope decorator: wraps ``handler(event, context, <scope>, **params)`` into ``(event, context, **params)``."""


def _scope_decorator(
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

    return _scope_decorator(keywords_table, resolve)


def optional_scope_keywords(keywords_table: Callable[[], Any]) -> Decorator:
    """Resolve an *optional* scope into the keyword texts a handler analyses.

    The counterpart of ``required_report_scope`` for Action Center and Prompt
    Insights, which have a default when no scope is given. Place it under
    ``@validate({**SCOPE_QUERY_PARAMS, ...})``; the handler receives
    ``(event, context, keywords, **other_params)`` where ``keywords`` is ``None``
    without a scope and the scope's active keyword texts with one. A malformed
    scope, or one resolving to no active keyword, is answered with the 400 of
    ``scope_keywords_from_request`` without calling the handler.
    """
    return _scope_decorator(keywords_table, scope_keywords_from_request)


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


def scope_read_fields(scope_fields: dict[str, Any], skipped: Sequence[str]) -> dict[str, Any]:
    """``capped_scope``'s fields with ``keywords_truncated`` also set when the time budget left keywords unread."""
    return {**scope_fields, 'keywords_truncated': bool(scope_fields.get('keywords_truncated')) or bool(skipped)}


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
#: the page being parsed and the view built from the rows need the rest.
WINDOW_MEMORY_SHARE = 0.75

#: The memory, in MB, assumed outside Lambda (tests, scripts): the smallest API function size.
DEFAULT_MEMORY_MB = 512

#: Bounds of ``window_rows_cap``: a few runs of a large scope, and the old size-only cap.
MIN_WINDOW_ROWS = 5_000
MAX_WINDOW_ROWS = 120_000


def window_rows_cap(memory_mb: int) -> int:
    """The SearchResults rows one windowed report reads at most in a container of ``memory_mb`` MB.

    The cap bounds memory (``ROW_HEAP_KIB`` per row, worst shape): about
    15,902 rows at 512 MB, 72,688 at 1,769 MB. Time is bounded separately,
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
class WindowAnswers:
    """Each keyword's answers of a window, cut at one run timestamp shared by every keyword read."""

    answers: dict[str, list[Answer]]
    truncated_before: str | None
    """``None`` when the window was read whole; else the run timestamp at and before which no answer was kept."""
    skipped: tuple[str, ...] = ()
    """Keywords the time budget left unread: they have no entry in ``answers``."""

    def read_keywords(self, keywords: Sequence[str]) -> list[str]:
        """``keywords`` without the ones left unread, in order."""
        return [keyword for keyword in keywords if keyword in self.answers]


class _KeywordWindow(NamedTuple):
    answers: list[Answer]
    cut: str | None


def load_window_answers(
    table: Any,
    keywords: list[str],
    since: str,
    *,
    until: str | None = None,
    max_rows: int | None = None,
) -> WindowAnswers:
    """Each keyword's answers from ``since`` on (through the run ``until``), read in parallel and bounded.

    Each keyword reads at most ``max_rows`` rows (default ``rows_per_keyword``),
    newest first. When a keyword's cap cuts its window, every keyword is cut at
    the latest of those cuts, so the answers kept are every answer of the runs
    after ``truncated_before``: a shorter window, never a window with holes.
    A keyword whose read fails has no answers (logged by ``map_scope_keywords``).

    The read stops at ``window_read_deadline``. A keyword not started by then,
    or (when there are several) stopped inside its window, is ``skipped``
    rather than shortening every other keyword's window; a single keyword
    keeps the newest runs it read, with ``truncated_before`` where it stopped.
    """
    limit = max_rows if max_rows is not None else rows_per_keyword(len(keywords))
    budget = window_read_deadline()
    several = len(keywords) > 1

    def read(keyword: str) -> _KeywordWindow | None:
        if budget.stop_reading('a windowed report'):
            return None
        capped = query_keyword_rows_capped(table, keyword, since, limit, until=until, deadline=budget)
        if capped.stopped and several:
            return None
        return _KeywordWindow(answers_from_rows(capped.rows), capped.cut)

    def unread_or_empty(_keyword: str) -> _KeywordWindow | None:
        return None if budget.cut or budget.expired() else _KeywordWindow([], None)

    results = dict(zip(keywords, map_scope_keywords(keywords, read, unread_or_empty), strict=True))
    if budget.cut:
        current_deadline().cut = True
    windows = {keyword: window for keyword, window in results.items() if window is not None}
    cut = max((window.cut for window in windows.values() if window.cut is not None), default=None)
    return WindowAnswers(
        answers={
            keyword: window.answers if cut is None else [answer for answer in window.answers if answer.timestamp > cut]
            for keyword, window in windows.items()
        },
        truncated_before=cut,
        skipped=tuple(keyword for keyword, window in results.items() if window is None),
    )


def window_histories(
    table: Any, keywords: list[str], since: str, owned_domains: list[str],
) -> tuple[list[dict[str, Any]], WindowAnswers]:
    """Each read keyword's runs from ``since`` on with their KPIs (``keyword_run_histories``), and the window read."""
    window = load_window_answers(table, keywords, since)
    return keyword_run_histories(window.read_keywords(keywords), window.answers, owned_domains), window


def load_window_histories(
    table: Any, keywords: list[str], since: str, owned_domains: list[str],
) -> tuple[list[dict[str, Any]], str | None]:
    """Each keyword's runs from ``since`` on with their KPIs (``keyword_run_histories``), and ``truncated_before``.

    Read by ``load_window_answers``, so ``/reports/insights`` and the
    report-insights Lambda stop at the same run when the window holds more
    rows than one report reads.
    """
    histories, window = window_histories(table, keywords, since, owned_domains)
    return histories, window.truncated_before


def capped_scope(scope: ReportScope, cap: int = SCOPE_KEYWORDS_CAP) -> tuple[list[str], dict[str, Any]]:
    """The first ``cap`` keywords of ``scope`` and the response fields that describe them.

    The fields are ``scope`` (``ReportScope.describe()``) and
    ``keywords_truncated`` (whether ``scope`` has more keywords than were kept).
    """
    keywords = list(scope.keywords)[:cap]
    return keywords, {'scope': scope.describe(), 'keywords_truncated': len(scope.keywords) > len(keywords)}
