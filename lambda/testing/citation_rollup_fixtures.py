"""Test doubles for the Citations reads and the citation rollup (``shared.citation_rollup*``)."""

from __future__ import annotations

import io
import threading
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass, field
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from shared.citation_rollup_build import RollupSources, build_rollup
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
    """``GET /api/citations`` on ``module`` over ``citations_table``, scopes resolving to ``active_keywords``.

    The brand config is empty (no brands, no ``updated_at``) whatever the environment.
    """
    resource = fake_dynamodb_resource(fake_table(), by_name={'test-keywords': fake_table(query={'Items': active_keywords})})
    with (
        patch.object(module, 'dynamodb', resource),
        patch.object(module, 'citations_table', citations_table),
        patch.object(module, '_get_tracked_brands', return_value=[]),
        patch.object(module, '_brand_config', return_value={}),
    ):
        event = api_gateway_event('GET', '/api/citations', query=dict(query or {}))
        return parse_response(module.handler(event, context))


@dataclass
class FakeS3:
    """An in-memory S3 bucket: put/get/list/delete the way the rollup builder and reader call them.

    ``reads`` records every ``get_object`` key; ``failing_keys`` raise a 500 on read.
    """

    objects: dict[str, bytes] = field(default_factory=dict)
    reads: list[str] = field(default_factory=list)
    failing_keys: set[str] = field(default_factory=set)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def put_object(self, **params: Any) -> dict[str, Any]:
        with self._lock:
            self.objects[params['Key']] = params['Body']
        return {}

    def get_object(self, **params: Any) -> dict[str, Any]:
        key = params['Key']
        with self._lock:
            self.reads.append(key)
        if key in self.failing_keys:
            raise ClientError({'Error': {'Code': 'InternalError', 'Message': key}}, 'GetObject')
        if key not in self.objects:
            raise ClientError({'Error': {'Code': 'NoSuchKey', 'Message': key}}, 'GetObject')
        return {'Body': io.BytesIO(self.objects[key])}

    def delete_objects(self, **params: Any) -> dict[str, Any]:
        for item in params['Delete']['Objects']:
            self.objects.pop(item['Key'], None)
        return {}

    def get_paginator(self, _operation: str) -> FakeS3:
        return self

    def paginate(self, **params: Any) -> Iterator[dict[str, Any]]:
        prefix, delimiter = params['Prefix'], params.get('Delimiter')
        keys = sorted(key for key in self.objects if key.startswith(prefix))
        if delimiter is None:
            yield {'Contents': [{'Key': key} for key in keys]}
            return
        tails = {key[len(prefix):] for key in keys}
        prefixes = sorted({prefix + tail.split(delimiter, 1)[0] + delimiter for tail in tails if delimiter in tail})
        yield {'CommonPrefixes': [{'Prefix': name} for name in prefixes]}


ROLLUP_BUCKET = 'citation-analysis-keywords-123456789012'


def rollup_keywords(count: int, *, groups: Mapping[int, set[str]] | None = None, markets: Mapping[int, str] | None = None) -> list[dict[str, Any]]:
    """Active Keywords rows ``keyword 000`` ... with the given group sets and markets (by keyword index)."""
    rows = []
    for index in range(count):
        row: dict[str, Any] = {'id': f'k{index}', 'keyword': f'keyword {index:03d}'}
        if groups and index in groups:
            row['group_ids'] = set(groups[index])
        if markets and index in markets:
            row['market_id'] = markets[index]
        rows.append(row)
    return rows


def rollup_sources(
    rows: list[dict[str, Any]], active: list[dict[str, Any]], s3: FakeS3, brand_config: Mapping[str, Any] | None = None,
) -> RollupSources:
    """``RollupSources`` over in-memory tables and ``s3``."""
    return RollupSources(
        citations_table=SegmentedTable(rows, max_page_rows=200),
        keywords_table=fake_table(query={'Items': active}),
        s3=s3,
        bucket=ROLLUP_BUCKET,
        brand_config=dict(brand_config or {}),
    )


def published_rollup(
    rows: list[dict[str, Any]], active: list[dict[str, Any]], brand_config: Mapping[str, Any] | None = None,
) -> dict[str, bytes]:
    """The objects of one rollup build over ``rows`` and ``active``."""
    s3 = FakeS3()
    build_rollup(rollup_sources(rows, active, s3, brand_config))
    return dict(s3.objects)


def rollup_bucket_fixture():
    """A fixture yielding a fresh ``FakeS3`` holding the module's ``published`` fixture (assign it to the fixture name)."""

    @pytest.fixture
    def _bucket(published: dict[str, bytes]) -> FakeS3:
        return FakeS3(objects=dict(published))

    return _bucket


#: 30 keywords x 100 URLs folded onto 2,500 distinct URLs: three 'all' chunks per scope.
ROLLUP_TEST_ROWS = citation_rows(keywords=30, urls_per_keyword=100, shared_urls=2_500)
