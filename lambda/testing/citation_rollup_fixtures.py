"""Test doubles for the Citations reads and the citation rollup (``shared.citation_rollup*``)."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import MagicMock, patch

from testing.dynamodb_stubs import fake_dynamodb_resource, fake_table
from testing.events import api_gateway_event, parse_response
from testing.partition_tables import PagedTable

CITATIONS_KEY: Mapping[str | None, tuple[str, ...]] = {None: ('keyword', 'normalized_url')}


@dataclass
class SegmentedTable:
    """A Citations table that pages like DynamoDB and splits a parallel scan into disjoint segments.

    ``scan(Segment=i, TotalSegments=n)`` pages through every n-th row starting
    at row i; a scan without a segment pages through every row.
    ``on_scan`` runs before each answer (a test advancing a fake clock).
    """

    rows: list[dict[str, Any]]
    max_page_rows: int
    on_scan: Callable[[], None] | None = None
    scans: list[dict[str, Any]] = field(default_factory=list)

    def _table(self, rows: list[dict[str, Any]]) -> PagedTable:
        return PagedTable(rows, CITATIONS_KEY, max_page_rows=self.max_page_rows)

    def scan(self, **params: Any) -> dict[str, Any]:
        self.scans.append(dict(params))
        if self.on_scan is not None:
            self.on_scan()
        segments = params.pop('TotalSegments', None)
        segment = params.pop('Segment', None)
        if segments is None or segment is None:
            return self._table(self.rows).scan(**params)
        return self._table(self.rows[segment::segments]).scan(**params)

    def query(self, **params: Any) -> dict[str, Any]:
        return self._table(self.rows).query(**params)


@dataclass
class TickingClock:
    """A clock that moves ``step`` seconds every time it is read."""

    step: float
    now: float = 0.0

    def __call__(self) -> float:
        self.now += self.step
        return self.now


def citation_rows(keywords: int, urls_per_keyword: int, *, shared_urls: int | None = None) -> list[dict[str, Any]]:
    """``keywords`` x ``urls_per_keyword`` Citations rows; ``shared_urls`` folds the URLs onto that many distinct ones."""
    rows = []
    for keyword_index in range(keywords):
        for slot in range(urls_per_keyword):
            url_index = keyword_index * urls_per_keyword + slot
            if shared_urls is not None:
                url_index %= shared_urls
            rows.append({
                'keyword': f'keyword {keyword_index:03d}',
                'normalized_url': f'https://site-{url_index % 7}.example/page/{url_index}',
                'citation_count': 1 + url_index % 5,
                'citing_providers': ['openai', 'gemini'][: 1 + url_index % 2],
                'content_type': 'video' if url_index % 9 == 0 else 'page',
                'original_urls': [f'https://site-{url_index % 7}.example/page/{url_index}?utm=1'],
            })
    return rows


def lambda_context(remaining_ms: int) -> MagicMock:
    """A Lambda context with ``remaining_ms`` milliseconds left."""
    context = MagicMock()
    context.get_remaining_time_in_millis.return_value = remaining_ms
    return context


def get_citations(
    module: Any, citations_table: Any, query: Mapping[str, str] | None, *,
    active_keywords: list[dict[str, Any]], context: Any = None,
) -> tuple[int, Any]:
    """``GET /api/citations`` on ``module`` over ``citations_table``, scopes resolving to ``active_keywords``, no brands."""
    resource = fake_dynamodb_resource(fake_table(), by_name={'test-keywords': fake_table(query={'Items': active_keywords})})
    with (
        patch.object(module, 'dynamodb', resource),
        patch.object(module, 'citations_table', citations_table),
        patch.object(module, '_get_tracked_brands', return_value=[]),
    ):
        event = api_gateway_event('GET', '/api/citations', query=dict(query or {}))
        return parse_response(module.handler(event, context))
