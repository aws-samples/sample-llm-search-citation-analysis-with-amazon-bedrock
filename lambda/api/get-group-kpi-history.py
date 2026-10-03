"""
Group KPI History API — GET /api/reports/group-kpis

The per-hotel report: every analysis run of a keyword group within the last
``days`` days with its KPIs (``docs/kpi-definitions.md``), the keywords that
drove each change, and a per-keyword drill-down of every run. Run semantics
live in ``shared.group_kpi_history``; the citation KPIs use the owned domains
of the brand configuration.

Query params: exactly one scope (``group_id``, ``keyword_ids``, ``scope=all``
or ``keyword``) and ``days`` (1-365, default 90).
"""

import logging
from typing import Any

from shared.answer_queries import history_since, query_keyword_rows_since
from shared.api_response import success_response
from shared.decorators import api_handler, validate
from shared.group_kpi_history import GROUP_RUN_MIN_COVERAGE, build_group_kpi_history
from shared.kpi_engine import owned_domains_from
from shared.scope_params import SCOPE_QUERY_PARAMS, keywords_table_name, map_scope_keywords, scoped_dynamodb_resource
from shared.scoped_reports import capped_scope, required_report_scope
from shared.search_results import search_results_table_name
from shared.utils import get_brand_config

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# One Query per keyword, SCOPE_MAX_WORKERS at a time, over at most
# SCOPE_KEYWORDS_CAP keywords (the /visibility group bounds).
dynamodb = scoped_dynamodb_resource()
SEARCH_RESULTS_TABLE = search_results_table_name()
KEYWORDS_TABLE = keywords_table_name()


def load_rows(keywords: list[str], since: str) -> dict[str, list[dict[str, Any]]]:
    """Each keyword's SearchResults rows from ``since`` on, read in parallel.

    A keyword whose read fails contributes no rows (logged by
    ``map_scope_keywords``): one broken partition must not sink the report.
    """
    table = dynamodb.Table(SEARCH_RESULTS_TABLE)
    rows = map_scope_keywords(
        keywords,
        lambda keyword: query_keyword_rows_since(table, keyword, since),
        lambda _keyword: [],
    )
    return {keyword: rows[index] for index, keyword in enumerate(keywords)}


@api_handler
@validate({
    **SCOPE_QUERY_PARAMS,
    'days': {'type': int, 'min': 1, 'max': 365, 'default': 90},
})
@required_report_scope(lambda: dynamodb.Table(KEYWORDS_TABLE))
def handler(event, context, report_scope, *, days):
    """GET /api/reports/group-kpis - per-run KPI history of a keyword group (``days`` defaults to 90 in ``@validate``)."""
    keywords, scope_fields = capped_scope(report_scope)
    since = history_since(days)
    owned_domains = owned_domains_from(get_brand_config())
    history = build_group_kpi_history(keywords, load_rows(keywords, since), owned_domains)
    return success_response({
        **scope_fields,
        'days': days,
        'since': since,
        'group_run_min_coverage': GROUP_RUN_MIN_COVERAGE,
        'citations_configured': bool(owned_domains),
        **history,
    }, event)
