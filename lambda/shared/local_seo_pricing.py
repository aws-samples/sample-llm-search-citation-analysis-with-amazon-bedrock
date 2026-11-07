"""DataForSEO price estimates (USD upper bounds) for the business listings, Google Business and local SERP calls.

Read from the free ``GET /v3/appendix/user_data`` price table and measured ``id_list`` costs (Sep 2026).
The reviews and updates tasks are posted at priority 2, which doubles the standard-queue rate; both are
included here. The reviews estimate is approximate: it is not yet calibrated against billed tasks, so the
dashboard labels it that way. Collecting a queued task (``task_get``) and listing categories are free.
"""

from __future__ import annotations

import math

LISTINGS_SEARCH_TASK_USD = 0.012
LISTINGS_SEARCH_ROW_USD = 0.00036
BUSINESS_INFO_USD = 0.0054
"""``my_business_info/live``: flat, the cheapest way to check that a profile exists."""
QUESTIONS_PER_20_USD = 0.0054
"""``questions_and_answers/live``: billed per 20 questions (measured: $0.0054 at depth 10 and 20, $0.027 at 100)."""
REVIEWS_TASK_USD = 0.001
REVIEWS_PER_10_USD = 0.0015
UPDATES_TASK_USD = 0.003
UPDATES_PER_10_USD = 0.0015
MAPS_LIVE_USD = 0.002
"""``serp/google/maps/live/advanced``: one request bills the same through depth 100."""
LOCAL_FINDER_PER_10_USD = 0.002
MAPS_QUEUED_POINT_USD = 0.0012
"""One priority-2 ``serp/google/maps/task_post`` entry (one rank-grid point)."""


def listings_search_usd(limit: int) -> float:
    """``business_listings/search/live`` for ``limit`` rows."""
    return round(LISTINGS_SEARCH_TASK_USD + limit * LISTINGS_SEARCH_ROW_USD, 6)


def questions_usd(depth: int) -> float:
    return round(math.ceil(depth / 20) * QUESTIONS_PER_20_USD, 6)


def reviews_usd(depth: int) -> float:
    """Approximate: not yet calibrated against billed tasks."""
    return round(REVIEWS_TASK_USD + math.ceil(depth / 10) * REVIEWS_PER_10_USD, 6)


def updates_usd(depth: int) -> float:
    return round(UPDATES_TASK_USD + math.ceil(depth / 10) * UPDATES_PER_10_USD, 6)


def local_serp_usd(search_type: str, depth: int) -> float:
    """A live Maps (flat) or Local Finder (per 10 results) request."""
    if search_type == 'maps':
        return MAPS_LIVE_USD
    return round(math.ceil(depth / 10) * LOCAL_FINDER_PER_10_USD, 6)


def rank_grid_usd(points: int) -> float:
    return round(points * MAPS_QUEUED_POINT_USD, 6)


__all__ = [
    'BUSINESS_INFO_USD',
    'listings_search_usd',
    'local_serp_usd',
    'questions_usd',
    'rank_grid_usd',
    'reviews_usd',
    'updates_usd',
]
