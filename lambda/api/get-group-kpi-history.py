"""
Group KPI History API — GET /api/reports/group-kpis

The per-hotel report: every analysis run of a keyword group within the last
``days`` days with its KPIs (``docs/kpi-definitions.md``), the keywords that
drove each change, and a per-keyword drill-down of every run. Run semantics
live in ``shared.group_kpi_history``; the citation KPIs use the owned domains
of the brand configuration.

Query params: exactly one scope (``group_id``, ``keyword_ids``, ``scope=all``
or ``keyword``), ``days`` (1-365, default 90) and ``view``:

- ``summary`` (default): every run with its KPIs, models, coverage and change
  (deltas, trends, keywords entered and left, ``drivers_count``), and each
  keyword's ``runs_count`` and ``latest`` run. It grows with the runs only and
  keeps the newest that fit the page budget (``runs_truncated``).
- ``keywords``: each keyword's runs (the drill-down), ``limit`` keywords a page
  (default 10, at most 25) within the page budget, ``next_token`` for the next
  page; ``detail_keyword`` answers that one keyword. Reads only the page's keywords.
- ``runs``: every run of the window, oldest first, within the page budget,
  ``next_token`` for the next page (2.45.0 wave 5; the summary keeps the
  newest that fit, ``runs_total`` counts them all).
- ``drivers``: the keywords that drove each compared group run after the group
  run ``from_run`` (default: the window's start) through the run ``to_run``
  (default: the latest), within the page budget, ``next_token`` for the rest.
  Reads only that slice of the window, so a client asks for one run's drivers
  with ``from_run`` = its ``change.previous_timestamp`` and ``to_run`` = its timestamp.

Complete for every scope (2.45.0, no keyword cap). The summary and the
drivers of a scope within the window budget (``shared.kpi_scope_serve.kpi_window_route``,
100 keywords) are read for the request; a larger scope's come from its scope
snapshot's preset (``shared.artifact_group_kpis``, ``days`` in ``PRESET_DAYS``,
as of the build), or a view job answers 202 (any other ``days``, or a preset
the build does not hold). From a snapshot the summary holds the first
``SUMMARY_KEYWORDS_PAGE`` keyword rows (``keywords_total``,
``keywords_next_token``; ``view=keywords`` with that token answers the next
page of them). The drill-down (``view=keywords`` without a snapshot token)
always reads only its page's keywords, whatever the scope's size: its
``next_token`` is a keyword cursor (``{k, r, f}``) bound to the scope's
keywords, ``cursor_expired`` once they change. Every body carries the scope
contract (``coverage``, ``source``, ``as_of``, ``stale``, ``refreshing``).

Live reads: each keyword's per-run KPI rollups (``shared.keyword_run_kpis``)
and, for its runs older than its first rollup, at most ``WINDOW_ROWS_CAP``
SearchResults rows, newest first, within the request's time budget
(``shared.scoped_reports.load_window_runs``); a window the cap or the budget
shortened reports the run it stopped at in ``truncated_before`` (``null``
otherwise). Keywords the budget left unread are left out:
``keywords_truncated`` (and ``coverage.complete`` false) say so (summary,
drivers), and a drill-down page stops before the first of them
(``truncated``, ``next_token`` resumes there).
"""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from itertools import takewhile
from typing import Any

from shared.answer_queries import history_since
from shared.api_response import success_response, validation_error
from shared.artifact_group_kpis import NAME as GROUP_KPIS_BUILDER
from shared.artifact_group_kpis import drivers_page, newest_within_budget, runs_page, summary_fields, window_summary
from shared.citation_rollup import keyword_fingerprint
from shared.constants import MAX_KEYWORD_LENGTH
from shared.cursors import CURSOR_ERROR_MESSAGE, decode_cursor
from shared.decorators import api_handler, optional_limit, validate
from shared.group_kpi_history import GROUP_RUN_MIN_COVERAGE, keyword_run_histories
from shared.keyword_run_kpis import keyword_run_kpis_table
from shared.kpi_engine import owned_domains_from
from shared.kpi_scope_serve import (
    ScopedAnswer,
    SnapshotRequest,
    answer_scoped,
    kpi_window_route,
    scoped_body,
    view_query_params,
)
from shared.response_budget import take_within_budget
from shared.scope_params import SCOPE_QUERY_PARAMS, ReportScope, keywords_table_name, scoped_dynamodb_resource
from shared.scoped_reports import WindowRuns, load_window_runs, required_report_scope, rows_per_keyword
from shared.search_results import search_results_table_name
from shared.snapshot_artifacts import KeywordCursor, decode_snapshot_cursor, encode_keyword_cursor, keyword_page_start
from shared.utils import get_brand_config

#: The route's name for view jobs.
ROUTE = 'group-kpis'

VIEWS = ('summary', 'keywords', 'drivers', 'runs')

#: Keywords one drill-down page reads by default, and at most.
KEYWORDS_PAGE_DEFAULT = 10
KEYWORDS_PAGE_MAX = 25

#: A run timestamp parameter (``from_run`` / ``to_run``).
RUN_PARAM: dict[str, Any] = {'type': str, 'max_length': 64}

#: The keys of a ``view=drivers`` cursor: the group run the next page compares from, and the slice's end.
DRIVERS_CURSOR_KEYS = ('from_run', 'to_run')
#: The key of a ``view=runs`` cursor: the run the next page follows.
RUNS_CURSOR_KEYS = ('after',)

# One Query per keyword, SCOPE_MAX_WORKERS at a time.
dynamodb = scoped_dynamodb_resource()
KEYWORDS_TABLE = keywords_table_name()
SEARCH_RESULTS_TABLE = search_results_table_name()

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


@dataclass(frozen=True)
class ViewRequest:
    """What every view reads: the request, the scope and its keywords, and the window."""

    event: dict[str, Any]
    scope: ReportScope
    since: str
    owned_domains: list[str]
    params: dict[str, Any]

    @property
    def keywords(self) -> list[str]:
        return list(self.scope.keywords)


def search_table() -> Any:
    return dynamodb.Table(SEARCH_RESULTS_TABLE)


def load_window(request: ViewRequest, keywords: list[str], since: str, **options: Any) -> WindowRuns:
    """``keywords``' run tallies from ``since`` on (``shared.scoped_reports.load_window_runs``), without brand counts: no view lists brands."""
    return load_window_runs(
        search_table(), keywords, since, request.owned_domains, rollups=keyword_run_kpis_table(dynamodb), brands=False, **options,
    )


def bounded_keyword_history(entry: dict[str, Any]) -> dict[str, Any]:
    """A keyword's drill-down holding its newest runs within the page budget (``runs_truncated`` when older ones were left out)."""
    runs, truncated = newest_within_budget(entry['runs'])
    return {'keyword': entry['keyword'], 'runs': runs, 'runs_truncated': truncated}


def _unread_fields(window: WindowRuns) -> dict[str, Any]:
    """``keywords_truncated: true`` when the time budget left keywords of the window unread (they are left out)."""
    return {'keywords_truncated': True} if window.skipped else {}


def summary_view(request: ViewRequest) -> ScopedAnswer:
    """Every run of the window and each keyword's latest run (every keyword's row), with no per-keyword runs and no drivers."""
    window = load_window(request, request.keywords, request.since)
    read = window.read_keywords(request.keywords)
    summary = window_summary(read, window.runs, request.owned_domains)
    return ScopedAnswer({
        **summary_fields(summary['runs'], summary['keywords']),
        'truncated_before': window.truncated_before,
        'keywords_total': len(summary['keywords']),
        'keywords_next_token': None,
        **_unread_fields(window),
    }, analyzed=len(read))


def _drill_down_page(request: ViewRequest) -> tuple[list[str], int, dict[str, Any] | None]:
    """The keywords this page reads and its offset, or the 400 a bad ``detail_keyword`` / ``next_token`` gets."""
    event, params = request.event, request.params
    detail = params.get('detail_keyword')
    if detail is not None:
        if detail not in request.keywords:
            return [], 0, validation_error('detail_keyword is not a keyword of the selected scope.', event, 'detail_keyword')
        return [detail], 0, None
    cursor, rejected = keyword_page_start(params.get('next_token'), keyword_fingerprint(request.keywords), event)
    if cursor is None:
        return [], 0, rejected
    return request.keywords[cursor.keyword_index:cursor.keyword_index + params['limit']], cursor.keyword_index, None


def keywords_view(request: ViewRequest) -> ScopedAnswer:
    """One page of keyword drill-downs, reading only the page's keywords (O(page) at any scope size).

    A page stops before the first keyword the time budget left unread, and
    ``next_token`` resumes there (``truncated`` says the page is short for that reason).
    """
    page_keywords, offset, rejected = _drill_down_page(request)
    if rejected is not None:
        return ScopedAnswer(response=rejected)
    # Each keyword reads what it would in the summary, so a page agrees with it.
    window = load_window(request, page_keywords, request.since, max_rows=rows_per_keyword(len(request.keywords)))
    readable = list(takewhile(lambda keyword: keyword in window.runs, page_keywords))
    histories = [bounded_keyword_history(entry) for entry in keyword_run_histories(readable, window.runs, request.owned_domains)]
    page, _ = take_within_budget(histories)
    single = request.params.get('detail_keyword') is not None
    resume = KeywordCursor(keyword_index=offset + len(page), row_offset=0, fingerprint=keyword_fingerprint(request.keywords))
    return ScopedAnswer({
        'keywords': page,
        'keywords_total': len(request.keywords),
        'next_token': None if single else encode_keyword_cursor(resume, len(request.keywords)),
        'truncated_before': window.truncated_before,
        'truncated': bool(window.skipped),
    }, analyzed=len(request.keywords))


def _drivers_range(request: ViewRequest) -> tuple[str | None, str | None, dict[str, Any] | None]:
    """``(from_run, to_run)`` from the cursor or the parameters, or the 400 a malformed cursor gets."""
    params = request.params
    token = params.get('next_token')
    if token is None:
        return params.get('from_run'), params.get('to_run'), None
    decoded = decode_cursor(token, DRIVERS_CURSOR_KEYS)
    if decoded is None or not all(value is None or isinstance(value, str) for value in decoded.values()):
        return None, None, validation_error(CURSOR_ERROR_MESSAGE, request.event, 'next_token')
    return decoded['from_run'], decoded['to_run'], None


def drivers_view(request: ViewRequest) -> ScopedAnswer:
    """The drivers of the compared group runs after ``from_run`` through ``to_run``, reading only that slice.

    ``from_run`` must be a group run: it is read as the base the slice's first
    group run is compared with, so its drivers equal the summary's.
    """
    from_run, to_run, rejected = _drivers_range(request)
    if rejected is not None:
        return ScopedAnswer(response=rejected)
    window = load_window(request, request.keywords, from_run or request.since, until=to_run)
    read = window.read_keywords(request.keywords)
    drivers = window_summary(read, window.runs, request.owned_domains)['drivers']
    return ScopedAnswer({
        **drivers_page(drivers, from_run, to_run),
        'truncated_before': window.truncated_before,
        **_unread_fields(window),
    }, analyzed=len(read))


def _runs_after(request: ViewRequest) -> tuple[str | None, dict[str, Any] | None]:
    """The run a ``view=runs`` page follows (``None``: the first page), or the 400 a malformed cursor gets."""
    token = request.params.get('next_token')
    if token is None:
        return None, None
    decoded = decode_cursor(token, RUNS_CURSOR_KEYS)
    if decoded is None or not isinstance(decoded['after'], str):
        return None, validation_error(CURSOR_ERROR_MESSAGE, request.event, 'next_token')
    return decoded['after'], None


def runs_view(request: ViewRequest) -> ScopedAnswer:
    """One page of every run of the window, oldest first (``runs_page``)."""
    after, rejected = _runs_after(request)
    if rejected is not None:
        return ScopedAnswer(response=rejected)
    window = load_window(request, request.keywords, request.since)
    read = window.read_keywords(request.keywords)
    runs = window_summary(read, window.runs, request.owned_domains)['runs']
    return ScopedAnswer({**runs_page(runs, after), 'truncated_before': window.truncated_before, **_unread_fields(window)}, analyzed=len(read))


LIVE_VIEWS: dict[str, Callable[[ViewRequest], ScopedAnswer]] = {
    'summary': summary_view,
    'keywords': keywords_view,
    'drivers': drivers_view,
    'runs': runs_view,
}


def _summary_page_token(view: str, params: dict[str, Any]) -> bool:
    """Whether the request asks for a page of the summary's keyword rows (``view=keywords`` with a snapshot token)."""
    token = params.get('next_token')
    return view == 'keywords' and token is not None and decode_snapshot_cursor(token) is not None


def _answer(request: ViewRequest, view: str, days: int, config: dict[str, Any]) -> ScopedAnswer:
    """The view's answer: the drill-down always live, the others live within the budget, else from the snapshot."""
    summary_page = _summary_page_token(view, request.params)
    if view == 'keywords' and not summary_page:
        result = keywords_view(request)
        return result if result.body is None else ScopedAnswer(scoped_body(result.body, request.scope, result.analyzed), analyzed=result.analyzed)
    from_run, to_run, rejected = _drivers_range(request) if view == 'drivers' else (None, None, None)
    after, runs_rejected = _runs_after(request) if view == 'runs' else (None, None)
    if rejected is not None or runs_rejected is not None:
        return ScopedAnswer(response=rejected or runs_rejected)
    snapshot = SnapshotRequest(
        route=ROUTE, builder=GROUP_KPIS_BUILDER, params={'days': days, 'view': view, 'from_run': from_run, 'to_run': to_run, 'after': after},
        report_scope=request.scope, brand_config_updated_at=config.get('updated_at'), event=request.event,
        next_token=request.params.get('next_token') if summary_page else None, job_params={'days': days},
    )
    return answer_scoped(kpi_window_route(request.scope) == 'live', snapshot, lambda: LIVE_VIEWS[view](request))


@api_handler
@validate({
    **SCOPE_QUERY_PARAMS,
    **view_query_params(VIEWS),
    'days': {'type': int, 'min': 1, 'max': 365, 'default': 90},
    'detail_keyword': {'type': str, 'max_length': MAX_KEYWORD_LENGTH},
    'from_run': RUN_PARAM,
    'to_run': RUN_PARAM,
    'limit': optional_limit(default=KEYWORDS_PAGE_DEFAULT, max_val=KEYWORDS_PAGE_MAX),
})
@required_report_scope(lambda: dynamodb.Table(KEYWORDS_TABLE))
def handler(event, context, scope, *, days, view='summary', **params):
    """GET /api/reports/group-kpis - per-run KPI history of a keyword group, one ``view`` at a time (see the module docstring)."""
    config = get_brand_config()
    owned_domains = owned_domains_from(config)
    since = history_since(days)
    result = _answer(ViewRequest(event, scope, since, owned_domains, params), view, days, config)
    if result.response is not None:
        return result.response
    fields = result.body or {}
    return success_response({
        'scope': scope.describe(),
        'keywords_truncated': False,
        'view': view,
        'days': days,
        'since': since,
        'group_run_min_coverage': GROUP_RUN_MIN_COVERAGE,
        'citations_configured': bool(owned_domains),
        **fields,
    }, event)
