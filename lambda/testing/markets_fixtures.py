"""Markets shared by the suites of the market-aware handlers (``shared.markets``)."""

from __future__ import annotations

from typing import Any

from shared.markets import Market, validate_market

CHILE: dict[str, Any] = {
    'market_id': 'cl-es',
    'name': 'Chile (Spanish)',
    'country': 'CL',
    'country_name': 'Chile',
    'language': 'es-CL',
    'language_name': 'Spanish',
    'currency': 'CLP',
    'timezone': 'America/Santiago',
    'city': 'Santiago',
    'lat': -33.45,
    'lng': -70.66,
    'competitors': ['Sky Airline'],
}
"""A full market as the API takes it (``validate_market`` input)."""

BRAZIL: dict[str, Any] = {
    'market_id': 'br-pt',
    'name': 'Brazil (Portuguese)',
    'country': 'BR',
    'country_name': 'Brazil',
    'language': 'pt-BR',
    'language_name': 'Portuguese',
    'currency': 'BRL',
    'timezone': 'America/Sao_Paulo',
}
"""A market with only the required fields."""


def markets_item(*markets: dict[str, Any], updated_at: str = '2026-10-01T09:00:00Z') -> dict[str, Any]:
    """The BrandConfig ``markets`` item holding ``markets``, as ``get_item`` returns it."""
    return {'config_id': 'markets', 'markets': [dict(market) for market in markets], 'updated_at': updated_at}


def valid_market(raw: dict[str, Any]) -> Market:
    """``raw`` as the ``Market`` it validates to; a fixture that does not validate is a test bug, not a case."""
    market, error = validate_market(raw)
    if market is None:
        msg = f'fixture market is not valid: {error}'
        raise AssertionError(msg)
    return market
