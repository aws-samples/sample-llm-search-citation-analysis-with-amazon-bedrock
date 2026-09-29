"""
Reports Overview Aggregator API

Pre-computed cross-keyword summary used by the Executive Summary print
report and the Brand Visibility all-keywords variant. Combines:

- Cross-keyword visibility trend rollup (top movers, improving/declining
  counts, 30-day overall change) from the historical-trends logic.
- Top rule-based recommendations from the recommendations logic.

Why this endpoint exists rather than the frontend composing /trends and
/recommendations directly:
- Reduces two API round-trips on cold report load to one.
- Lets us downstream-cache a single payload per analysis run.
- Surfaces a stable "executive summary" shape that the Executive Summary
  report can rely on without re-shaping data on the client.

Query params:
  - days (int, 1-365, default 30): trend window for the rollup.
  - period (day|week|month, default day): aggregation grain.
  - top (int, 1-10, default 3): how many top movers and recommendations
    to surface in each list. Three is the print-friendly default.
"""

from __future__ import annotations

import logging
import sys
from collections.abc import Callable
from typing import Any

# Shared layer path (populated by the Lambda layer at /opt/python)
sys.path.insert(0, '/opt/python')

import boto3

from shared.api_response import success_response
from shared.decorators import api_handler, validate
from shared.kpi_engine import owned_domains_from
from shared.scope_params import (
    SCOPE_QUERY_PARAMS,
    ReportScope,
    keywords_table_name,
    load_sibling_function,
    scope_from_request,
)
from shared.utils import get_brand_config, get_timestamp

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')
KEYWORDS_TABLE = keywords_table_name()


# ----------------------------------------------------------------------
# Sibling-module helper loading
# ----------------------------------------------------------------------
#
# The trend-rollup and rule-based-recommendations logic lives in
# `get-historical-trends.py` and `get-recommendations.py`. Their filenames
# are hyphenated so they can't be imported with a normal `import`
# statement; `shared.scope_params.load_sibling_function` loads them the
# way `shared.router`'s HandlerLoader loads handlers, but for top-level
# utility functions.
#
# Loading happens once per Lambda container. The cost is paid on the first
# invocation only.


def _load_sibling(filename: str, attr: str) -> Callable:
    """Import a function from a hyphen-named sibling .py file."""
    return load_sibling_function(__file__, filename, attr, '_for_overview')


# Lazy cache for sibling helpers. Eager loading at module import time would
# trigger the sibling modules' boto3.resource() calls before the Lambda
# environment is fully bootstrapped (and would make the module hard to
# import in unit tests). The first invocation pays the load cost; every
# subsequent invocation in the same warm container is free.
_sibling_cache: dict[str, Callable] = {}


def _trends_helper() -> Callable:
    if 'trends' not in _sibling_cache:
        _sibling_cache['trends'] = _load_sibling(
            'get-historical-trends.py', 'trends_for_scope'
        )
    return _sibling_cache['trends']


def _recs_helper() -> Callable:
    if 'recs' not in _sibling_cache:
        _sibling_cache['recs'] = _load_sibling(
            'get-recommendations.py', 'generate_rule_based_recommendations'
        )
    return _sibling_cache['recs']


# ----------------------------------------------------------------------
# Aggregation
# ----------------------------------------------------------------------

def _mover(row: dict[str, Any]) -> dict[str, Any]:
    return {
        'keyword': row['keyword'],
        'visibility_score': row['kpis']['visibility_score'],
        'change': row['change']['deltas']['visibility_score'],
    }


def top_movers(keyword_trends: list[dict[str, Any]], limit: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """The ``limit`` keywords whose visibility score rose the most, and those whose score fell the most, since their previous period."""
    changed = [_mover(row) for row in keyword_trends if row.get('change') and row['change']['deltas']['visibility_score'] is not None]
    improvers = sorted((mover for mover in changed if mover['change'] > 0), key=lambda mover: -mover['change'])
    decliners = sorted((mover for mover in changed if mover['change'] < 0), key=lambda mover: mover['change'])
    return improvers[:limit], decliners[:limit]


def build_overview(
    config: dict[str, Any],
    period: str,
    days: int,
    top: int,
    scope: ReportScope | None = None,
) -> dict[str, Any]:
    """
    Compose the Executive Summary payload from the trend view and the recommendations.

    ``kpis`` is every KPI over each keyword's latest period; ``change`` compares
    it with the previous period over the keywords measured in both (``None``
    before a second period). ``summary`` counts keywords by the trend of their
    visibility score. ``scope`` narrows everything to its keywords; by default
    every active keyword is covered.
    """
    trends = _trends_helper()(scope, period, days, owned_domains_from(config))
    top_improving, top_declining = top_movers(trends['keyword_trends'], top)
    recommendations = _recs_helper()(config, keywords=list(scope.keywords) if scope is not None else None) or []

    return {
        'generated_at': get_timestamp(),
        'scope': trends['scope'],
        'period_type': period,
        'days_analyzed': days,
        'keywords_analyzed': trends['keywords_analyzed'],
        'keywords_with_data': trends['keywords_with_data'],
        'citations_configured': trends['citations_configured'],
        'kpis': trends['latest'],
        'change': trends['change'],
        'trend_data': trends['trend_data'],
        'latest_brands': trends['latest_brands'],
        'summary': trends['overall'],
        'top_improving': top_improving,
        'top_declining': top_declining,
        'top_recommendations': recommendations[:top],
    }


# ----------------------------------------------------------------------
# Lambda entry point
# ----------------------------------------------------------------------

@api_handler
@validate({
    'period': {
        'type': str, 'choices': ['day', 'week', 'month'], 'default': 'day',
    },
    'days': {'type': int, 'min': 1, 'max': 365, 'default': 30},
    'top': {'type': int, 'min': 1, 'max': 10, 'default': 3},
    **SCOPE_QUERY_PARAMS,
})
def handler(
    event: dict[str, Any],
    context: Any,
    period: str = 'day',
    days: int = 30,
    top: int = 3,
    **scope_params: str | None,
) -> dict[str, Any]:
    """API handler for GET /api/reports/overview.

    Optional scope: ``group_id`` or ``keyword_ids`` narrows the summary to a
    keyword group / id set. A single ``keyword`` is one keyword's summary.
    """
    report_scope, rejected = scope_from_request(event, scope_params, dynamodb.Table(KEYWORDS_TABLE))
    if rejected:
        return rejected
    config = get_brand_config()
    payload = build_overview(config, period=period, days=days, top=top, scope=report_scope)
    return success_response(payload, event)
