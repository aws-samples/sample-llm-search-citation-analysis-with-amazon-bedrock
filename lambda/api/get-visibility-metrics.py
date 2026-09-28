"""
Visibility Metrics API — GET /api/visibility

Where the brand stands now in a scope (exactly one of ``keyword=``,
``group_id=``, ``keyword_ids=`` or ``scope=all``): every KPI of
``docs/kpi-definitions.md`` over each keyword's latest analysis run, pooled,
the brand leaderboard of those answers, and a row per keyword. One response
shape for every scope; formulas in ``shared.kpi_engine``.

Optional: ``query_prompt_id`` keeps one persona's answers of the latest run;
``brand`` narrows the leaderboard to matching brand names.
"""

import logging
import os
import sys
from typing import Any

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.answer_queries import query_latest_run_rows
from shared.api_response import success_response
from shared.decorators import api_handler, validate
from shared.kpi_engine import Answer, answers_from_rows, owned_domains_from
from shared.scope_params import (
    SCOPE_KEYWORDS_CAP,
    SCOPE_QUERY_PARAMS,
    ReportScope,
    keywords_table_name,
    map_scope_keywords,
    scope_from_request,
    scoped_dynamodb_resource,
)
from shared.utils import get_brand_config
from shared.visibility_views import visibility_view

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# One latest-run read per keyword, SCOPE_MAX_WORKERS at a time (map_scope_keywords).
dynamodb = scoped_dynamodb_resource()

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = os.environ['DYNAMODB_TABLE_SEARCH_RESULTS']
KEYWORDS_TABLE = keywords_table_name()


def load_latest_answers(keywords: list[str]) -> dict[str, list[Answer]]:
    """Each keyword's answers in its latest run, read in parallel.

    A keyword whose read fails has no answers (logged by ``map_scope_keywords``):
    one broken partition must not sink the whole view.
    """
    table = dynamodb.Table(SEARCH_RESULTS_TABLE)
    answers = map_scope_keywords(
        keywords,
        lambda keyword: answers_from_rows(query_latest_run_rows(table, keyword)),
        lambda _keyword: [],
    )
    return dict(zip(keywords, answers, strict=True))


def scope_visibility(
    scope: ReportScope,
    owned_domains: list[str],
    *,
    persona: str | None = None,
    brand: str | None = None,
) -> dict[str, Any]:
    """The visibility view of ``scope``, capped at ``SCOPE_KEYWORDS_CAP`` keywords."""
    keywords = list(scope.keywords)[:SCOPE_KEYWORDS_CAP]
    view = visibility_view(keywords, load_latest_answers(keywords), owned_domains, persona=persona, brand=brand)
    return {
        'scope': scope.describe(),
        'keywords_truncated': len(scope.keywords) > len(keywords),
        'citations_configured': bool(owned_domains),
        **view,
    }


@api_handler
@validate({
    **SCOPE_QUERY_PARAMS,
    'brand': {'type': str, 'max_length': 200},
    'query_prompt_id': {'type': str, 'max_length': 100},
})
def handler(event, context, brand=None, query_prompt_id=None, **scope_params):
    """GET /api/visibility — the KPIs of a scope's latest runs (see the module docstring)."""
    report_scope, rejected = scope_from_request(event, scope_params, dynamodb.Table(KEYWORDS_TABLE), required=True)
    if report_scope is None:
        # A required scope resolves to exactly one of (scope, None) / (None, rejection).
        return rejected

    owned_domains = owned_domains_from(get_brand_config())
    return success_response(
        scope_visibility(report_scope, owned_domains, persona=query_prompt_id, brand=brand),
        event,
    )
