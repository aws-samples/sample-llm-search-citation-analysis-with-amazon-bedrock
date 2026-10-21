"""Following ``next_token`` through a paginated route, for pagination and volume tests.

Every paginated route answers a page plus ``next_token`` (``None`` on the last
page) and refuses a token it did not issue with the same 400. Tests that pin
"following ``next_token`` returns every row exactly once" walk the pages with
``follow_next_token`` and compare the refusal with ``INVALID_NEXT_TOKEN``.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from typing import Any

from testing.events import parse_response
from testing.response_size import assert_within_page_budget

#: ``(status, body)`` of a route refusing a malformed or foreign ``next_token``.
INVALID_NEXT_TOKEN = (400, {'error': 'Invalid next_token', 'field': 'next_token'})


def minute_stamp(index: int) -> str:
    """A ``created_at`` one minute after row ``index - 1``'s, from 2026-09-01 (unique for 30 days of rows)."""
    return f'2026-09-{1 + index // 1440:02d}T{index // 60 % 24:02d}:{index % 60:02d}:00Z'


def follow_next_token[T](
    fetch: Callable[[dict[str, str]], Mapping[str, Any]],
    query: Mapping[str, str],
    items: Callable[[Any], Iterable[T]],
    *,
    max_pages: int = 500,
    within_page_budget: bool = False,
) -> list[T]:
    """Everything ``items`` picks from every page, from ``query`` to the last ``next_token``.

    ``fetch`` answers one query string with the proxy response. Every page
    must answer 200 (and, with ``within_page_budget``, fit the page budget);
    a token that never runs out within ``max_pages`` pages fails the test.
    """
    collected: list[T] = []
    token: str | None = None
    for _page in range(max_pages):
        response = fetch({**query, **({'next_token': token} if token else {})})
        status, body = parse_response(response)
        assert status == 200, f'page answered {status}: {body}'
        if within_page_budget:
            assert_within_page_budget(response)
        collected.extend(items(body))
        token = body['next_token']
        if token is None:
            return collected
    raise AssertionError(f'next_token never ran out in {max_pages} pages')
