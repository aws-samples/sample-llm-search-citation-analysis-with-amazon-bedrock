"""
Historical Trends API — GET /api/trends

How the brand's KPIs (``docs/kpi-definitions.md``) moved over the last
``days`` days in a scope: one point per day, ISO week or month holding every
answer of the period, the scope's latest standing and its change against the
previous period, and each keyword's own move. Formulas in
``shared.kpi_engine``; views in ``shared.visibility_views``.

Scope: at most one of ``keyword=``, ``group_id=``, ``keyword_ids=`` or
``scope=all``. Without one, every active keyword. Either way at most
``SCOPE_KEYWORDS_CAP`` keywords (``keywords_truncated``): the window's rows
are shared between them (``shared.scoped_reports.rows_per_keyword``), so a
broad scope costs no more rows or time than a narrow one, only a shorter
history per keyword.

The window is read newest first, at most ``shared.scoped_reports.WINDOW_ROWS_CAP``
rows and within the request's time budget; when the cap or the budget stops
it, ``truncated_before`` names the run it stopped at and every number covers
the runs after it (``null`` for a window read whole). Keywords the budget
left unread are left out (``keywords_analyzed`` counts the ones read) and
``keywords_truncated`` is true.
"""

import logging
import sys
from typing import Any

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.answer_queries import history_since
from shared.api_response import success_response
from shared.decorators import api_handler, validate
from shared.kpi_engine import owned_domains_from
from shared.scope_params import (
    SCOPE_KEYWORDS_CAP,
    SCOPE_QUERY_PARAMS,
    ReportScope,
    all_active_scope,
    keywords_table_name,
    scope_from_request,
    scoped_dynamodb_resource,
)
from shared.scoped_reports import TREND_WINDOW_PARAMS, WindowAnswers, capped_scope, scope_read_fields
from shared.scoped_reports import load_window_answers as load_scoped_window_answers
from shared.search_results import search_results_table_name
from shared.utils import get_brand_config
from shared.visibility_views import trend_view

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

#: Keywords one trend reads at most, scoped or not: the window's rows are shared between them.
TREND_KEYWORDS_CAP = SCOPE_KEYWORDS_CAP

# One windowed read per keyword, SCOPE_MAX_WORKERS at a time (map_scope_keywords).
dynamodb = scoped_dynamodb_resource()

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = search_results_table_name()
KEYWORDS_TABLE = keywords_table_name()


def load_window_answers(keywords: list[str], since: str) -> WindowAnswers:
    """Each keyword's answers from ``since`` on, read in parallel and bounded (``shared.scoped_reports.load_window_answers``)."""
    return load_scoped_window_answers(dynamodb.Table(SEARCH_RESULTS_TABLE), keywords, since)


def _resolve_scope(scope: ReportScope | None) -> ReportScope:
    """The scope; no scope is every active keyword."""
    return all_active_scope(dynamodb.Table(KEYWORDS_TABLE)) if scope is None else scope


def trends_for_scope(scope: ReportScope | None, period: str, days: int, owned_domains: list[str]) -> dict[str, Any]:
    """The trend view of ``scope`` over the last ``days`` days (also behind ``/reports/overview``)."""
    keywords, scope_fields = capped_scope(_resolve_scope(scope), TREND_KEYWORDS_CAP)
    since = history_since(days)
    window = load_window_answers(keywords, since)
    read = window.read_keywords(keywords)
    return {
        **scope_read_fields(scope_fields, window.skipped),
        'period_type': period,
        'days_analyzed': days,
        'since': since,
        'truncated_before': window.truncated_before,
        'keywords_analyzed': len(read),
        'citations_configured': bool(owned_domains),
        **trend_view(read, window.answers, period, owned_domains),
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
