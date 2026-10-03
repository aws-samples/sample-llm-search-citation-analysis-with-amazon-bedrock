"""
Historical Trends API — GET /api/trends

How the brand's KPIs (``docs/kpi-definitions.md``) moved over the last
``days`` days in a scope: one point per day, ISO week or month holding every
answer of the period, the scope's latest standing and its change against the
previous period, and each keyword's own move. Formulas in
``shared.kpi_engine``; views in ``shared.visibility_views``.

Scope: at most one of ``keyword=``, ``group_id=``, ``keyword_ids=`` or
``scope=all``. Without one, every active keyword (capped at
``_ALL_KEYWORDS_CAP``, the dashboard's historical breadth).
"""

import logging
import os
import sys
from typing import Any

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.answer_queries import history_since, query_keyword_rows_since
from shared.api_response import success_response
from shared.decorators import api_handler, validate
from shared.kpi_engine import Answer, answers_from_rows, owned_domains_from
from shared.scope_params import (
    SCOPE_KEYWORDS_CAP,
    SCOPE_QUERY_PARAMS,
    ReportScope,
    all_active_scope,
    keywords_table_name,
    map_scope_keywords,
    scope_from_request,
    scoped_dynamodb_resource,
)
from shared.scoped_reports import TREND_WINDOW_PARAMS, capped_scope
from shared.utils import get_brand_config
from shared.visibility_views import trend_view

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

#: Keywords an unscoped request covers; an explicit scope may cover SCOPE_KEYWORDS_CAP.
_ALL_KEYWORDS_CAP = 20

# One windowed read per keyword, SCOPE_MAX_WORKERS at a time (map_scope_keywords).
dynamodb = scoped_dynamodb_resource()

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = os.environ['DYNAMODB_TABLE_SEARCH_RESULTS']
KEYWORDS_TABLE = keywords_table_name()


def load_window_answers(keywords: list[str], since: str) -> dict[str, list[Answer]]:
    """Each keyword's answers from ``since`` on, read in parallel; a failed read has none (logged)."""
    table = dynamodb.Table(SEARCH_RESULTS_TABLE)
    answers = map_scope_keywords(
        keywords,
        lambda keyword: answers_from_rows(query_keyword_rows_since(table, keyword, since)),
        lambda _keyword: [],
    )
    return {keyword: answers[index] for index, keyword in enumerate(keywords)}


def _resolve_scope(scope: ReportScope | None) -> tuple[ReportScope, int]:
    """The scope and its keyword cap; no scope is every active keyword."""
    if scope is None:
        return all_active_scope(dynamodb.Table(KEYWORDS_TABLE)), _ALL_KEYWORDS_CAP
    return scope, SCOPE_KEYWORDS_CAP


def trends_for_scope(scope: ReportScope | None, period: str, days: int, owned_domains: list[str]) -> dict[str, Any]:
    """The trend view of ``scope`` over the last ``days`` days (also behind ``/reports/overview``)."""
    keywords, scope_fields = capped_scope(*_resolve_scope(scope))
    since = history_since(days)
    return {
        **scope_fields,
        'period_type': period,
        'days_analyzed': days,
        'since': since,
        'keywords_analyzed': len(keywords),
        'citations_configured': bool(owned_domains),
        **trend_view(keywords, load_window_answers(keywords, since), period, owned_domains),
    }


@api_handler
@validate({
    **SCOPE_QUERY_PARAMS,
    **TREND_WINDOW_PARAMS,
})
def handler(
    event: dict[str, Any],
    context: Any,
    period: str = 'day',
    days: int = 30,
    **scope_params: str | None,
) -> dict[str, Any]:
    """GET /api/trends — the KPIs of a scope over time (see the module docstring)."""
    report_scope, rejected = scope_from_request(event, scope_params, dynamodb.Table(KEYWORDS_TABLE))
    if rejected:
        return rejected
    owned_domains = owned_domains_from(get_brand_config())
    return success_response(trends_for_scope(report_scope, period, days, owned_domains), event)
