"""
Group KPI History API — GET /api/reports/group-kpis

The per-hotel report: every analysis run of a keyword group within the last
``days`` days with its citation rate, share of voice and prominence, the
keywords that drove each change, and a per-keyword drill-down of every run.
Formulas and run semantics live in ``shared.group_kpi_history``.

Query params: exactly one scope (``group_id``, ``keyword_ids``, ``scope=all``
or ``keyword``) and ``days`` (1-365, default 90).
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from shared.api_response import success_response
from shared.decorators import api_handler, validate
from shared.group_kpi_history import GROUP_RUN_MIN_COVERAGE, build_group_kpi_history, query_keyword_rows_since
from shared.providers import get_enabled_provider_count
from shared.scope_params import (
    SCOPE_KEYWORDS_CAP,
    SCOPE_QUERY_PARAMS,
    keywords_table_name,
    map_scope_keywords,
    scope_from_request,
    scoped_dynamodb_resource,
)
from shared.search_results import search_results_table_name

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# One Query per keyword, SCOPE_MAX_WORKERS at a time, over at most
# SCOPE_KEYWORDS_CAP keywords (the /visibility group bounds).
dynamodb = scoped_dynamodb_resource()
SEARCH_RESULTS_TABLE = search_results_table_name()
KEYWORDS_TABLE = keywords_table_name()


def history_since(days: int, now: datetime | None = None) -> str:
    """The ISO timestamp ``days`` days before ``now``, in the run timestamps' format."""
    moment = (now or datetime.now(UTC)) - timedelta(days=days)
    return moment.strftime('%Y-%m-%dT%H:%M:%S.%fZ')


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
def handler(event, context, *, days, **scope_params):
    """GET /api/reports/group-kpis - per-run KPI history of a keyword group (``days`` defaults to 90 in ``@validate``)."""
    report_scope, rejected = scope_from_request(event, scope_params, dynamodb.Table(KEYWORDS_TABLE), required=True)
    if report_scope is None:
        return rejected

    keywords = list(report_scope.keywords)[:SCOPE_KEYWORDS_CAP]
    since = history_since(days)
    total_providers = get_enabled_provider_count()
    history = build_group_kpi_history(keywords, load_rows(keywords, since), total_providers)
    return success_response({
        'scope': report_scope.describe(),
        'days': days,
        'since': since,
        'total_providers': total_providers,
        'group_run_min_coverage': GROUP_RUN_MIN_COVERAGE,
        'keywords_truncated': len(report_scope.keywords) > len(keywords),
        **history,
    }, event)
