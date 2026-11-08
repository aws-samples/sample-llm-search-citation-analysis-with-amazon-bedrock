"""
Request parsing of the local SEO routes (``seo-local.py``): business identity, coordinates, targets, markets.

Everything here runs before any paid call, so a request DataForSEO would reject (and still bill) is refused
with 400 ``VALIDATION_ERROR`` instead:

* a business is named by exactly one of ``name``, ``cid`` or ``place_id``;
* a coordinate needs both ``latitude`` and ``longitude`` (finite); without one, the market's city coordinates
  are used when the market has them;
* the result-matching target (``cid``, ``place_id``, ``domain``, ``name``) defaults to the brand's own domains.

Shipped next to the sub-handlers (the SEO router's asset), imported as ``local_requests``.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import seo_http

from shared.dataforseo_business import BusinessIdentifier, IdentifierError, Near
from shared.dataforseo_local_serp import BusinessTarget
from shared.dataforseo_locations import MarketCodes
from shared.markets import Market

MAX_NAME_CHARS = 200
MAX_CID_CHARS = 64
MAX_PLACE_ID_CHARS = 256
MAX_DOMAIN_CHARS = 253
MAX_CATEGORIES = 10
MAX_CATEGORY_CHARS = 100
DEFAULT_RADIUS_KM = 10.0

#: ``@validate`` entries shared by several routes.
NAME_FIELD: dict[str, Any] = {'type': str, 'max_length': MAX_NAME_CHARS}
CID_FIELD: dict[str, Any] = {'type': str, 'max_length': MAX_CID_CHARS}
PLACE_ID_FIELD: dict[str, Any] = {'type': str, 'max_length': MAX_PLACE_ID_CHARS}
DOMAIN_FIELD: dict[str, Any] = {'type': str, 'max_length': MAX_DOMAIN_CHARS}
LATITUDE_FIELD: dict[str, Any] = {'type': float, 'min': -90, 'max': 90}
LONGITUDE_FIELD: dict[str, Any] = {'type': float, 'min': -180, 'max': 180}

IDENTITY_SCHEMA: dict[str, dict[str, Any]] = {
    'name': NAME_FIELD, 'cid': CID_FIELD, 'place_id': PLACE_ID_FIELD,
}
POINT_SCHEMA: dict[str, dict[str, Any]] = {
    'latitude': LATITUDE_FIELD, 'longitude': LONGITUDE_FIELD, 'market_id': seo_http.MARKET_ID_FIELD,
}


class LocalRequestError(seo_http.RequestFieldError):
    """A local request that cannot be sent; ``field`` names the offending request field."""


#: Answer ``LocalRequestError`` (on its own field) and ``IdentifierError`` as 400 ``VALIDATION_ERROR``.
local_errors = seo_http.validation_errors({LocalRequestError: None, IdentifierError: 'name'})


@dataclass(frozen=True)
class LocalMarket:
    market_id: str
    market: Market | None
    codes: MarketCodes


def local_market(market_id: str | None) -> LocalMarket:
    resolved_id, market = seo_http.resolve_market(market_id)
    return LocalMarket(market_id=resolved_id, market=market, codes=seo_http.market_codes(market))


def identifier(name: str | None, cid: str | None, place_id: str | None) -> BusinessIdentifier:
    """Exactly one of the three, blank values ignored; raises ``IdentifierError``."""
    return BusinessIdentifier(name=(name or '').strip() or None, cid=(cid or '').strip() or None,
                              place_id=(place_id or '').strip() or None)


def _finite(value: float | None, field: str) -> float | None:
    if value is not None and not math.isfinite(value):
        raise LocalRequestError(f'{field} must be a finite number', field)
    return value


def explicit_near(latitude: float | None, longitude: float | None, radius_km: float | None) -> Near | None:
    """The requested coordinate, or ``None`` when neither part is given; one part alone is refused."""
    lat, lng = _finite(latitude, 'latitude'), _finite(longitude, 'longitude')
    if lat is None and lng is None:
        return None
    if lat is None or lng is None:
        raise LocalRequestError('latitude and longitude go together', 'latitude' if lat is None else 'longitude')
    return Near(latitude=lat, longitude=lng, radius_km=radius_km or DEFAULT_RADIUS_KM)


def required_near(latitude: float | None, longitude: float | None, radius_km: float | None,
                  market: LocalMarket) -> Near:
    """The requested coordinate, else the market's city; refused when there is neither."""
    near = explicit_near(latitude, longitude, radius_km)
    if near is not None:
        return near
    city = market.market
    if city is not None and city.lat is not None and city.lng is not None:
        return Near(latitude=float(city.lat), longitude=float(city.lng), radius_km=radius_km or DEFAULT_RADIUS_KM)
    raise LocalRequestError('Give a latitude and longitude, or set the market city coordinates', 'latitude')


def near_json(near: Near | None) -> dict[str, float] | None:
    if near is None:
        return None
    return {'latitude': near.latitude, 'longitude': near.longitude, 'radius_km': near.radius_km}


def owned_domains() -> tuple[str, ...]:
    domains = seo_http.brand_config().get('first_party_domains')
    return tuple(domain for domain in domains if isinstance(domain, str) and domain) if isinstance(domains, list) else ()


def target(cid: str | None, place_id: str | None, domain: str | None, name: str | None) -> BusinessTarget:
    """The business to find in the results; with nothing given, the brand's own domains."""
    requested = BusinessTarget(cid=(cid or '').strip() or None, place_id=(place_id or '').strip() or None,
                               domains=((domain.strip(),) if domain and domain.strip() else ()),
                               name=(name or '').strip() or None)
    return BusinessTarget(domains=owned_domains()) if requested.is_empty else requested


def target_json(value: BusinessTarget) -> dict[str, Any]:
    return {'cid': value.cid, 'place_id': value.place_id, 'domains': list(value.domains), 'name': value.name}


def categories(value: object) -> tuple[str, ...]:
    """0..10 category slugs, trimmed and deduplicated in order."""
    if value is None:
        return ()
    if not isinstance(value, list) or not all(isinstance(entry, str) for entry in value):
        raise LocalRequestError('categories must be an array of strings', 'categories')
    cleaned = list(dict.fromkeys(entry.strip() for entry in value if entry.strip()))
    if len(cleaned) > MAX_CATEGORIES or any(len(entry) > MAX_CATEGORY_CHARS for entry in cleaned):
        raise LocalRequestError(f'categories takes up to {MAX_CATEGORIES} names of {MAX_CATEGORY_CHARS} characters',
                                'categories')
    return tuple(cleaned)
