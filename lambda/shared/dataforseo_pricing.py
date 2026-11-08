"""DataForSEO price estimates: USD upper bounds per call.

Raw DataForSEO USD **upper bounds** for one call, computed from its input before the call is made. Every
number must be >= what DataForSEO actually bills for that input (the real figure is ``task['cost']``):
overestimating refuses a call slightly early, underestimating lets spend past a budget. Prices were read
from the per-account ``price`` table of the free ``GET /v3/appendix/user_data`` (Sep 2026); re-check
them against ``POST /v3/<api>/id_list``, not a one-off fixture.

``serp_usd`` clamps the depth to 10-100 itself rather than leaving it to each call site, so no caller can
price a depth DataForSEO would reject.
"""

from __future__ import annotations

import math
import re
from typing import Literal

# DataForSEO Labs: per task + per returned row, doubled with include_clickstream_data.
LABS_TASK_USD = 0.012
LABS_ROW_USD = 0.00012

GOOGLE_ADS_LIVE_TASK_USD = 0.09
"""Keywords Data Google Ads, live mode: flat per task (search_volume, keywords_for_keywords)."""

# SERP Google Organic: billed per page of 10 results; each extra page is 75 % of the first.
LIVE_BASE_PAGE_COST_USD = 0.002
LIVE_EXTRA_PAGE_COST_USD = 0.0015
QUEUED_BASE_PAGE_COST_USD = 0.0006
QUEUED_EXTRA_PAGE_COST_USD = 0.00045

SERP_MIN_DEPTH = 10
SERP_MAX_DEPTH = 100

# Google Organic bills 5x when the keyword contains an advanced search operator. The docs say "contains", so
# match anywhere: a false match only over-estimates.
_SERP_OPERATOR_KEYWORD = re.compile(
    r'(allinanchor|allintext|allintitle|allinurl|cache|define|definition|filetype|id|inanchor|info|intext'
    r'|intitle|inurl|link|site):',
    re.IGNORECASE,
)


def labs_usd(rows: int, clickstream: bool = False) -> float:
    """Upper bound for one Labs call returning up to ``rows`` rows."""
    return (LABS_TASK_USD + rows * LABS_ROW_USD) * (2 if clickstream else 1)


def clamp_serp_depth(depth: int) -> int:
    """``depth`` within the 10-100 range DataForSEO accepts."""
    return min(SERP_MAX_DEPTH, max(SERP_MIN_DEPTH, depth))


def cost_per_serp_at_depth(depth: int, method: Literal['live', 'queued']) -> float:
    """DataForSEO cost of one SERP request at a ``depth`` that is a multiple of 10."""
    pages = depth / 10
    if method == 'queued':
        return QUEUED_BASE_PAGE_COST_USD + (pages - 1) * QUEUED_EXTRA_PAGE_COST_USD
    return LIVE_BASE_PAGE_COST_USD + (pages - 1) * LIVE_EXTRA_PAGE_COST_USD


def serp_keyword_cost_multiplier(keyword: str) -> int:
    """5 when ``keyword`` uses a search operator (``site:``, ``intitle:``, ...), else 1."""
    return 5 if _SERP_OPERATOR_KEYWORD.search(keyword) else 1


def serp_usd(depth: int, method: Literal['live', 'queued'], keyword: str = '') -> float:
    """Upper bound for one organic SERP request; a partial page of 10 is billed as a full page."""
    billed_depth = math.ceil(clamp_serp_depth(depth) / 10) * 10
    return cost_per_serp_at_depth(billed_depth, method) * serp_keyword_cost_multiplier(keyword)


__all__ = [
    'GOOGLE_ADS_LIVE_TASK_USD',
    'LABS_ROW_USD',
    'LABS_TASK_USD',
    'clamp_serp_depth',
    'cost_per_serp_at_depth',
    'labs_usd',
    'serp_keyword_cost_multiplier',
    'serp_usd',
]
