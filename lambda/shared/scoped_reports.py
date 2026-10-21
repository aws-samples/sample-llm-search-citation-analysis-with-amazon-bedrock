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
"""

from __future__ import annotations

import functools
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from shared.answer_queries import query_keyword_rows_capped
from shared.group_kpi_history import keyword_run_histories
from shared.kpi_engine import Answer, answers_from_rows
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


#: SearchResults rows one windowed report reads at most, over all its keywords.
#: About 8 s of reads and parsing at ~2 KB a projected row; the 30-day trend of
#: 100 keywords at 24 answers a day is 72,000 rows.
WINDOW_ROWS_CAP = 120_000

#: The least rows a keyword is read, however many keywords share the cap: a few runs of every engine and persona.
MIN_ROWS_PER_KEYWORD = 1_000


def rows_per_keyword(keyword_count: int, cap: int = WINDOW_ROWS_CAP) -> int:
    """The rows each of ``keyword_count`` keywords may read so that together they stay near ``cap``."""
    return max(MIN_ROWS_PER_KEYWORD, cap // max(1, keyword_count))


@dataclass(frozen=True)
class WindowAnswers:
    """Each keyword's answers of a window, cut at one run timestamp shared by every keyword."""

    answers: dict[str, list[Answer]]
    truncated_before: str | None
    """``None`` when the window was read whole; else the run timestamp at and before which no answer was kept."""


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
    """
    limit = max_rows if max_rows is not None else rows_per_keyword(len(keywords))

    def read(keyword: str) -> tuple[list[Answer], str | None]:
        capped = query_keyword_rows_capped(table, keyword, since, limit, until=until)
        return answers_from_rows(capped.rows), capped.cut

    results = map_scope_keywords(keywords, read, lambda _keyword: ([], None))
    cut = max((keyword_cut for _answers, keyword_cut in results if keyword_cut is not None), default=None)
    return WindowAnswers(
        answers={
            keyword: answers if cut is None else [answer for answer in answers if answer.timestamp > cut]
            for keyword, (answers, _cut) in zip(keywords, results, strict=True)
        },
        truncated_before=cut,
    )


def load_window_histories(
    table: Any, keywords: list[str], since: str, owned_domains: list[str],
) -> tuple[list[dict[str, Any]], str | None]:
    """Each keyword's runs from ``since`` on with their KPIs (``keyword_run_histories``), and ``truncated_before``.

    Read by ``load_window_answers``, so ``/reports/insights`` and the
    report-insights Lambda stop at the same run when the window holds more
    rows than one report reads.
    """
    window = load_window_answers(table, keywords, since)
    return keyword_run_histories(keywords, window.answers, owned_domains), window.truncated_before


def capped_scope(scope: ReportScope, cap: int = SCOPE_KEYWORDS_CAP) -> tuple[list[str], dict[str, Any]]:
    """The first ``cap`` keywords of ``scope`` and the response fields that describe them.

    The fields are ``scope`` (``ReportScope.describe()``) and
    ``keywords_truncated`` (whether ``scope`` has more keywords than were kept).
    """
    keywords = list(scope.keywords)[:cap]
    return keywords, {'scope': scope.describe(), 'keywords_truncated': len(scope.keywords) > len(keywords)}
