"""In-memory doubles for the scope snapshots (design 2.45.0): conditional S3 objects and a stored build.

``ConditionalS3`` is a bucket with S3's ETags and conditional requests, the
way KeywordLatest writes (``If-Match`` on the ETag read), view-job starts
(``If-None-Match: *``) and readers (``IfNoneMatch`` on GET) use them. Every
call is recorded, so a volume test asserts read counts instead of wall time.

``FakeSnapshotArtifacts`` is one stored build of one scope as
``ArtifactBuilder.serve`` reads it; build it from ``fold_scope``'s output to
test a builder end to end without the S1 store.
"""

from __future__ import annotations

import hashlib
import io
import threading
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from botocore.exceptions import ClientError

from shared.partial_contract import KeywordLatest, Partial


def _client_error(code: str, operation: str, key: str) -> ClientError:
    # boto3 puts the HTTP status of a bare 304 / 404 in the code, as here.
    return ClientError({'Error': {'Code': code, 'Message': key}}, operation)


def _etag(body: bytes) -> str:
    # S3's ETag of a single-part upload: the quoted MD5 of the body.
    return '"' + hashlib.md5(body, usedforsecurity=False).hexdigest() + '"'


@dataclass
class ConditionalS3:
    """One S3 bucket in memory: ``put_object`` / ``get_object`` / ``head_object`` / ``delete_object`` with ETags.

    - ``put_object(IfMatch=etag)`` writes only over that version; ``IfNoneMatch='*'``
      only when the key is absent; otherwise ``PreconditionFailed`` (412).
    - ``get_object(IfMatch=etag)`` answers 412 for another version and
      ``IfNoneMatch=etag`` answers ``304`` for the same one.
    - A missing key is ``NoSuchKey`` (``get``) or ``404`` (``head``).

    ``gets``, ``puts`` and ``heads`` record the keys of each call in order.
    """

    objects: dict[str, tuple[bytes, str]] = field(default_factory=dict)
    gets: list[str] = field(default_factory=list)
    puts: list[str] = field(default_factory=list)
    heads: list[str] = field(default_factory=list)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def etag_of(self, key: str) -> str | None:
        """The current ETag of ``key``, or ``None`` when it is absent (no call is recorded)."""
        with self._lock:
            stored = self.objects.get(key)
        return None if stored is None else stored[1]

    def put_object(self, **params: Any) -> dict[str, Any]:
        key, body = params['Key'], params['Body']
        data = body if isinstance(body, bytes) else str(body).encode('utf-8')
        with self._lock:
            self.puts.append(key)
            current = self.objects.get(key)
            if_match, if_none_match = params.get('IfMatch'), params.get('IfNoneMatch')
            if if_match is not None and (current is None or current[1] != if_match):
                raise _client_error('PreconditionFailed', 'PutObject', key)
            if if_none_match == '*' and current is not None:
                raise _client_error('PreconditionFailed', 'PutObject', key)
            etag = _etag(data)
            self.objects[key] = (data, etag)
        return {'ETag': etag}

    def _stored(self, calls: list[str], key: str, operation: str, missing_code: str) -> tuple[bytes, str]:
        """The object at ``key`` (its call recorded in ``calls``); ``missing_code`` when there is none."""
        with self._lock:
            calls.append(key)
            stored = self.objects.get(key)
        if stored is None:
            raise _client_error(missing_code, operation, key)
        return stored

    def get_object(self, **params: Any) -> dict[str, Any]:
        key = params['Key']
        data, etag = self._stored(self.gets, key, 'GetObject', 'NoSuchKey')
        if params.get('IfMatch') not in (None, etag):
            raise _client_error('PreconditionFailed', 'GetObject', key)
        if params.get('IfNoneMatch') == etag:
            raise _client_error('304', 'GetObject', key)
        return {'Body': io.BytesIO(data), 'ETag': etag, 'ContentLength': len(data)}

    def head_object(self, **params: Any) -> dict[str, Any]:
        data, etag = self._stored(self.heads, params['Key'], 'HeadObject', '404')
        return {'ETag': etag, 'ContentLength': len(data)}

    def delete_object(self, **params: Any) -> dict[str, Any]:
        with self._lock:
            self.objects.pop(params['Key'], None)
        return {}


@dataclass
class FakeSnapshotArtifacts:
    """One stored build of one scope (``shared.snapshot_artifacts.SnapshotArtifacts``).

    ``artifacts`` maps artifact keys to their decoded objects (``fold_scope``'s
    output); ``loads`` records every key ``load`` was asked for.
    """

    artifacts: Mapping[str, Any]
    keywords_total: int
    build_id: str = 'build-0001'
    built_at: str = '2026-10-05T07:12:00Z'
    stale: bool = False
    refreshing: bool = False
    keywords_behind: int = 0
    loads: list[str] = field(default_factory=list)

    def load(self, key: str) -> Any | None:
        self.loads.append(key)
        return self.artifacts.get(key)


@dataclass(frozen=True)
class KeywordListBuilder:
    """An ``ArtifactBuilder`` that stores the scope's keywords in fold order: a stand-in for the real builders.

    ``serve`` answers the stored list under ``key`` with the request's
    ``params``, or ``None`` when the build does not hold ``key``.
    """

    name: str = 'keyword-list'
    key: str = 'keywords'

    def fold(self, acc: list[str] | None, latest: Mapping[str, Any], scope: Any) -> list[str]:
        del scope
        return [*(acc or []), str(latest['keyword'])]

    def finalize(self, acc: list[str] | None) -> dict[str, Any]:
        return {self.key: {'keywords': acc or []}}

    def serve(self, artifacts: Any, params: Mapping[str, Any]) -> dict[str, Any] | None:
        stored = artifacts.load(self.key)
        return None if stored is None else {**stored, 'params': dict(params)}


def keyword_latest(keyword: str, timestamp: str = '2026-10-05T06:00:00.000000Z', **parts: Partial | None) -> KeywordLatest:
    """A KeywordLatest object with ``parts`` for the latest run only."""
    return {
        'v': 1, 'keyword': keyword, 'keyword_id': f'id-{keyword}', 'config': 'config-fp',
        'latest': {'timestamp': timestamp, 'parts': dict(parts)}, 'previous': None,
    }
