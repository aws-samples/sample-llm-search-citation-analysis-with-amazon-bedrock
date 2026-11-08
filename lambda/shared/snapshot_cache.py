"""
A container-wide cache of decoded snapshot objects (artifacts and series), keyed by their S3 key.

Every object a published build or a series names is immutable (a new build
writes new keys), so a decoded object stays valid for the container's life.
Without the cache each request reads and decodes its artifact again: an
export paging an 8 MB recommendations artifact 200 rows at a time did 100
GET + gunzip + parse rounds. The cache holds the most recently used objects
up to ``CACHE_JSON_BYTES`` of decoded JSON (the Python objects take about 3x
that, ~200 MB), and never an object larger than ``MAX_OBJECT_JSON_BYTES``.

Cached objects are shared by every request of the container: callers must
treat what ``get`` returns as read-only (the serve paths build new bodies
around it, they never change it).
"""

from __future__ import annotations

import gzip
import json
import threading
from collections import OrderedDict
from typing import Any

from botocore.exceptions import ClientError

from shared.snapshot_store import is_missing_object

#: Decoded JSON, in bytes, the cache keeps at most (the objects take ~3x that in memory).
CACHE_JSON_BYTES = 64 * 1024 * 1024
#: An object larger than this (decoded JSON) is read every time, never cached.
MAX_OBJECT_JSON_BYTES = 24 * 1024 * 1024


class SnapshotObjectCache:
    """A thread-safe LRU of decoded gzip-JSON objects, bounded by their decoded JSON size."""

    def __init__(self, budget: int = CACHE_JSON_BYTES, max_object: int = MAX_OBJECT_JSON_BYTES) -> None:
        self._budget = budget
        self._max_object = max_object
        self._entries: OrderedDict[tuple[str, str], tuple[Any, int]] = OrderedDict()
        self._size = 0
        self._lock = threading.Lock()

    @property
    def size(self) -> int:
        """The decoded JSON bytes held."""
        return self._size

    def get(self, s3: Any, bucket: str, key: str) -> Any | None:
        """The decoded object at ``key`` (from the cache when held); ``None`` when there is none (not cached)."""
        cache_key = (bucket, key)
        with self._lock:
            entry = self._entries.get(cache_key)
            if entry is not None:
                self._entries.move_to_end(cache_key)
                return entry[0]
        try:
            body = s3.get_object(Bucket=bucket, Key=key)['Body'].read()
        except ClientError as error:
            if is_missing_object(error):
                return None
            raise
        raw = gzip.decompress(body)
        value = json.loads(raw)
        self._keep(cache_key, value, len(raw))
        return value

    def _keep(self, cache_key: tuple[str, str], value: Any, size: int) -> None:
        if size > self._max_object:
            return
        with self._lock:
            previous = self._entries.pop(cache_key, None)
            if previous is not None:
                self._size -= previous[1]
            self._entries[cache_key] = (value, size)
            self._size += size
            while self._size > self._budget and self._entries:
                _, (_, dropped) = self._entries.popitem(last=False)
                self._size -= dropped

    def clear(self) -> None:
        with self._lock:
            self._entries.clear()
            self._size = 0


#: This container's cache.
OBJECT_CACHE = SnapshotObjectCache()


__all__ = ['CACHE_JSON_BYTES', 'MAX_OBJECT_JSON_BYTES', 'OBJECT_CACHE', 'SnapshotObjectCache']
