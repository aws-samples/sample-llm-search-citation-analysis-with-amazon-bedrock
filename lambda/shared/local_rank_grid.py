"""Local rank grid: where one business ranks on Google Maps across a square grid of points around a centre.

Points: row 0 is the north edge and the order is row-major (``index = row * size + col``); each step is
``spacing_km`` converted to degrees (``110.574`` km per degree of latitude, ``111.32 * cos(lat)`` per degree of
longitude, the cosine floored at 0.01 so a point near a pole stays finite), rounded to 7 decimals.

Zoom: one zoom for every point, ``floor(log2(24045 * cos(lat) / spacing_km))`` clamped to 4-18, so each
point's map spans about one grid cell. Without a zoom DataForSEO infers one per point, which yields "No Search
Results" at some points and ranks that cannot be compared; a fixed close zoom spans only about +-1.5 km, so a
business ranked 3rd can vanish at one zoom and reappear at the next.

Per point: the business's rank (``None`` = not in the top ``RANK_GRID_DEPTH``), the number of results and the top
result. A ``None`` rank with a full result set means outranked; with a near-empty one it means a sparse map.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from shared.dataforseo_local_serp import (
    MAX_ZOOM,
    MIN_ZOOM,
    BusinessTarget,
    business_identity,
    item_rank,
    match_business,
)

KM_PER_DEGREE_LATITUDE = 110.574
KM_PER_DEGREE_LONGITUDE = 111.32
MIN_LONGITUDE_COSINE = 0.01
ZOOM_NUMERATOR_KM = 24045
RANK_GRID_DEPTH = 20
GRID_SIZES = (3, 5, 7)
MIN_SPACING_KM = 0.25
MAX_SPACING_KM = 10.0
COORDINATE_DECIMALS = 7


@dataclass(frozen=True)
class GridPoint:
    index: int
    row: int
    col: int
    latitude: float
    longitude: float


def _longitude_cosine(latitude: float) -> float:
    return max(abs(math.cos(math.radians(latitude))), MIN_LONGITUDE_COSINE)


def grid_points(latitude: float, longitude: float, size: int, spacing_km: float) -> list[GridPoint]:
    """``size * size`` points centred on the coordinate, row-major from the north-west corner."""
    lat_step = spacing_km / KM_PER_DEGREE_LATITUDE
    lng_step = spacing_km / (KM_PER_DEGREE_LONGITUDE * _longitude_cosine(latitude))
    middle = (size - 1) // 2
    return [
        GridPoint(
            index=row * size + col,
            row=row,
            col=col,
            latitude=round(latitude + (middle - row) * lat_step, COORDINATE_DECIMALS),
            longitude=round(longitude + (col - middle) * lng_step, COORDINATE_DECIMALS),
        )
        for row in range(size)
        for col in range(size)
    ]


def grid_zoom(latitude: float, spacing_km: float) -> int:
    """The Maps zoom at which one map spans about one grid cell."""
    zoom = math.floor(math.log2(ZOOM_NUMERATOR_KM * _longitude_cosine(latitude) / spacing_km))
    return min(MAX_ZOOM, max(MIN_ZOOM, zoom))


def _point_base(point: GridPoint) -> dict[str, Any]:
    return {'index': point.index, 'row': point.row, 'col': point.col,
            'latitude': point.latitude, 'longitude': point.longitude}


def point_result(point: GridPoint, items: Sequence[Mapping[str, Any]], target: BusinessTarget) -> dict[str, Any]:
    """A collected point: the business's rank (or ``None``), the result count and the top result."""
    match = match_business(items, target)
    top = items[0] if items else None
    return {
        **_point_base(point),
        'status': 'ready',
        'rank': item_rank(match) if match is not None else None,
        'results_count': len(items),
        'top_result': {'title': top.get('title'), 'cid': top.get('cid')} if top is not None else None,
        'matched': business_identity(match) if match is not None else None,
    }


def unresolved_point(point: GridPoint, status: str, message: str | None = None) -> dict[str, Any]:
    """A point still ``pending`` or ``failed`` (a failed point may still have been billed)."""
    return {**_point_base(point), 'status': status, 'rank': None, 'results_count': None, 'top_result': None,
            'matched': None, **({'message': message} if message else {})}


def grid_summary(points: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Searched / found counts, the average rank over found points (2 decimals) and the first matched business."""
    searched = [point for point in points if point['status'] == 'ready']
    ranks = [point['rank'] for point in searched if isinstance(point['rank'], int)]
    matched = next((point['matched'] for point in searched if point['matched'] is not None), None)
    return {
        'points_total': len(points),
        'points_searched': len(searched),
        'points_failed': sum(1 for point in points if point['status'] == 'failed'),
        'points_found': len(ranks),
        'average_rank': round(sum(ranks) / len(ranks), 2) if ranks else None,
        'top3_count': sum(1 for rank in ranks if rank <= 3),
        'top10_count': sum(1 for rank in ranks if rank <= 10),
        'matched_business': matched,
    }


__all__ = [
    'GRID_SIZES',
    'MAX_SPACING_KM',
    'MIN_SPACING_KM',
    'RANK_GRID_DEPTH',
    'GridPoint',
    'grid_points',
    'grid_summary',
    'grid_zoom',
    'point_result',
    'unresolved_point',
]
