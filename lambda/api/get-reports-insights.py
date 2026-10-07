"""
Insights API — GET /api/reports/insights

The facts behind the Insights report and the typed insights they support
(``shared.insights_engine``): the tracked brand's KPIs per AI engine with the
play each engine calls for, the first-party brands measured against the best
of them and, for a keyword group, how far each keyword's position swung
across the runs of the last ``days`` days. The engine and portfolio facts
rest on the scope's latest runs, read as ``GET /api/visibility`` reads them;
the stability facts on the per-run history ``GET /api/reports/group-kpis``
reports, so every number agrees with those pages. ``narrative`` is reserved
for a later phase and always ``null``.

Takes the scope every KPI endpoint takes — one of ``group_id``,
``keyword_ids``, ``scope=all`` or ``keyword`` — plus ``days``
(``HISTORY_WINDOW_PARAMS``), which only a group's stability facts look back
over. A scope without an active keyword is refused: there is nothing to draw
an insight from.
"""

from collections.abc import Callable
from typing import Any

from shared.answer_queries import history_since, query_keyword_rows_since, query_latest_run_rows
from shared.api_response import success_response, validation_error
from shared.decorators import api_handler, validate
from shared.group_kpi_history import build_group_kpi_history
from shared.insights_engine import compute_insights
from shared.kpi_engine import Answer, answers_from_rows, owned_domains_from
from shared.scope_params import SCOPE_QUERY_PARAMS, keywords_table_name, map_scope_keywords, scoped_dynamodb_resource
from shared.scoped_reports import TREND_WINDOW_PARAMS, capped_scope, required_report_scope
from shared.search_results import search_results_table_name
from shared.utils import get_brand_config
from shared.visibility_views import visibility_view

# One read per keyword, SCOPE_MAX_WORKERS at a time, over at most
# SCOPE_KEYWORDS_CAP keywords (the /visibility group bounds).
dynamodb = scoped_dynamodb_resource()
SEARCH_RESULTS_TABLE = search_results_table_name()
KEYWORDS_TABLE = keywords_table_name()

#: The ``days`` rule every windowed report shares (1-365), defaulting to the 90 days of ``/reports/group-kpis``.
HISTORY_WINDOW_PARAMS: dict[str, dict[str, Any]] = {'days': {**TREND_WINDOW_PARAMS['days'], 'default': 90}}

#: The scope kind with a run history to compare: only a keyword group has stability facts.
GROUP_SCOPE = 'group'

#: The fields of ``GET /api/visibility`` that say which latest runs the facts rest on.
COVERAGE_FIELDS = ('timestamp', 'keywords_analyzed', 'keywords_with_data')

PartitionRead = Callable[[Any, str], list[dict[str, Any]]]
"""``read(table, keyword)``: the projected SearchResults rows of one keyword."""


def keywords_table() -> Any:
    """The Keywords table scopes resolve against, looked up per request so tests can swap ``dynamodb``."""
    return dynamodb.Table(KEYWORDS_TABLE)


def read_per_keyword(keywords: list[str], read: PartitionRead) -> dict[str, list[dict[str, Any]]]:
    """``read(table, keyword)`` over the SearchResults table for every keyword, in parallel.

    A partition that cannot be read answers no rows and is logged by
    ``map_scope_keywords``, so the other keywords still make a report.
    """
    table = dynamodb.Table(SEARCH_RESULTS_TABLE)
    rows = map_scope_keywords(keywords, lambda keyword: read(table, keyword), lambda _keyword: [])
    return dict(zip(keywords, rows, strict=True))


def load_latest_answers(keywords: list[str]) -> dict[str, list[Answer]]:
    """Each keyword's answers in its latest run: the runs ``GET /api/visibility`` measures."""
    return {keyword: answers_from_rows(rows) for keyword, rows in read_per_keyword(keywords, query_latest_run_rows).items()}


def load_history(keywords: list[str], days: int, owned_domains: list[str]) -> list[dict[str, Any]]:
    """Each keyword's runs of the last ``days`` days with their KPIs, as ``GET /api/reports/group-kpis`` builds them."""
    since = history_since(days)
    rows = read_per_keyword(keywords, lambda table, keyword: query_keyword_rows_since(table, keyword, since))
    return build_group_kpi_history(keywords, rows, owned_domains)['keywords']


@api_handler
@validate({**SCOPE_QUERY_PARAMS, **HISTORY_WINDOW_PARAMS})
@required_report_scope(keywords_table)
def handler(event, context, report_scope, *, days):
    """GET /api/reports/insights — the facts and insights of a scope (``days`` defaults to 90 in ``@validate``)."""
    if not report_scope.keywords:
        return validation_error(f'No active keywords match the selected scope ({report_scope.label}).', event, 'scope')
    keywords, scope_fields = capped_scope(report_scope)
    owned_domains = owned_domains_from(get_brand_config())
    latest = load_latest_answers(keywords)
    # Only a keyword group has a run history to compare; elsewhere the stability facts stay empty.
    history = load_history(keywords, days, owned_domains) if report_scope.kind == GROUP_SCOPE else None
    # The latest-run coverage, computed by the view behind /visibility so both pages say the same.
    coverage = visibility_view(keywords, latest)
    insights = compute_insights((answer for answers in latest.values() for answer in answers), owned_domains, history)
    return success_response({
        **scope_fields,
        **{key: coverage[key] for key in COVERAGE_FIELDS},
        'citations_configured': bool(owned_domains),
        **insights,
        'narrative': None,
    }, event)
