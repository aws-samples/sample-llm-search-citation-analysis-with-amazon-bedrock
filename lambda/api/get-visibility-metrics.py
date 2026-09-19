"""
Visibility Metrics API

Calculates and returns visibility scores and share of voice metrics
for brands across AI providers.

Metrics:
- Visibility Score: 0-100 score based on mentions, rankings, and provider coverage
- Share of Voice: % of total brand mentions that belong to each brand
- Provider Coverage: Which AI engines mention the brand
- Prominence: answer-level first-party rank and first-position metrics
- Trend Direction: Improving, declining, or stable

Scope (2.4.0): exactly one of ``keyword=`` (one keyword, unchanged response),
``group_id=`` (every active keyword in a keyword group) or ``keyword_ids=``
(comma-separated keyword ids). Group and id scopes answer a *group summary*:
the per-keyword metrics are computed in parallel with the same formulas and
averaged, with a per-keyword breakdown and a cross-keyword brand ranking.
"""

import logging
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import boto3
from botocore.config import Config

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import success_response
from shared.decorators import api_handler, validate
from shared.providers import get_enabled_provider_count
from shared.scope_params import (
    SCOPE_QUERY_PARAMS,
    ReportScope,
    keywords_table_name,
    query_keyword_rows,
    scope_from_request,
)
from shared.utils import get_brand_config
from shared.visibility_metrics import METRICS_PROJECTION, calculate_keyword_visibility
from shared.visibility_score import summarize_group_visibility

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# The group summary fans out one Query per keyword; give boto3 enough pooled
# connections for the thread pool below.
dynamodb = boto3.resource('dynamodb', config=Config(max_pool_connections=50))

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = os.environ['DYNAMODB_TABLE_SEARCH_RESULTS']
KEYWORDS_TABLE = keywords_table_name()

# Parallel per-keyword fan-out for group scopes, and the most keywords one
# group summary covers (the `keyword_ids` cap; keeps the request inside the
# 29s API budget with projected queries).
_SCOPE_MAX_WORKERS = 10
_SCOPE_KEYWORDS_CAP = 100

# Shared with the exact-run alert worker; the API keeps selecting latest rows.
_METRICS_PROJECTION = METRICS_PROJECTION


def get_visibility_metrics(
    keyword: str,
    config: dict[str, Any],
    query_prompt_id: str | None = None,
    total_providers: int | None = None,
) -> dict[str, Any]:
    """Calculate the established API payload for a keyword's latest run."""
    items = query_keyword_rows(
        dynamodb.Table(SEARCH_RESULTS_TABLE),
        keyword,
        _METRICS_PROJECTION,
    )
    if not items:
        return {'error': 'No data found for keyword'}
    if total_providers is None:
        total_providers = get_enabled_provider_count()
    return calculate_keyword_visibility(
        keyword,
        items,
        total_providers,
        query_prompt_id=query_prompt_id,
    )


def get_scope_visibility_metrics(scope: ReportScope, config: dict[str, Any], query_prompt_id: str | None = None) -> dict[str, Any]:
    """Group summary: per-keyword metrics in parallel, then averaged.

    Keywords without any analysis result are reported but excluded from the
    averages, so a freshly added keyword does not drag a hotel's score to zero.
    """
    total_providers = get_enabled_provider_count()
    keywords = list(scope.keywords)[:_SCOPE_KEYWORDS_CAP]

    def compute(keyword: str) -> dict[str, Any]:
        try:
            return get_visibility_metrics(keyword, config, query_prompt_id=query_prompt_id, total_providers=total_providers)
        except Exception as exc:  # one broken partition must not sink the group
            logger.warning(f"Visibility metrics failed for {keyword!r}: {exc}")
            return {'error': str(exc)}

    per_keyword: list[dict[str, Any]] = []
    if keywords:
        with ThreadPoolExecutor(max_workers=min(_SCOPE_MAX_WORKERS, len(keywords))) as pool:
            per_keyword = list(pool.map(compute, keywords))

    summary = summarize_group_visibility(keywords, per_keyword, total_providers)
    return {
        'scope': scope.describe(),
        'total_providers': total_providers,
        'keywords_truncated': len(scope.keywords) > len(keywords),
        **summary,
    }


@api_handler
@validate({
    **SCOPE_QUERY_PARAMS,
    'brand': {'type': str, 'max_length': 200},
    'query_prompt_id': {'type': str, 'max_length': 100},
})
def handler(event, context, brand=None, query_prompt_id=None, **scope_params):
    """
    API handler for visibility metrics.

    Query params (exactly one scope):
        - keyword: one keyword — the single-keyword response
        - group_id: every active keyword of a keyword group — group summary
        - keyword_ids: comma-separated keyword ids — group summary
    Optional:
        - brand: Filter to specific brand (single keyword only)
        - query_prompt_id: Filter to specific persona
    """
    report_scope, rejected = scope_from_request(event, scope_params, dynamodb.Table(KEYWORDS_TABLE), required=True)
    if rejected:
        return rejected

    config = get_brand_config()
    if report_scope.is_single_keyword:
        metrics = get_visibility_metrics(report_scope.keywords[0], config, query_prompt_id=query_prompt_id)
        # Filter to specific brand if requested
        if brand and 'brands' in metrics:
            metrics['brands'] = [
                b for b in metrics['brands']
                if brand.lower() in b['name'].lower()
            ]
        return success_response(metrics, event)

    return success_response(get_scope_visibility_metrics(report_scope, config, query_prompt_id=query_prompt_id), event)
