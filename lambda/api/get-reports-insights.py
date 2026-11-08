"""
Insights API — GET /api/reports/insights

The facts behind the Insights report and the typed insights they support
(``shared.insights_engine``): the tracked brand's KPIs per AI engine with the
play each engine calls for, its position per keyword and engine, who the
engines cite (the brand's domains, each competitor's ``competitor_domains``
from the brand configuration, third parties) and which owned pages, the
caveats the answers word competitors with, the first-party brands measured
against the best of them and, for a keyword group, how far each keyword's
position swung across the runs of the last ``days`` days. All but the
stability facts rest on the scope's latest runs, read as
``GET /api/visibility`` reads them;
the stability facts on the per-run history ``GET /api/reports/group-kpis``
reports, so every number agrees with those pages. ``narrative`` is the
written narrative stored for a keyword group's latest run
(``shared.insights_narrative``, written by the GenerateInsights step after each
complete group run, or on demand by ``POST /api/reports/insights/regenerate``);
``null`` for any other scope and while none is stored.

Takes the scope every KPI endpoint takes — one of ``group_id``,
``keyword_ids``, ``scope=all`` or ``keyword`` — plus ``days``
(``HISTORY_WINDOW_PARAMS``), which only a group's stability facts look back
over. A scope without an active keyword is refused: there is nothing to draw
an insight from.

Complete for every scope (2.45.0): a scope whose latest runs fit the live
budget is read whole for the request (``shared.action_scope_serve``); a
larger one is served from its scope snapshot (``shared.artifact_insights``:
the facts of every keyword, a group's stability for the ``days`` presets),
or answers 202 while a view job computes it (any other ``days`` of a large
group). Every body carries ``coverage``, ``source``, ``as_of``, ``stale`` and
``refreshing``.

Full lists (2.45.0 wave 5): the facts list the first 25 owned pages and 50
prompt-by-engine keywords of their whole lists, with ``pages_total`` /
``keywords_total`` and ``pages_next_token`` / ``keywords_next_token`` (in
``facts.owned_pages`` / ``facts.prompt_engine``); ``view=owned_pages`` /
``view=prompt_engine`` with that ``next_token`` answers the next page
(``shared.insights_pages``, 100 a page, its own ``next_token``).

On the live path reads stop at the request's time budget:
keywords left unread are left out of the facts and ``keywords_truncated`` is
true; a history the budget or the row cap shortened says where in
``history_truncated_before``.
"""

import functools
from collections.abc import Callable
from typing import Any

from shared import action_scope_serve
from shared.action_scope_serve import SnapshotRequest, live_build_id, page_offset, serve_snapshot
from shared.answer_queries import history_since, query_latest_run_rows
from shared.api_response import success_response, validation_error
from shared.cursors import CURSOR_QUERY_PARAM
from shared.decorators import api_handler, validate
from shared.insights_citations import competitor_domains_from
from shared.insights_engine import compute_facts, insights_from_facts
from shared.insights_narrative import group_scope_key, load_narrative
from shared.insights_pages import PAGED_FACTS, facts_page, with_page_tokens
from shared.keyword_run_kpis import keyword_run_kpis_table
from shared.kpi_engine import Answer, answers_from_rows, owned_domains_from
from shared.markets import market_scoped_key
from shared.scope_params import SCOPE_QUERY_PARAMS, keywords_table_name, scoped_dynamodb_resource
from shared.scoped_reports import (
    TREND_WINDOW_PARAMS,
    ScopeRead,
    WindowRuns,
    read_scope_keywords,
    required_report_scope,
    window_histories,
)
from shared.search_results import search_results_table_name
from shared.snapshot_artifacts import SOURCE_SNAPSHOT, coverage, live_envelope, with_scope_contract
from shared.utils import get_brand_config
from shared.visibility_views import visibility_view

# One read per keyword, SCOPE_MAX_WORKERS at a time.
dynamodb = scoped_dynamodb_resource()
SEARCH_RESULTS_TABLE = search_results_table_name()
KEYWORDS_TABLE = keywords_table_name()

#: The ``days`` rule every windowed report shares (1-365), defaulting to the 90 days of ``/reports/group-kpis``.
HISTORY_WINDOW_PARAMS: dict[str, dict[str, Any]] = {'days': {**TREND_WINDOW_PARAMS['days'], 'default': 90}}

#: The scope kind with a run history to compare: only a keyword group has stability facts.
GROUP_SCOPE = 'group'

#: The route's name for view jobs.
ROUTE = 'reports-insights'

#: The fields of ``GET /api/visibility`` that say which latest runs the facts rest on.
COVERAGE_FIELDS = ('timestamp', 'keywords_analyzed', 'keywords_with_data')

PartitionRead = Callable[[Any, str], list[dict[str, Any]]]
"""``read(table, keyword)``: the projected SearchResults rows of one keyword."""


def keywords_table() -> Any:
    """The Keywords table scopes resolve against, looked up per request so tests can swap ``dynamodb``."""
    return dynamodb.Table(KEYWORDS_TABLE)


def read_per_keyword(keywords: list[str], read: PartitionRead) -> ScopeRead[list[dict[str, Any]]]:
    """``read(table, keyword)`` over the SearchResults table for every keyword, in parallel.

    A partition that cannot be read answers no rows and is logged by
    ``map_scope_keywords``, so the other keywords still make a report; a
    keyword the time budget left unread is ``skipped``.
    """
    return read_scope_keywords(keywords, functools.partial(read, dynamodb.Table(SEARCH_RESULTS_TABLE)), lambda _keyword: [])


def load_latest_answers(keywords: list[str]) -> ScopeRead[list[Answer]]:
    """Each keyword's answers in its latest run: the runs ``GET /api/visibility`` measures."""
    rows = read_per_keyword(keywords, query_latest_run_rows)
    return ScopeRead({keyword: answers_from_rows(keyword_rows) for keyword, keyword_rows in rows.values.items()}, rows.skipped)


def load_history(keywords: list[str], days: int, owned_domains: list[str]) -> tuple[list[dict[str, Any]], WindowRuns]:
    """Each keyword's runs of the last ``days`` days with their KPIs, read as ``GET /api/reports/group-kpis`` reads them.

    The second value is the window read: ``truncated_before`` (``None`` for a
    window read whole) and the keywords the time budget left unread.
    """
    return window_histories(
        dynamodb.Table(SEARCH_RESULTS_TABLE), keywords, history_since(days), owned_domains, rollups=keyword_run_kpis_table(dynamodb),
    )


def group_narrative(report_scope: Any, run_timestamp: str | None) -> dict[str, Any] | None:
    """The narrative stored for a keyword group's latest run (``run_timestamp``); ``None`` for any other scope.

    Narratives are written per (group, market): the market filter picks that
    market's narrative, and no filter the global market's (the group's
    keywords without a market).
    """
    if report_scope.kind != GROUP_SCOPE:
        return None
    key = market_scoped_key(group_scope_key(report_scope.scope['group_ids'][0]), report_scope.market_id)
    return load_narrative(key, run_timestamp)


#: The views: the whole answer, or one page of a long fact list.
VIEWS = ('summary', *PAGED_FACTS)


def live_insights(report_scope: Any, brand_config: dict[str, Any], days: int, view: str = 'summary', offset: int = 0) -> dict[str, Any]:
    """The insights body (or ``view`` page) of ``report_scope`` read for this request: every keyword, cut only by the time budget."""
    owned_domains = owned_domains_from(brand_config)
    keywords = list(report_scope.keywords)
    latest_read = load_latest_answers(keywords)
    latest = latest_read.values
    skipped = set(latest_read.skipped)
    history, history_truncated_before = None, None
    # Only a keyword group has a run history to compare; elsewhere the stability facts stay empty.
    if report_scope.kind == GROUP_SCOPE:
        history, window = load_history(latest_read.keywords, days, owned_domains)
        history_truncated_before = window.truncated_before
        skipped.update(window.skipped)
    # The latest-run coverage, computed by the view behind /visibility so both pages say the same.
    coverage_view = visibility_view(latest_read.keywords, latest)
    facts = compute_facts(
        (answer for answers in latest.values() for answer in answers), owned_domains, history, competitor_domains_from(brand_config),
    )
    build_id = live_build_id(report_scope)
    analyzed = len(keywords) - len(set(latest_read.skipped))
    if view in PAGED_FACTS:
        page = {'keywords_truncated': bool(skipped), **facts_page(facts, view, offset, build_id)}
        return with_scope_contract(page, coverage(len(keywords), analyzed), live_envelope())
    body = {
        'keywords_truncated': bool(skipped),
        **{key: coverage_view[key] for key in COVERAGE_FIELDS},
        **with_page_tokens(insights_from_facts(facts), build_id),
        'history_truncated_before': history_truncated_before,
    }
    return with_scope_contract(body, coverage(len(keywords), analyzed), live_envelope())


@api_handler
@validate({**SCOPE_QUERY_PARAMS, **HISTORY_WINDOW_PARAMS, 'view': {'type': str, 'choices': list(VIEWS), 'default': VIEWS[0]}, **CURSOR_QUERY_PARAM})
@required_report_scope(keywords_table)
def handler(event, context, report_scope, *, days, view='summary', next_token=None):
    """GET /api/reports/insights — the facts and insights of a scope, or one page of a long fact list (``days`` defaults to 90)."""
    if not report_scope.keywords:
        return validation_error(f'No active keywords match the selected scope ({report_scope.label}).', event, 'scope')
    brand_config = get_brand_config()
    owned_domains = owned_domains_from(brand_config)
    if action_scope_serve.action_route(report_scope, dynamodb) == SOURCE_SNAPSHOT:
        job_params = {'days': days, 'owned_domains': owned_domains, 'competitor_domains': competitor_domains_from(brand_config)}
        answer = serve_snapshot(SnapshotRequest(
            route=ROUTE, builder='insights', report_scope=report_scope, brand_config_updated_at=brand_config.get('updated_at'), event=event,
            params={**job_params, 'view': view}, next_token=next_token, job_params=job_params,
        ))
        if answer.body is None:
            return answer.response or {}
        body = answer.body
    else:
        offset, rejected = page_offset(next_token, live_build_id(report_scope), event)
        if rejected is not None:
            return rejected
        body = live_insights(report_scope, brand_config, days, view, offset)
    if view in PAGED_FACTS:
        return success_response({'scope': report_scope.describe(), **body}, event)
    return success_response({
        'scope': report_scope.describe(),
        **body,
        'citations_configured': bool(owned_domains),
        'narrative': group_narrative(report_scope, body['timestamp']),
    }, event)
