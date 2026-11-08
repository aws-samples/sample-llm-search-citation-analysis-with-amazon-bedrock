"""
Historical Trends API — GET /api/trends

How the brand's KPIs (``docs/kpi-definitions.md``) moved over the last
``days`` days in a scope: one point per day, ISO week or month holding every
answer of the period, the scope's latest standing and its change against the
previous period, and each keyword's own move. Formulas in
``shared.kpi_engine``; views in ``shared.visibility_views``.

Scope: at most one of ``keyword=``, ``group_id=``, ``keyword_ids=`` or
``scope=all``. Without one, every active keyword.

Complete for every scope (2.45.0, no keyword cap): a scope whose window fits
the live budget (``shared.kpi_scope_serve.kpi_window_route``: 100 keywords,
whatever ``days``) is read whole for the
request; a larger one is served from its scope snapshot's preset
(``shared.artifact_trends``: ``PRESET_DAYS`` x ``PERIODS``, as of the build,
``as_of``), or answers 202 while a view job computes it (any other ``days``,
or a preset the build could not make exact). ``keyword_trends`` from a
snapshot holds the first ``KEYWORD_TRENDS_PAGE`` rows (``keyword_trends_total``,
``keyword_trends_next_token``; ``view=keyword_trends`` with ``next_token``
answers the next page); live, every row. The scope contract fields
(``shared.snapshot_artifacts.with_scope_contract``) say where the figures came from.

Full lists (2.45.0 wave 5): ``latest_brands`` lists the first 10 of the
whole latest-period leaderboard (``latest_brands_total``;
``latest_brands_next_token`` and ``view=latest_brands`` page the rest, 100
a page), and ``top_movers`` (``improving`` / ``declining``, 5 each) ranks
every keyword of the scope. ``view=brand_series`` pages every brand of the window
(leaderboard order, 100 a page) with its KPIs in each period naming it (the
export of brands over time). A live read takes every brand of a run from
KeywordRunBrands where its rollup kept only ``BRANDS_PER_RUN``.

Live reads: each keyword's runs from its per-run KPI rollups
(``shared.keyword_run_kpis``), and only its runs older than its first rollup
from SearchResults, at most ``shared.scoped_reports.WINDOW_ROWS_CAP`` rows;
all within the request's time budget. When the cap or the budget stops it,
``truncated_before`` names the run it stopped at and every number covers the
runs after it. Keywords the budget left unread are left out
(``keywords_analyzed`` counts the ones read; ``keywords_truncated`` and
``coverage.complete`` false say so).
"""

import logging
import sys
from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import Any

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.answer_queries import history_since
from shared.api_response import success_response
from shared.artifact_trends import (
    BRAND_SERIES_VIEW,
    KEYWORD_TRENDS_PAGE,
    PAGED_VIEWS,
    TrendsParams,
    trend_answer,
    trend_body,
)
from shared.artifact_trends import NAME as TRENDS_BUILDER
from shared.decorators import api_handler, validate
from shared.keyword_run_brands import keyword_run_brands_table
from shared.keyword_run_kpis import keyword_run_kpis_table
from shared.kpi_engine import owned_domains_from
from shared.kpi_scope_serve import (
    LIVE_BUILD_ID,
    ScopedAnswer,
    SnapshotRequest,
    answer_scoped,
    kpi_window_route,
    live_list_offset,
    view_query_params,
)
from shared.scope_params import (
    SCOPE_QUERY_PARAMS,
    ReportScope,
    all_active_scope,
    keywords_table_name,
    scope_from_request,
    scoped_dynamodb_resource,
)
from shared.scoped_reports import TREND_WINDOW_PARAMS, WindowRuns
from shared.scoped_reports import load_window_runs as load_scoped_window_runs
from shared.search_results import search_results_table_name
from shared.utils import get_brand_config

#: The route's name for view jobs.
ROUTE = 'trends'

VIEWS = ('summary', *PAGED_VIEWS)

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# One windowed read per keyword, SCOPE_MAX_WORKERS at a time (map_scope_keywords).
dynamodb = scoped_dynamodb_resource()

# Fail-fast: Required environment variables
KEYWORDS_TABLE = keywords_table_name()
SEARCH_RESULTS_TABLE = search_results_table_name()


def load_window_runs(keywords: list[str], since: str, owned_domains: list[str]) -> WindowRuns:
    """Each keyword's run tallies from ``since`` on, read in parallel and bounded (``shared.scoped_reports.load_window_runs``)."""
    return load_scoped_window_runs(
        dynamodb.Table(SEARCH_RESULTS_TABLE), keywords, since, owned_domains, rollups=keyword_run_kpis_table(dynamodb),
        brand_rows=keyword_run_brands_table(dynamodb),
    )


def _resolve_scope(scope: ReportScope | None) -> ReportScope:
    """The scope; no scope is every active keyword."""
    return all_active_scope(dynamodb.Table(KEYWORDS_TABLE)) if scope is None else scope


@dataclass(frozen=True)
class TrendsRequest:
    """One trend request: the window, the view and page, and what a snapshot-served one needs."""

    period: str
    days: int
    owned_domains: list[str]
    view: str = 'summary'
    next_token: str | None = None
    offset: int = 0
    """Where a live ``latest_brands`` page starts (from its live token)."""
    page_size: int | None = KEYWORD_TRENDS_PAGE
    """``None``: every ``keyword_trends`` row in the body (``/reports/overview``'s top movers)."""
    route: str = ROUTE
    brand_config_updated_at: str | None = None
    event: dict[str, Any] | None = None


def _framed(scope: ReportScope) -> Callable[[dict[str, Any]], dict[str, Any]]:
    """How a trend body (or one ``PAGED_VIEWS`` page) is framed: with the scope and ``keywords_truncated``."""
    def frame(body: dict[str, Any]) -> dict[str, Any]:
        return {'scope': scope.describe(), 'keywords_truncated': False, **body}

    return frame


def live_trends(scope: ReportScope, request: TrendsRequest) -> ScopedAnswer:
    """The trend body of ``scope`` read whole for this request (every keyword, every ``keyword_trends`` row; ``latest_brands`` paged from ``request.offset``)."""
    keywords = list(scope.keywords)
    since = history_since(request.days)
    window = load_window_runs(keywords, since, request.owned_domains)
    read = window.read_keywords(keywords)
    stored = trend_body(
        read, window.runs, request.period, request.days, since, request.owned_domains, with_brand_series=request.view == BRAND_SERIES_VIEW,
    )
    answer = trend_answer(stored, TrendsParams(request.period, request.days, request.view, request.offset, None), LIVE_BUILD_ID)
    framed = {**_framed(scope)(answer), 'keywords_truncated': bool(window.skipped)}
    if request.view not in PAGED_VIEWS:
        framed.update(truncated_before=window.truncated_before, keywords_analyzed=len(read))
    return ScopedAnswer(framed, analyzed=len(read))


def trends_for_scope(
    scope: ReportScope | None, period: str, days: int, owned_domains: list[str], **options: Any,
) -> ScopedAnswer:
    """The trend view of ``scope`` over the last ``days`` days, live or from its snapshot (also behind ``/reports/overview``).

    ``options`` are ``TrendsRequest``'s other fields. The answer's ``body`` has
    the scope contract; its ``response`` (202, a failed job, a bad cursor)
    replaces it when set.
    """
    request = TrendsRequest(period=period, days=days, owned_domains=owned_domains, **options)
    resolved = _resolve_scope(scope)
    live = kpi_window_route(resolved) == 'live'
    if live and request.view in ('latest_brands', BRAND_SERIES_VIEW):
        offset = live_list_offset(request.next_token, request.event)
        if isinstance(offset, dict):
            return ScopedAnswer(response=offset)
        request = replace(request, offset=offset, next_token=None)
    snapshot = SnapshotRequest(
        route=request.route, builder=TRENDS_BUILDER,
        params={'period': period, 'days': days, 'view': request.view, 'page_size': request.page_size},
        report_scope=resolved, brand_config_updated_at=request.brand_config_updated_at, event=request.event,
        next_token=request.next_token, job_params={'period': period, 'days': days},
    )
    return answer_scoped(live, snapshot, lambda: live_trends(resolved, request), _framed(resolved))


@api_handler
@validate({
    **SCOPE_QUERY_PARAMS,
    **TREND_WINDOW_PARAMS,
    **view_query_params(VIEWS),
})
def handler(
    event: dict[str, Any],
    context: Any,
    *,
    view: str = 'summary',
    next_token: str | None = None,
    period: str = 'day',
    days: int = 30,
    **scope_params: str | None,
) -> dict[str, Any]:
    """GET /api/trends — the KPIs of a scope over time (see the module docstring)."""
    config = get_brand_config()
    report_scope, rejected = scope_from_request(event, scope_params, dynamodb.Table(KEYWORDS_TABLE))
    if rejected:
        return rejected
    result = trends_for_scope(
        report_scope, period, days, owned_domains_from(config),
        view=view, next_token=next_token, brand_config_updated_at=config.get('updated_at'), event=event,
    )
    return result.response or success_response(result.body or {}, event)
