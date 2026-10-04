"""
Visibility Metrics API — GET /api/visibility

Where the brand stands now in a scope (exactly one of ``keyword=``,
``group_id=``, ``keyword_ids=`` or ``scope=all``): every KPI of
``docs/kpi-definitions.md`` over each keyword's latest analysis run, pooled,
its change since each keyword's previous run (like for like), the brand
leaderboard of those answers, and a row per keyword. One response shape for
every scope; formulas in ``shared.kpi_engine``.

Optional: ``query_prompt_id`` keeps one persona's answers of the latest run;
``brand`` narrows the leaderboard to matching brand names.
"""

import logging
import os
import sys
from typing import Any

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.answer_queries import query_last_two_runs_rows
from shared.api_response import success_response
from shared.decorators import api_handler, validate
from shared.kpi_engine import Answer, answers_from_rows, owned_domains_from
from shared.scope_params import (
    SCOPE_QUERY_PARAMS,
    ReportScope,
    keywords_table_name,
    map_scope_keywords,
    scoped_dynamodb_resource,
)
from shared.scoped_reports import capped_scope, required_report_scope
from shared.utils import get_brand_config
from shared.visibility_views import visibility_view

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# One latest-run read per keyword, SCOPE_MAX_WORKERS at a time (map_scope_keywords).
dynamodb = scoped_dynamodb_resource()

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = os.environ['DYNAMODB_TABLE_SEARCH_RESULTS']
KEYWORDS_TABLE = keywords_table_name()


def load_last_two_runs(keywords: list[str]) -> tuple[dict[str, list[Answer]], dict[str, list[Answer]]]:
    """Each keyword's answers in its latest run and in the run before, read in parallel.

    A keyword whose read fails has no answers (logged by ``map_scope_keywords``):
    one broken partition must not sink the whole view.
    """
    table = dynamodb.Table(SEARCH_RESULTS_TABLE)
    runs = map_scope_keywords(
        keywords,
        lambda keyword: tuple(answers_from_rows(rows) for rows in query_last_two_runs_rows(table, keyword)),
        lambda _keyword: ([], []),
    )
    latest = {keyword: runs[index][0] for index, keyword in enumerate(keywords)}
    previous = {keyword: runs[index][1] for index, keyword in enumerate(keywords)}
    return latest, previous


def scope_visibility(
    scope: ReportScope,
    owned_domains: list[str],
    *,
    persona: str | None,
    brand: str | None,
) -> dict[str, Any]:
    """The visibility view of ``scope``, capped at ``SCOPE_KEYWORDS_CAP`` keywords."""
    keywords, scope_fields = capped_scope(scope)
    latest, previous = load_last_two_runs(keywords)
    view = visibility_view(keywords, latest, owned_domains, previous_by_keyword=previous, persona=persona, brand=brand)
    return {
        **scope_fields,
        'citations_configured': bool(owned_domains),
        **view,
    }


@api_handler
@validate({
    **SCOPE_QUERY_PARAMS,
    'brand': {'type': str, 'max_length': 200},
    'query_prompt_id': {'type': str, 'max_length': 100},
})
@required_report_scope(lambda: dynamodb.Table(KEYWORDS_TABLE))
def handler(event, context, report_scope, brand=None, query_prompt_id=None):
    """GET /api/visibility — the KPIs of a scope's latest runs (see the module docstring)."""
    owned_domains = owned_domains_from(get_brand_config())
    return success_response(
        scope_visibility(report_scope, owned_domains, persona=query_prompt_id, brand=brand),
        event,
    )
