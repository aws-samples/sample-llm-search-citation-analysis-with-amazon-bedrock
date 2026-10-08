"""
A market reaches each search provider as its native country/language parameters.

Search providers take no instructions: the keyword is searched as typed, with
the provider's own locale fields (``shared.markets`` mappers). Without a
market every request is exactly the pre-markets one, pinned in
``test_search_http_clients.py`` / ``test_search_clients.py``.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock, patch

import pytest

import search_clients
from search_clients import BraveSearchClient, ExaSearchClient, FirecrawlSearchClient, SerpAPIClient, TavilySearchClient
from testing.provider_response_fixtures import build_market

_QUERY = 'aerolínea Altiplano opiniones'


def _sent_request(client_class: type, method: str, market: Any) -> dict[str, Any]:
    """The ``json`` body (POST) or ``params`` (GET) one search sent through ``requests.<method>``."""
    response = MagicMock(status_code=200)
    response.json.return_value = {}
    with patch.object(search_clients.requests, method, return_value=response) as send:
        client_class('key-1').search(_QUERY, market)
    return send.call_args.kwargs['params' if method == 'get' else 'json']


class TestBraveMarket:
    def test_searches_from_the_markets_country_in_its_language(self):
        params = _sent_request(BraveSearchClient, 'get', build_market())

        assert params == {'q': _QUERY, 'count': 10, 'text_decorations': False, 'country': 'CL', 'search_lang': 'es'}

    def test_names_portuguese_with_its_region(self):
        market = build_market(country='BR', country_name='Brazil', language='pt-BR', language_name='Portuguese',
                              currency='BRL', timezone='America/Sao_Paulo')

        assert _sent_request(BraveSearchClient, 'get', market)['search_lang'] == 'pt-br'


class TestTavilyMarket:
    def test_boosts_the_markets_country_and_asks_in_its_language(self):
        body = _sent_request(TavilySearchClient, 'post', build_market())

        assert (body['country'], body['language'], body['query']) == ('chile', 'es', _QUERY)

    def test_sends_no_country_tavily_does_not_list(self):
        market = build_market(country='XK', country_name='Kosovo', language='sq', language_name='Albanian',
                              currency='EUR', timezone='Europe/Belgrade')

        assert 'country' not in _sent_request(TavilySearchClient, 'post', market)


class TestExaMarket:
    def test_searches_from_the_markets_country(self):
        body = _sent_request(ExaSearchClient, 'post', build_market())

        assert (body['userLocation'], body['query']) == ('CL', _QUERY)


class TestFirecrawlMarket:
    def test_searches_from_the_markets_city_and_country_in_its_language(self):
        body = _sent_request(FirecrawlSearchClient, 'post', build_market())

        assert body == {'query': _QUERY, 'limit': 10, 'country': 'CL', 'lang': 'es', 'location': 'Santiago,Chile'}


class TestSerpAPIMarket:
    @pytest.mark.parametrize(('market', 'locale'), [
        (None, {'hl': 'en', 'gl': 'us'}),
        (build_market(), {'hl': 'es', 'gl': 'cl'}),
    ], ids=['global', 'chile'])
    def test_asks_google_from_the_markets_country_in_its_language(self, market, locale):
        with patch.object(search_clients, 'serpapi_search', return_value={}) as serpapi_search:
            SerpAPIClient('serp-key').search(_QUERY, market)

        assert serpapi_search.call_args.args == ('serp-key', {'q': _QUERY, 'engine': 'google', 'num': 10, **locale})
