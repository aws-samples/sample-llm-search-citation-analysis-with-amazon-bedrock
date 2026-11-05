"""
Serve ``GET /api/citations`` pages from the citation rollup (``shared.citation_rollup``).

``RollupReader.lookup`` decides whether the published build may answer a
scope: it must cover the scope, its keyword-set fingerprint must match the
keywords the request resolved, and it must have been built with the brand
config's current ``updated_at`` (``brand_stats`` depend on it). Otherwise the
handler answers from the live, bounded read and ``request_rebuild`` starts an
asynchronous build, at most once per ``REBUILD_DEBOUNCE_SECONDS`` (an
in-memory guard plus the ``rebuild-requested.json`` marker shared by every
container).

``RollupReader.page`` answers one page:

- the base order (most cited first, optionally one content type): the
  manifest plus the one or two chunks the page falls in, O(page);
- any other order or filter: the scope's compact ``entries`` file, sorted
  and filtered in memory with ``shared.citation_pages.CitationQuery`` and
  cached per container by build, so the next page, sort click or keystroke
  costs no S3 read.

Every object is immutable once published (a new build has new keys), so the
caches never serve stale bytes; only ``current.json`` is re-read, every
``POINTER_TTL_SECONDS``.
"""

from __future__ import annotations

import json
import logging
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from botocore.exceptions import BotoCoreError, ClientError

from shared.citation_pages import CitationQuery, TopUrl, list_entry
from shared.citation_rollup import (
    BUILD_ACTION,
    CHUNK_SIZE,
    COMPACT_VIEW,
    CURRENT_KEY,
    REBUILD_MARKER_KEY,
    chunk_count,
    chunk_key,
    decode_json,
    entries_key,
    expand_entry,
    is_missing_object,
    manifest_key,
)
from shared.cursors import encode_offset_cursor
from shared.response_budget import take_within_budget

logger = logging.getLogger(__name__)

POINTER_TTL_SECONDS = 30.0
REBUILD_DEBOUNCE_SECONDS = 300.0
_ENTRIES_CACHE_SIZE = 2
_SMALL_CACHE_SIZE = 64

#: Errors of a rollup read; the handler answers from the live read instead.
ROLLUP_READ_ERRORS = (ClientError, BotoCoreError, ValueError, KeyError, TypeError, OSError)


class _Lru[ValueT]:
    """A tiny least-recently-used cache."""

    def __init__(self, size: int) -> None:
        self._size = size
        self._items: OrderedDict[str, ValueT] = OrderedDict()

    def get(self, key: str, load: Callable[[], ValueT]) -> ValueT:
        if key in self._items:
            self._items.move_to_end(key)
            return self._items[key]
        value = load()
        self._items[key] = value
        if len(self._items) > self._size:
            self._items.popitem(last=False)
        return value


@dataclass(frozen=True)
class RollupLookup:
    """Whether the published build serves a scope: its scope entry, or why not."""

    scope: dict[str, Any] | None
    built_at: str | None
    stale: bool
    """A build exists but no longer matches the scope's keywords or the brand config."""


@dataclass(frozen=True)
class PageRequest:
    query: CitationQuery
    start: int
    limit: int
    include_keywords: bool


class RollupReader:
    """Reads one bucket's published rollup; one per container."""

    def __init__(
        self, s3: Any, bucket: str, *, lambda_client: Any = None, function_name: str | None = None,
        clock: Callable[[], float] = time.monotonic, wall_clock: Callable[[], float] = time.time,
    ) -> None:
        self._s3 = s3
        self._bucket = bucket
        self._lambda = lambda_client
        self._function_name = function_name
        self._clock = clock
        self._wall_clock = wall_clock
        self._current: tuple[float, dict[str, Any] | None] | None = None
        self._last_rebuild: float | None = None
        self._manifests: _Lru[dict[str, Any]] = _Lru(_SMALL_CACHE_SIZE)
        self._chunks: _Lru[list[TopUrl]] = _Lru(_SMALL_CACHE_SIZE)
        self._entries: _Lru[dict[str, Any]] = _Lru(_ENTRIES_CACHE_SIZE)

    def _get(self, key: str) -> Any:
        return decode_json(self._s3.get_object(Bucket=self._bucket, Key=key)['Body'].read())

    def current(self) -> dict[str, Any] | None:
        """The published ``current.json`` (``None`` before the first build), re-read every ``POINTER_TTL_SECONDS``."""
        now = self._clock()
        if self._current is not None and now - self._current[0] < POINTER_TTL_SECONDS:
            return self._current[1]
        try:
            body = self._s3.get_object(Bucket=self._bucket, Key=CURRENT_KEY)['Body'].read()
        except ClientError as error:
            if not is_missing_object(error):
                raise
            current = None
        else:
            current = json.loads(body)
        self._current = (now, current if isinstance(current, dict) else None)
        return self._current[1]

    def lookup(self, key: str, fingerprint: str | None, brand_updated_at: Any) -> RollupLookup:
        """Whether the published build serves scope ``key`` resolved to ``fingerprint`` under the current brand config."""
        current = self.current()
        if current is None:
            return RollupLookup(None, None, stale=False)
        scope = (current.get('scopes') or {}).get(key)
        brand_matches = current.get('brand_config_updated_at') == brand_updated_at
        if scope is None or scope.get('fingerprint') != fingerprint or not brand_matches:
            return RollupLookup(None, current.get('built_at'), stale=True)
        return RollupLookup(scope, current.get('built_at'), stale=False)

    def _base_order_page(self, path: str, manifest: dict[str, Any], request: PageRequest) -> tuple[list[TopUrl], int]:
        content_type = request.query.content_type
        total = int(manifest['counts'][content_type])
        end = min(total, request.start + request.limit)
        window: list[TopUrl] = []
        for index in range(request.start // CHUNK_SIZE, min(chunk_count(total), -(-end // CHUNK_SIZE))):
            key = chunk_key(path, content_type, index)
            chunk = self._chunks.get(key, lambda key=key: self._get(key))
            offset = index * CHUNK_SIZE
            window.extend(chunk[max(0, request.start - offset):max(0, end - offset)])
        return [list_entry(entry, request.include_keywords) for entry in window], total

    def _queried_page(self, path: str, request: PageRequest) -> tuple[list[TopUrl], int]:
        key = entries_key(path)
        entries = self._entries.get(key, lambda: self._get(key))
        matching = request.query.apply(entries['entries'], COMPACT_VIEW)
        window = matching[request.start:request.start + request.limit]
        keywords = entries['keywords']
        return [expand_entry(row, keywords, request.include_keywords) for row in window], len(matching)

    def page(self, scope: dict[str, Any], request: PageRequest) -> dict[str, Any]:
        """The response fields of one page of a scope the build serves (totals, page, cursor)."""
        path = str(scope['path'])
        manifest_path = manifest_key(path)
        manifest = self._manifests.get(manifest_path, lambda: self._get(manifest_path))
        if request.query.is_base_order:
            window, matched = self._base_order_page(path, manifest, request)
        else:
            window, matched = self._queried_page(path, request)
        page, _ = take_within_budget(window)
        return {
            **manifest['totals'],
            'matched_urls': matched,
            'top_urls': page,
            'next_token': encode_offset_cursor(request.start + len(page), matched),
            'truncated': False,
        }

    def _recently_requested(self) -> bool:
        try:
            marker = self._get_marker()
        except ROLLUP_READ_ERRORS:
            logger.exception('Could not read the citation rollup rebuild marker')
            return False
        requested_at = marker.get('requested_at') if isinstance(marker, dict) else None
        return isinstance(requested_at, (int, float)) and self._wall_clock() - requested_at < REBUILD_DEBOUNCE_SECONDS

    def _get_marker(self) -> Any:
        try:
            body = self._s3.get_object(Bucket=self._bucket, Key=REBUILD_MARKER_KEY)['Body'].read()
        except ClientError as error:
            if is_missing_object(error):
                return None
            raise
        return json.loads(body)

    def request_rebuild(self, reason: str) -> bool:
        """Start an asynchronous build unless one was requested in the last ``REBUILD_DEBOUNCE_SECONDS``."""
        if self._lambda is None or not self._function_name:
            return False
        now = self._clock()
        if self._last_rebuild is not None and now - self._last_rebuild < REBUILD_DEBOUNCE_SECONDS:
            return False
        self._last_rebuild = now
        if self._recently_requested():
            return False
        try:
            self._s3.put_object(
                Bucket=self._bucket, Key=REBUILD_MARKER_KEY, ContentType='application/json',
                Body=json.dumps({'requested_at': self._wall_clock(), 'reason': reason}).encode('utf-8'),
            )
            self._lambda.invoke(
                FunctionName=self._function_name, InvocationType='Event',
                Payload=json.dumps({'action': BUILD_ACTION, 'reason': reason}).encode('utf-8'),
            )
        except (ClientError, BotoCoreError):
            logger.exception('Could not start a citation rollup rebuild (%s)', reason)
            return False
        logger.info('Citation rollup rebuild requested: %s', reason)
        return True
