"""Request parsing and answer shapes of the Domain Overview routes (``seo-domains.py``).

* ``domain_request``: the typed target, its scope and the market, resolved before any paid call. A target
  DataForSEO would bill and fail is 400 ``VALIDATION_ERROR`` on ``target``; a Google-Ads-only market is
  400 ``UNSUPPORTED_MARKET`` (Labs does not serve it).
* ``keyword_filters`` / ``page_filters``: the ``filters`` object of a request. Terms are strings of at most
  ``MAX_TERM_CHARS``; bounds are finite numbers >= 0. Unknown fields are refused, so a typo never silently
  widens the result. The 8-condition budget is checked when the expression is built
  (``FilterBudgetError`` → 400 on ``filters``, the request is refused rather than truncated). An export window
  (``seo_export``) DataForSEO cannot serve is 400 on its own field.

Shipped next to the sub-handlers (the SEO router's asset), imported as ``seo_domain_requests``.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import asdict, dataclass, fields
from typing import Any, cast

import seo_http
from seo_export import ExportWindowError

from shared.dataforseo_domain import KeywordFilters, PageFilters, RankedKeyword, SerpCompetitor, TopPage, require_labs
from shared.dataforseo_domain_scope import (
    SCOPES,
    FilterBudgetError,
    InvalidTargetError,
    ResearchTarget,
    parse_research_target,
)
from shared.dataforseo_locations import MarketCodes
from shared.string_lists import bounded_text

MAX_TERM_CHARS = 200
MAX_TARGET_CHARS = 2048

TARGET_FIELD: dict[str, Any] = {'required': True, 'type': str, 'min_length': 1, 'max_length': MAX_TARGET_CHARS}
SCOPE_FIELD: dict[str, Any] = {'type': str, 'choices': list(SCOPES)}
PAGE_FIELD: dict[str, Any] = {'type': int, 'min': 1, 'max': 200, 'default': 1}
PAGE_SIZE_FIELD: dict[str, Any] = {'type': int, 'choices': [50, 100], 'default': 50}
ORDER_FIELD: dict[str, Any] = {'type': str, 'choices': ['asc', 'desc'], 'default': 'desc'}
SEARCH_FIELD: dict[str, Any] = {'type': str, 'max_length': MAX_TERM_CHARS}
FILTERS_FIELD: dict[str, Any] = {'type': dict}


class InvalidFiltersError(ValueError):
    """The request's ``filters`` object is malformed; ``str(error)`` says how."""


#: Answer an unusable target, filter set or export window as 400 ``VALIDATION_ERROR`` on its field.
domain_errors = seo_http.validation_errors(
    {InvalidTargetError: 'target', InvalidFiltersError: 'filters', FilterBudgetError: 'filters', ExportWindowError: None},
)


@dataclass(frozen=True)
class DomainRequest:
    target: ResearchTarget
    market_id: str
    codes: MarketCodes


def market_for_labs(market_id: str | None) -> tuple[str, MarketCodes]:
    """``(market_id, codes)`` of a market Labs serves; raises before any paid call otherwise."""
    resolved_id, market = seo_http.resolve_market(market_id)
    codes = seo_http.market_codes(market)
    require_labs(codes)
    return resolved_id, codes


def domain_request(target: str, scope: str | None, market_id: str | None) -> DomainRequest:
    """The parsed target in a Labs market."""
    parsed = parse_research_target(target, scope if scope in SCOPES else None)
    resolved_id, codes = market_for_labs(market_id)
    return DomainRequest(target=parsed, market_id=resolved_id, codes=codes)


def target_json(request: DomainRequest) -> dict[str, Any]:
    target = request.target
    return {'target': target.display, 'hostname': target.hostname, 'scope': target.scope, 'path': target.path,
            'market_id': request.market_id}


def cache_params(request: DomainRequest, **extra: Any) -> dict[str, Any]:
    """Cache key parameters: target, scope, path and market codes, plus the page's own options."""
    return {
        'hostname': request.target.hostname, 'scope': request.target.scope, 'path': request.target.path,
        'location_code': request.codes.location_code, 'language_code': request.codes.language_code, **extra,
    }


# ---------------------------------------------------------------------------
# Filters
# ---------------------------------------------------------------------------

def _term(name: str, value: object) -> str | None:
    error = InvalidFiltersError(f'filters.{name} must be text of at most {MAX_TERM_CHARS} characters')
    return bounded_text(value, MAX_TERM_CHARS, error)


def _bound(name: str, value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value) or value < 0:
        raise InvalidFiltersError(f'filters.{name} must be a number of 0 or more')
    return value


def _parsed[T](kind: type[T], value: object) -> T:
    if value is None:
        return kind()
    if not isinstance(value, Mapping):
        raise InvalidFiltersError('filters must be an object')
    names = {item.name for item in fields(cast('Any', kind))}
    unknown = sorted(str(key) for key in value if key not in names)
    if unknown:
        raise InvalidFiltersError(f'Unknown filter: {unknown[0]}')
    parsed = {
        name: _term(name, value.get(name)) if name in ('include', 'exclude') else _bound(name, value.get(name))
        for name in names
    }
    return kind(**parsed)


def keyword_filters(value: object) -> KeywordFilters:
    return _parsed(KeywordFilters, value)


def page_filters(value: object) -> PageFilters:
    return _parsed(PageFilters, value)


def filters_json(filters: KeywordFilters | PageFilters) -> dict[str, Any]:
    """The set filters only (a stable cache key part)."""
    return {name: value for name, value in asdict(filters).items() if value is not None}


# ---------------------------------------------------------------------------
# Rows
# ---------------------------------------------------------------------------

def ranked_keyword_json(row: RankedKeyword) -> dict[str, Any]:
    return asdict(row)


def top_page_json(row: TopPage) -> dict[str, Any]:
    return asdict(row)


def competitor_json(row: SerpCompetitor) -> dict[str, Any]:
    return asdict(row)


def by_visibility(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Highest visibility first, unknown visibility last, then domain."""
    return sorted(rows, key=lambda row: (row['visibility'] is None, -(row['visibility'] or 0.0), row['domain']))
