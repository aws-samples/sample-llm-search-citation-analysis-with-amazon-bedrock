"""
Export sources of the trend views (``GET /api/trends``): S4 brand trends, S7 trend periods, S8 keyword trends.

Each reads the route with the view's scope, market and window (``period``,
``days``): the summary body holds every period of ``trend_data``;
``view=keyword_trends`` pages every keyword's move and ``view=brand_series``
every brand of the window with its KPIs per period (2.45.0 wave 5), one row
per brand and period that names it.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from shared.export_source_routes import SINGLE, Column, Paging, RouteList, RouteSource, columns, kpi_columns
from shared.export_source_visibility import SCOPE_PARAMS, SCOPED_PARTIAL
from shared.kpi_engine import KPI_IDS

_ROUTER, _PATH = 'stats-insights', '/api/trends'
_PARAMS = (*SCOPE_PARAMS, 'period', 'days')
_PAGED = Paging(limit_param=None)


def _brand_points(item: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    """One row per period of a ``brand_series`` brand."""
    points = item.get('points')
    rows = points if isinstance(points, list) else []
    return [{'name': item.get('name'), 'classification': item.get('classification'), **point} for point in rows if isinstance(point, Mapping)]


TREND_PERIODS = RouteSource(
    'trend-periods',
    (RouteList(
        'Periods', (*columns('period', 'runs', 'keywords_with_data'), *kpi_columns()),
        _ROUTER, _PATH, 'trend_data', SINGLE, partial_flags=SCOPED_PARTIAL,
    ),),
    params=_PARAMS,
)

KEYWORD_TRENDS = RouteSource(
    'keyword-trends',
    (RouteList(
        'Keywords',
        (
            *columns('keyword', 'period'), *kpi_columns(), Column('previous_period', 'change.previous_period'),
            *(Column(f'change_{kpi}', f'change.deltas.{kpi}') for kpi in KPI_IDS),
        ),
        _ROUTER, _PATH, 'keyword_trends', _PAGED, {'view': 'keyword_trends'}, partial_flags=SCOPED_PARTIAL,
    ),),
    params=_PARAMS,
)

BRAND_TRENDS = RouteSource(
    'brand-trends',
    (RouteList(
        'Brands over time', columns('name', 'classification', 'period', 'share_of_voice', 'mention_rate', 'visibility_score', 'average_position'),
        _ROUTER, _PATH, 'brand_series', _PAGED, {'view': 'brand_series'}, partial_flags=SCOPED_PARTIAL, rows_of=_brand_points,
    ),),
    params=_PARAMS,
)

SOURCES_OF_TRENDS: tuple[RouteSource, ...] = (TREND_PERIODS, KEYWORD_TRENDS, BRAND_TRENDS)
