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
- ``drivers``: the keywords that drove each compared group run after the group
  run ``from_run`` (default: the window's start) through the run ``to_run``
  (default: the latest), within the page budget, ``next_token`` for the rest.
  Reads only that slice of the window, so a client asks for one run's drivers
  with ``from_run`` = its ``change.previous_timestamp`` and ``to_run`` = its timestamp.

Every view reads at most ``WINDOW_ROWS_CAP`` rows, newest first
(``shared.scoped_reports.load_window_answers``); a window the cap shortened
reports the run it stopped at in ``truncated_before`` (``null`` otherwise).
"""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from shared.answer_queries import history_since
from shared.api_response import success_response, validation_error
from shared.constants import MAX_KEYWORD_LENGTH
from shared.cursors import (
    CURSOR_ERROR_MESSAGE,
    CURSOR_QUERY_PARAM,
    decode_cursor,
    decode_offset_cursor,
    encode_cursor,
    encode_offset_cursor,
)
from shared.decorators import api_handler, optional_limit, validate
from shared.group_kpi_history import (
    GROUP_RUN_MIN_COVERAGE,
    group_kpi_history_from_answers,
    keyword_run_histories,
    keyword_summary,
    run_drivers,
    summary_run,
)
from shared.kpi_engine import owned_domains_from
from shared.response_budget import PAGE_BUDGET_BYTES, json_bytes, take_within_budget
from shared.scope_params import SCOPE_QUERY_PARAMS, keywords_table_name, scoped_dynamodb_resource
from shared.scoped_reports import capped_scope, load_window_answers, required_report_scope, rows_per_keyword
from shared.search_results import search_results_table_name
from shared.utils import get_brand_config

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# One Query per keyword, SCOPE_MAX_WORKERS at a time, over at most
# SCOPE_KEYWORDS_CAP keywords (the /visibility group bounds).
dynamodb = scoped_dynamodb_resource()
SEARCH_RESULTS_TABLE = search_results_table_name()
KEYWORDS_TABLE = keywords_table_name()

VIEWS = ('summary', 'keywords', 'drivers')

#: Keywords one ``view=keywords`` page reads by default, and at most.
KEYWORDS_PAGE_DEFAULT = 10
KEYWORDS_PAGE_MAX = 25

#: A run timestamp parameter (``from_run`` / ``to_run``).
RUN_PARAM: dict[str, Any] = {'type': str, 'max_length': 64}

#: The keys of a ``view=drivers`` cursor: the group run the next page compares from, and the slice's end.
DRIVERS_CURSOR_KEYS = ('from_run', 'to_run')


@dataclass(frozen=True)
class ViewRequest:
    """What every view reads: the request, the scope's (capped) keywords and the window."""

    event: dict[str, Any]
    keywords: list[str]
    since: str
    owned_domains: list[str]
    params: dict[str, Any]


ViewResult = tuple[dict[str, Any] | None, dict[str, Any] | None]
"""``(fields, None)`` to answer the view's fields, ``(None, response)`` to answer that 400 instead."""


def search_table() -> Any:
    return dynamodb.Table(SEARCH_RESULTS_TABLE)


def newest_within_budget(runs: list[dict[str, Any]], max_bytes: int = PAGE_BUDGET_BYTES) -> tuple[list[dict[str, Any]], bool]:
    """The newest of ``runs`` (oldest first) that fit ``max_bytes``, still oldest first, and whether older ones were left out."""
    kept, truncated = take_within_budget(runs[::-1], max_bytes)
    return kept[::-1], truncated


def bounded_keyword_history(entry: dict[str, Any]) -> dict[str, Any]:
    """A keyword's drill-down holding its newest runs within the page budget (``runs_truncated`` when older ones were left out)."""
    runs, truncated = newest_within_budget(entry['runs'])
    return {'keyword': entry['keyword'], 'runs': runs, 'runs_truncated': truncated}


def summary_view(request: ViewRequest) -> ViewResult:
    """Every run of the window and each keyword's latest run, with no per-keyword runs and no drivers."""
    window = load_window_answers(search_table(), request.keywords, request.since)
    history = group_kpi_history_from_answers(request.keywords, window.answers, request.owned_domains)
    keywords = [keyword_summary(entry) for entry in history['keywords']]
    budget = max(PAGE_BUDGET_BYTES // 2, PAGE_BUDGET_BYTES - json_bytes(keywords))
    runs, runs_truncated = newest_within_budget([summary_run(run) for run in history['runs']], budget)
    return {
        'runs': runs,
        'runs_truncated': runs_truncated,
        'keywords': keywords,
        'truncated_before': window.truncated_before,
    }, None


def _keyword_page(request: ViewRequest) -> tuple[list[str], int, dict[str, Any] | None]:
    """The keywords this page reads and its offset, or the 400 a bad ``detail_keyword`` / ``next_token`` gets."""
    event, params = request.event, request.params
    detail = params.get('detail_keyword')
    if detail is not None:
        if detail not in request.keywords:
            return [], 0, validation_error('detail_keyword is not a keyword of the selected scope.', event, 'detail_keyword')
        return [detail], 0, None
    offset = decode_offset_cursor(params.get('next_token'))
    if offset is None:
        return [], 0, validation_error(CURSOR_ERROR_MESSAGE, event, 'next_token')
    return request.keywords[offset:offset + params['limit']], offset, None


def keywords_view(request: ViewRequest) -> ViewResult:
    """One page of keyword drill-downs, reading only the page's keywords."""
    page_keywords, offset, rejected = _keyword_page(request)
    if rejected is not None:
        return None, rejected
    # Each keyword reads what it would in the summary, so a page agrees with it.
    window = load_window_answers(
        search_table(), page_keywords, request.since, max_rows=rows_per_keyword(len(request.keywords)),
    )
    histories = [bounded_keyword_history(entry) for entry in keyword_run_histories(page_keywords, window.answers, request.owned_domains)]
    page, _ = take_within_budget(histories)
    single = request.params.get('detail_keyword') is not None
    return {
        'keywords': page,
        'next_token': None if single else encode_offset_cursor(offset + len(page), len(request.keywords)),
        'truncated_before': window.truncated_before,
    }, None


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


def drivers_view(request: ViewRequest) -> ViewResult:
    """The drivers of the compared group runs after ``from_run`` through ``to_run``, reading only that slice.

    ``from_run`` must be a group run: it is read as the base the slice's first
    group run is compared with, so its drivers equal the summary's.
    """
    from_run, to_run, rejected = _drivers_range(request)
    if rejected is not None:
        return None, rejected
    window = load_window_answers(search_table(), request.keywords, from_run or request.since, until=to_run)
    history = group_kpi_history_from_answers(request.keywords, window.answers, request.owned_domains)
    changes = [change for change in run_drivers(history['runs']) if from_run is None or change['timestamp'] > from_run]
    page, truncated = take_within_budget(changes)
    return {
        'from_run': from_run,
        'to_run': to_run,
        'changes': page,
        'next_token': encode_cursor({'from_run': page[-1]['timestamp'], 'to_run': to_run}) if truncated else None,
        'truncated_before': window.truncated_before,
    }, None


VIEW_BUILDERS: dict[str, Callable[[ViewRequest], ViewResult]] = {
    'summary': summary_view,
    'keywords': keywords_view,
    'drivers': drivers_view,
}


@api_handler
@validate({
    **SCOPE_QUERY_PARAMS,
    'days': {'type': int, 'min': 1, 'max': 365, 'default': 90},
    'view': {'type': str, 'choices': list(VIEWS), 'default': 'summary'},
    'detail_keyword': {'type': str, 'max_length': MAX_KEYWORD_LENGTH},
    'from_run': RUN_PARAM,
    'to_run': RUN_PARAM,
    'limit': optional_limit(default=KEYWORDS_PAGE_DEFAULT, max_val=KEYWORDS_PAGE_MAX),
    **CURSOR_QUERY_PARAM,
})
@required_report_scope(lambda: dynamodb.Table(KEYWORDS_TABLE))
def handler(event, context, report_scope, *, days, view='summary', **params):
    """GET /api/reports/group-kpis - per-run KPI history of a keyword group, one ``view`` at a time (see the module docstring)."""
    keywords, scope_fields = capped_scope(report_scope)
    since = history_since(days)
    owned_domains = owned_domains_from(get_brand_config())
    fields, rejected = VIEW_BUILDERS[view](ViewRequest(event, keywords, since, owned_domains, params))
    if rejected is not None:
        return rejected
    return success_response({
        **scope_fields,
        'view': view,
        'days': days,
        'since': since,
        'group_run_min_coverage': GROUP_RUN_MIN_COVERAGE,
        'citations_configured': bool(owned_domains),
        **(fields or {}),
    }, event)
