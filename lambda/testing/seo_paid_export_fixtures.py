"""Test support for the paid SEO export sources (``shared.export_source_seo_paid``): a fake SEO table route."""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field, replace
from typing import Any

from shared.export_source_routes import RouteRequest, route_event
from shared.export_source_seo_paid import PricedSource

NOT_CACHED = {'error': 'These rows are no longer cached', 'code': 'NOT_CACHED'}


def keyword_row(number: int) -> dict[str, Any]:
    """Ranked keyword ``number`` of the fake list (``kw-<number>``)."""
    return {
        'keyword': f'kw-{number}', 'intent': 'commercial', 'position': 1, 'organic_position': 1, 'search_volume': 10,
        'etv': 1.5, 'cpc': 0.4, 'keyword_difficulty': 20, 'url': f'https://example.com/{number}', 'relative_url': None,
    }


@dataclass
class FakeSeoTable:
    """
    A paged SEO table route (``POST`` with ``offset``/``limit`` or ``page``/``page_size``), recording every request.

    It answers ``total`` rows built by ``row``; ``cached`` holds the windows it
    has answered (``(offset, limit)``), and a ``cached_only`` request for any
    other window is 409 ``NOT_CACHED``, as the SEO routes answer it.
    """

    total: int
    items_key: str = 'items'
    requests: list[RouteRequest] = field(default_factory=list)
    cached: set[tuple[int, int]] = field(default_factory=set)
    paid: list[tuple[int, int]] = field(default_factory=list)

    def _window(self, body: Mapping[str, Any]) -> tuple[int, int]:
        if 'limit' in body:
            return int(body.get('offset') or 0), int(body['limit'])
        page_size = int(body.get('page_size') or 50)
        return (int(body.get('page') or 1) - 1) * page_size, page_size

    def __call__(self, request: RouteRequest) -> tuple[int, Any]:
        self.requests.append(request)
        body = dict(request.body or {})
        window = self._window(body)
        if window not in self.cached:
            if body.get('cached_only') is True:
                return 409, NOT_CACHED
            self.paid.append(window)
            self.cached.add(window)
        offset, limit = window
        numbers = range(offset, min(offset + limit, self.total))
        return 200, {self.items_key: [keyword_row(number) for number in numbers], 'has_more': offset + limit < self.total}

    @property
    def bodies(self) -> list[dict[str, Any]]:
        return [dict(request.body or {}) for request in self.requests]


def through(source: PricedSource, invoker: Any) -> PricedSource:
    """``source`` with both of its readings calling ``invoker`` instead of the SEO router Lambda."""
    return replace(source, priced=replace(source.priced, invoker=invoker), screen=replace(source.screen, invoker=invoker))


@dataclass
class MemoryCache:
    """``seo_http.get_cached`` / ``put_cached`` over a dict: what a route stores, it answers until ``clear()``."""

    entries: dict[str, Any] = field(default_factory=dict)

    @staticmethod
    def _key(namespace: str, version: int, params: Mapping[str, Any]) -> str:
        return json.dumps([namespace, version, params], sort_keys=True, default=str)

    def get(self, namespace: str, version: int, params: Mapping[str, Any]) -> Any:
        return self.entries.get(self._key(namespace, version, params))

    def put(self, namespace: str, version: int, params: Mapping[str, Any], payload: Any, _ttl: int) -> None:
        self.entries[self._key(namespace, version, params)] = payload

    def clear(self) -> None:
        self.entries.clear()


def handler_invoker(handler: Callable[[dict[str, Any], Any], Mapping[str, Any]]) -> Callable[[RouteRequest], tuple[int, Any]]:
    """An export route invoker calling a loaded SEO sub-handler with the event the export worker would send."""
    def invoke(request: RouteRequest) -> tuple[int, Any]:
        response = handler(route_event(request), {})
        return int(response['statusCode']), json.loads(response['body'])

    return invoke
