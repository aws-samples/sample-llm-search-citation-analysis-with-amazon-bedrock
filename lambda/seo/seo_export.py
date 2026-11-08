"""Paid "Export to Excel" of the DataForSEO-paged SEO tables (Domain Overview keywords/pages, Backlinks tabs).

A request of those tables may carry ``offset`` (0..9999) and ``limit`` (1..1000) instead of ``page``/``page_size``:
DataForSEO then answers ``limit`` rows from ``offset``. One request returns at most 1000 rows and offset paging is
recommended only up to 10,000 rows, so ``offset + limit`` must be at most ``EXPORT_MAX_ROWS`` (400 on ``limit``).
Every answer of those tables carries ``export``: the limits and the per-request / per-row prices the dashboard
prices an export with.

The server export (``shared.export_source_seo_paid``) asks those windows through the SEO router. When a chunk asks
again a window an earlier chunk already read (it resumes inside it), it sends ``cached_only: true``: the route then
answers from its cache, or 409 ``NOT_CACHED`` without calling DataForSEO, so the same rows are never paid twice.

Shipped next to the sub-handlers (the SEO router's asset), imported as ``seo_export``.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from seo_http import RequestFieldError, seo_error

EXPORT_MAX_ROWS = 10_000
EXPORT_ROWS_PER_REQUEST = 1000

OFFSET_FIELD: dict[str, Any] = {'type': int, 'min': 0, 'max': EXPORT_MAX_ROWS - 1}
LIMIT_FIELD: dict[str, Any] = {'type': int, 'min': 1, 'max': EXPORT_ROWS_PER_REQUEST}
CACHED_ONLY_FIELD: dict[str, Any] = {'type': bool, 'default': False}
EXPORT_SCHEMA: dict[str, dict[str, Any]] = {'offset': OFFSET_FIELD, 'limit': LIMIT_FIELD, 'cached_only': CACHED_ONLY_FIELD}

NOT_CACHED_CODE = 'NOT_CACHED'
NOT_CACHED_MESSAGE = (
    'These rows are no longer cached, and an export never pays for the same rows twice. '
    'Start the export again to see its price.'
)


class ExportWindowError(RequestFieldError):
    """The request's ``offset``/``limit`` cannot be served; ``field`` names the field at fault."""


class NotCachedError(Exception):
    """A ``cached_only`` request whose rows are not cached: answered 409 ``NOT_CACHED``, nothing is paid."""


def not_cached_response(event: dict[str, Any]) -> dict[str, Any]:
    """The 409 of a ``cached_only`` request the cache cannot answer."""
    return seo_error(409, NOT_CACHED_CODE, NOT_CACHED_MESSAGE, event)


@dataclass(frozen=True)
class RowWindow:
    """The rows one request asks DataForSEO for: a page, or an export chunk (``limit`` given)."""

    offset: int
    limit: int
    exported: bool

    @property
    def cache_key(self) -> dict[str, int]:
        """The window's cache key part: ``page``/``page_size`` of a page (keys as before exports), else offset/limit."""
        if self.exported:
            return {'offset': self.offset, 'limit': self.limit}
        return {'page': self.offset // self.limit + 1, 'page_size': self.limit}

    def echo(self) -> dict[str, int | None]:
        """``offset``/``limit`` as asked; ``None`` on a page answer."""
        if self.exported:
            return {'offset': self.offset, 'limit': self.limit}
        return {'offset': None, 'limit': None}


def _whole_number(body: Mapping[str, Any], name: str) -> None:
    """Refuse what ``@validate``'s ``int()`` would silently turn into a number (``true`` → 1, ``2.5`` → 2)."""
    value = body.get(name)
    if isinstance(value, bool) or (isinstance(value, float) and not value.is_integer()):
        raise ExportWindowError(f'{name} must be a whole number', name)


def row_window(body: Mapping[str, Any], *, page: int, page_size: int, offset: int | None,
               limit: int | None) -> RowWindow:
    """The window of a request whose ``offset``/``limit`` passed ``EXPORT_SCHEMA``; ``offset`` alone is ignored."""
    _whole_number(body, 'offset')
    _whole_number(body, 'limit')
    if limit is None:
        return RowWindow(offset=(page - 1) * page_size, limit=page_size, exported=False)
    start = offset or 0
    if start + limit > EXPORT_MAX_ROWS:
        raise ExportWindowError(f'offset + limit must be at most {EXPORT_MAX_ROWS}', 'limit')
    return RowWindow(offset=start, limit=limit, exported=True)


def export_pricing(request_usd: float, row_usd: float, cache_seconds: int) -> dict[str, Any]:
    """The ``export`` block of an answer: limits, the endpoint's per-request and per-row prices, and how long a
    window stays cached (an export of the same rows within ``cache_hours`` is free)."""
    return {
        'max_rows': EXPORT_MAX_ROWS, 'rows_per_request': EXPORT_ROWS_PER_REQUEST,
        'request_usd': request_usd, 'row_usd': row_usd, 'cache_hours': cache_seconds // 3600,
    }
