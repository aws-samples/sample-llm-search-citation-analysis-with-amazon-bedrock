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
            'get-historical-trends.py', 'get_all_keywords_trends'
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

def _top_movers(
    keyword_trends: list[dict[str, Any]],
    direction: str,
    limit: int,
) -> list[dict[str, Any]]:
    """
    Pick the top N movers in the given direction.

    `direction` is 'up' for biggest improvers (largest positive change) or
    'down' for biggest decliners (largest negative change, returned with
    sign preserved so the consumer can format as-is).
    """
    if direction == 'up':
        candidates = [k for k in keyword_trends if k.get('change', 0) > 0]
        candidates.sort(key=lambda k: k['change'], reverse=True)
    else:
        candidates = [k for k in keyword_trends if k.get('change', 0) < 0]
        candidates.sort(key=lambda k: k['change'])
    return candidates[:limit]


def build_overview(
    config: dict[str, Any],
    period: str,
    days: int,
    top: int,
    scope: ReportScope | None = None,
) -> dict[str, Any]:
    """
    Compose the overview payload from existing aggregations.

    Pulls cross-keyword trends + rule-based recommendations and reshapes
    them into a single payload tailored for the Executive Summary report.
    ``scope`` (a keyword group or id set) narrows both to its keywords; by
    default every active keyword is covered. Any error in the trends
    sub-call propagates up to the api_handler decorator and becomes a 500.
    """
    trends = _trends_helper()(config, period=period, days=days, scope=scope)
    keyword_trends = trends.get('keyword_trends', []) or []
    overall = trends.get('overall', {}) or {}

    avg_score = float(overall.get('avg_score', 0) or 0)

    # The "previous_score" approximation: subtract the average per-keyword
    # change from the current average. This matches what the user sees as
    # the headline movement on the dashboard. If we had a true previous
    # snapshot we'd use it; today this is the best signal available
    # without rerunning per-keyword history aggregation.
    if keyword_trends:
        avg_change = round(
            sum(k.get('change', 0) for k in keyword_trends) / len(keyword_trends),
            1,
        )
    else:
        avg_change = 0.0
    previous_score = round(avg_score - avg_change, 1)
    change_percent = round(
        (avg_change / previous_score * 100) if previous_score > 0 else 0.0,
        1,
    )

    # Trend direction is derived from the headline movement. The threshold
    # mirrors get-historical-trends' `get_trend_direction` (slope > 2).
    if avg_change > 2:
        trend_direction = 'improving'
    elif avg_change < -2:
        trend_direction = 'declining'
    else:
        trend_direction = 'stable'

    recommendations = _recs_helper()(config, keywords=list(scope.keywords) if scope is not None else None) or []
    top_recommendations = recommendations[:top]

    return {
        'generated_at': get_timestamp(),
        'scope': trends.get('scope'),
        'period_type': period,
        'days_analyzed': days,
        'keywords_analyzed': trends.get('keywords_analyzed', 0),
        'overall_score': round(avg_score, 1),
        'previous_score': previous_score,
        'change': avg_change,
        'change_percent': change_percent,
        'trend_direction': trend_direction,
        'summary': {
            'improving_count': overall.get('improving_count', 0),
            'declining_count': overall.get('declining_count', 0),
            'stable_count': overall.get('stable_count', 0),
        },
        'top_improving': _top_movers(keyword_trends, 'up', top),
        'top_declining': _top_movers(keyword_trends, 'down', top),
        'top_recommendations': top_recommendations,
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
