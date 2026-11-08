"""
The S3 store every precomputed scope build shares: the citation rollup (``shared.citation_rollup*``) and
the scope snapshot (``shared.scope_snapshot*``).

A store lives under one ``prefix`` of a bucket::

    <prefix>current.json                  the published build (written LAST)
    <prefix><build_id>/...                one directory per build; objects are immutable
    <prefix>rebuild-requested.json        debounce marker of API-triggered rebuilds

What it gives a builder:

- ``SnapshotStore``: ``new_build_id``, ``read_current``, ``publish`` (only when
  no newer build is live; the deadline is checked first, so a build that ran out
  of time raises ``SnapshotBuildIncomplete`` instead of switching the pointer) and
  ``delete_old_builds`` (every build that is neither kept nor younger than
  ``STALE_BUILD_SECONDS``, so a concurrent build is never deleted mid-write).
- ``ParallelWriter``: gzip-JSON PUTs on a thread pool that stop at the deadline.

What it gives a reader:

- ``PointerCache``: ``current.json`` re-read at most every ``POINTER_TTL_SECONDS``.
- ``RebuildRequester``: an asynchronous rebuild at most once per
  ``REBUILD_DEBOUNCE_SECONDS``, guarded in memory and by the marker every
  container shares.

And the scope naming both builds use: scope keys (``all``, ``market:<id>``,
``group:<id>``, ``group:<id>|market:<id>``), their S3-safe directory, and the
keyword-set fingerprint a reader compares to decide whether a build is stale.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import logging
import time
import uuid
from collections import defaultdict, deque
from collections.abc import Callable, Iterable, Iterator, Mapping
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from boto3.dynamodb.conditions import Key
from botocore.exceptions import BotoCoreError, ClientError

from shared.dynamodb_batch import collect_all_items
from shared.keyword_groups import ACTIVE_KEYWORD_STATUS, keyword_group_ids
from shared.markets import keyword_market_id
from shared.request_deadline import current_deadline
from shared.scope_params import ReportScope

logger = logging.getLogger(__name__)

#: A build directory this old, neither current nor previous, is deleted.
STALE_BUILD_SECONDS = 1_800
POINTER_TTL_SECONDS = 30.0
REBUILD_DEBOUNCE_SECONDS = 300.0
#: Concurrent S3 writes of one build.
WRITE_WORKERS = 32

_BUILD_ID_TIME = '%Y%m%dT%H%M%SZ'
_DELETE_BATCH = 1_000

ALL_SCOPE = 'all'

#: Errors of a store read; a reader answers without the build instead.
STORE_READ_ERRORS = (ClientError, BotoCoreError, ValueError, KeyError, TypeError, OSError)


class SnapshotBuildIncomplete(RuntimeError):
    """The build could not read or write everything in time; ``current.json`` was not switched."""


# ---------------------------------------------------------------------------
# Encoding
# ---------------------------------------------------------------------------

def _json_decimal(value: object) -> str:
    """A DynamoDB ``Decimal`` (rows a view job read) as the API sends it (``shared.api_response`` encodes it with ``str``); anything else is not JSON."""
    if isinstance(value, Decimal):
        return str(value)
    raise TypeError(f'Object of type {type(value).__name__} is not JSON serializable')


def encode_json(value: Any) -> bytes:
    return gzip.compress(json.dumps(value, separators=(',', ':'), ensure_ascii=False, default=_json_decimal).encode('utf-8'), compresslevel=5)


def decode_json(body: bytes) -> Any:
    return json.loads(gzip.decompress(body))


def is_missing_object(error: ClientError) -> bool:
    """Whether an S3 ``ClientError`` says the object does not exist."""
    return str(error.response.get('Error', {}).get('Code')) in ('NoSuchKey', '404', 'NotFound')


def is_precondition_failed(error: ClientError) -> bool:
    """Whether an S3 ``ClientError`` is a failed ``If-Match`` / ``If-None-Match`` condition."""
    return str(error.response.get('Error', {}).get('Code')) in ('PreconditionFailed', '412', 'ConditionalRequestConflict')


def get_json(s3: Any, bucket: str, key: str, *, gzipped: bool = True) -> Any | None:
    """The decoded object at ``key``, or ``None`` when there is none."""
    try:
        body = s3.get_object(Bucket=bucket, Key=key)['Body'].read()
    except ClientError as error:
        if is_missing_object(error):
            return None
        raise
    return decode_json(body) if gzipped else json.loads(body)


def utc_iso(moment: datetime) -> str:
    return moment.isoformat().replace('+00:00', 'Z')


# ---------------------------------------------------------------------------
# Scope naming
# ---------------------------------------------------------------------------

def market_scope(market_id: str) -> str:
    return f'market:{market_id}'


def group_scope(group_id: str, market_id: str | None = None) -> str:
    return f'group:{group_id}' if market_id is None else f'group:{group_id}|market:{market_id}'


def named_scope_key(report_scope: ReportScope) -> str | None:
    """The precomputed scope serving ``report_scope``, or ``None`` when none does (one keyword, ids, several groups)."""
    if report_scope.kind == 'all':
        return ALL_SCOPE if report_scope.market_id is None else market_scope(report_scope.market_id)
    if report_scope.kind == 'group':
        group_ids = report_scope.scope.get('group_ids') or []
        return group_scope(str(group_ids[0]), report_scope.market_id) if len(group_ids) == 1 else None
    return None


def scope_dir(key: str) -> str:
    """An S3-safe directory name for a scope key."""
    return hashlib.sha256(key.encode('utf-8')).hexdigest()[:20]


def keyword_fingerprint(keywords: Iterable[str]) -> str:
    """A digest of a keyword set, independent of order and duplicates."""
    digest = hashlib.sha256('\n'.join(sorted(set(keywords))).encode('utf-8'))
    return digest.hexdigest()[:32]


def active_keywords(keywords_table: Any) -> list[dict[str, Any]]:
    """Every active keyword, with only the attributes the scopes need, deduplicated by id."""
    items = collect_all_items(
        keywords_table.query,
        IndexName='StatusIndex',
        KeyConditionExpression=Key('status').eq(ACTIVE_KEYWORD_STATUS),
        ProjectionExpression='#id, #kw, group_ids, market_id',
        ExpressionAttributeNames={'#id': 'id', '#kw': 'keyword'},
    )
    by_id: dict[str, dict[str, Any]] = {}
    for item in items:
        keyword = item.get('keyword')
        if isinstance(keyword, str) and keyword:
            by_id.setdefault(str(item.get('id') or keyword), item)
    return list(by_id.values())


def scope_keywords(active: Iterable[dict[str, Any]]) -> dict[str, set[str]]:
    """The keyword texts of every named scope: ``all``, each market, each group and group x market."""
    scopes: dict[str, set[str]] = defaultdict(set)
    for item in active:
        keyword = item['keyword']
        market = keyword_market_id(item)
        scopes[ALL_SCOPE].add(keyword)
        scopes[market_scope(market)].add(keyword)
        for group_id in keyword_group_ids(item):
            scopes[group_scope(group_id)].add(keyword)
            scopes[group_scope(group_id, market)].add(keyword)
    return dict(scopes)


# ---------------------------------------------------------------------------
# Builds
# ---------------------------------------------------------------------------

def new_build_id(now: datetime) -> str:
    return f'{now.strftime(_BUILD_ID_TIME)}-{uuid.uuid4().hex[:8]}'


def build_time(build_id: str) -> datetime | None:
    """When ``build_id`` was started, or ``None`` for a name that is not a build id."""
    try:
        return datetime.strptime(build_id.split('-', 1)[0], _BUILD_ID_TIME).replace(tzinfo=UTC)
    except ValueError:
        return None


@dataclass(frozen=True)
class SnapshotStore:
    """One store: a bucket and the prefix its builds live under."""

    s3: Any
    bucket: str
    prefix: str
    label: str
    """What the logs and the deadline call this store (``the citation rollup``)."""

    @property
    def current_key(self) -> str:
        return f'{self.prefix}current.json'

    @property
    def marker_key(self) -> str:
        return f'{self.prefix}rebuild-requested.json'

    def build_prefix(self, build_id: str) -> str:
        return f'{self.prefix}{build_id}/'

    def read_current(self) -> dict[str, Any] | None:
        """The published ``current.json``, or ``None`` when there is none."""
        current = get_json(self.s3, self.bucket, self.current_key, gzipped=False)
        return current if isinstance(current, dict) else None

    def publish(self, current: dict[str, Any], previous: dict[str, Any] | None) -> bool:
        """Write ``current.json`` unless a newer build is already live; whether it was written."""
        latest = self.read_current()
        if latest is not None and str(latest.get('built_at', '')) > current['built_at']:
            logger.info('%s %s superseded by %s; not published', self.label, current['build_id'], latest.get('build_id'))
            return False
        if current_deadline().stop_reading(f'the {self.label} switch'):
            raise SnapshotBuildIncomplete('Time budget spent before publishing')
        current['previous_build_id'] = previous.get('build_id') if previous else None
        self.s3.put_object(
            Bucket=self.bucket, Key=self.current_key, Body=json.dumps(current).encode('utf-8'), ContentType='application/json',
        )
        return True

    def list_build_ids(self) -> list[str]:
        """Every directory directly under the prefix that is named like a build."""
        names: list[str] = []
        paginator = self.s3.get_paginator('list_objects_v2')
        for page in paginator.paginate(Bucket=self.bucket, Prefix=self.prefix, Delimiter='/'):
            names.extend(common['Prefix'][len(self.prefix):].rstrip('/') for common in page.get('CommonPrefixes', []))
        return [name for name in names if build_time(name) is not None]

    def delete_prefix(self, prefix: str) -> None:
        paginator = self.s3.get_paginator('list_objects_v2')
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            keys = [{'Key': item['Key']} for item in page.get('Contents', [])]
            for start in range(0, len(keys), _DELETE_BATCH):
                self.s3.delete_objects(Bucket=self.bucket, Delete={'Objects': keys[start:start + _DELETE_BATCH], 'Quiet': True})

    def delete_old_builds(self, keep: set[str], now: datetime) -> list[str]:
        """Delete every build not in ``keep`` and older than ``STALE_BUILD_SECONDS``; the ids deleted."""
        deleted = []
        for build_id in self.list_build_ids():
            built = build_time(build_id)
            if build_id in keep or built is None or (now - built).total_seconds() < STALE_BUILD_SECONDS:
                continue
            self.delete_prefix(self.build_prefix(build_id))
            deleted.append(build_id)
        return deleted


def kept_build_ids(current: dict[str, Any] | None) -> set[str]:
    """The builds a published pointer keeps: the current one and the previous one."""
    if not current:
        return set()
    return {str(build) for build in (current.get('build_id'), current.get('previous_build_id')) if build}


@dataclass(frozen=True)
class BuildRun:
    """One build of a store from start to publication: its id, its start, and the pointer it replaces."""

    store: SnapshotStore
    build_id: str
    built_at: datetime
    previous: dict[str, Any] | None
    started: float

    @classmethod
    def begin(cls, store: SnapshotStore, now: Callable[[], datetime]) -> BuildRun:
        built_at = now()
        return cls(store, new_build_id(built_at), built_at, store.read_current(), time.monotonic())

    def header(self, version: int, brand_config: Mapping[str, Any]) -> dict[str, Any]:
        """The fields every ``current.json`` starts with."""
        return {
            'version': version, 'build_id': self.build_id, 'built_at': utc_iso(self.built_at),
            'brand_config_updated_at': brand_config.get('updated_at'),
        }

    @property
    def keep(self) -> set[str]:
        """The builds that survive this one: itself and the build it replaces."""
        previous_id = (self.previous or {}).get('build_id')
        return {self.build_id} | ({str(previous_id)} if previous_id else set())

    def finish(self, current: dict[str, Any], now: Callable[[], datetime]) -> tuple[bool, list[str]]:
        """Publish ``current`` (unless superseded) and delete old builds; whether it was published and the builds deleted."""
        published = self.store.publish(current, self.previous)
        return published, self.store.delete_old_builds(self.keep, now())

    def seconds(self) -> float:
        return round(time.monotonic() - self.started, 1)


class ParallelWriter:
    """Parallel gzip-JSON PUTs that stop (and make the build incomplete) at the deadline.

    At most ``2 x WRITE_WORKERS`` writes wait at once: ``put`` waits for the
    oldest before queueing more, so a build never holds every scope's
    finalized artifacts while the pool catches up.
    """

    def __init__(self, store: SnapshotStore, incomplete: type[SnapshotBuildIncomplete] = SnapshotBuildIncomplete) -> None:
        self._store = store
        self._incomplete = incomplete
        self._pool = ThreadPoolExecutor(max_workers=WRITE_WORKERS)
        self._pending: deque[Future[None]] = deque()
        self.objects = 0
        self.most_pending = 0

    def put(self, files: Iterable[tuple[str, Any]]) -> None:
        for key, value in files:
            while len(self._pending) >= 2 * WRITE_WORKERS:
                self._pending.popleft().result()
            self._pending.append(self._pool.submit(self._put_one, key, value))
            self.objects += 1
            self.most_pending = max(self.most_pending, len(self._pending))

    def _put_one(self, key: str, value: Any) -> None:
        if current_deadline().stop_reading(f'the {self._store.label} writes'):
            raise self._incomplete(f'Time budget spent before writing {key}')
        self._store.s3.put_object(Bucket=self._store.bucket, Key=key, Body=encode_json(value), ContentType='application/gzip')

    def finish(self) -> None:
        """Wait for every write; the first failure is raised."""
        try:
            for future in self._pending:
                future.result()
        finally:
            self._pool.shutdown(wait=True, cancel_futures=True)


# ---------------------------------------------------------------------------
# Readers
# ---------------------------------------------------------------------------

def bounded_map[T, R](fn: Callable[[T], R], items: Iterable[T], workers: int) -> Iterator[tuple[T, R]]:
    """``(item, fn(item))`` in order, ``workers`` calls at a time and at most ``2 x workers`` results held.

    For a build that reads thousands of objects and folds each as it arrives:
    ``ThreadPoolExecutor.map`` would submit every call at once and buffer every
    result the slower consumer has not taken yet.
    """
    window = max(1, 2 * workers)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        pending: deque[tuple[T, Future[R]]] = deque()
        for item in items:
            pending.append((item, pool.submit(fn, item)))
            if len(pending) >= window:
                done_item, future = pending.popleft()
                yield done_item, future.result()
        while pending:
            done_item, future = pending.popleft()
            yield done_item, future.result()

class PointerCache:
    """``current.json`` of a store, re-read at most every ``POINTER_TTL_SECONDS``."""

    def __init__(self, store: SnapshotStore, clock: Callable[[], float] = time.monotonic) -> None:
        self._store = store
        self._clock = clock
        self._cached: tuple[float, dict[str, Any] | None] | None = None

    def current(self) -> dict[str, Any] | None:
        now = self._clock()
        if self._cached is not None and now - self._cached[0] < POINTER_TTL_SECONDS:
            return self._cached[1]
        current = self._store.read_current()
        self._cached = (now, current)
        return current


@dataclass(frozen=True)
class RebuildTarget:
    """What a rebuild request invokes: the builder Lambda and the event ``action`` it builds for."""

    lambda_client: Any
    function_name: str | None
    action: str


class RebuildRequester:
    """Starts an asynchronous build at most once per ``REBUILD_DEBOUNCE_SECONDS`` (per container and across containers)."""

    def __init__(
        self, store: SnapshotStore, target: RebuildTarget, *,
        clock: Callable[[], float] = time.monotonic, wall_clock: Callable[[], float] = time.time,
    ) -> None:
        self._store = store
        self._target = target
        self._clock = clock
        self._wall_clock = wall_clock
        self._last: float | None = None

    @property
    def enabled(self) -> bool:
        return self._target.lambda_client is not None and bool(self._target.function_name)

    def recently_requested(self) -> bool:
        """Whether any container asked for a rebuild in the last ``REBUILD_DEBOUNCE_SECONDS`` (the shared marker)."""
        try:
            marker = get_json(self._store.s3, self._store.bucket, self._store.marker_key, gzipped=False)
        except STORE_READ_ERRORS:
            logger.exception('Could not read the %s rebuild marker', self._store.label)
            return False
        requested_at = marker.get('requested_at') if isinstance(marker, dict) else None
        return isinstance(requested_at, (int, float)) and self._wall_clock() - requested_at < REBUILD_DEBOUNCE_SECONDS

    def request(self, reason: str) -> bool:
        """Start an asynchronous build unless one was requested in the last ``REBUILD_DEBOUNCE_SECONDS``."""
        if not self.enabled:
            return False
        now = self._clock()
        if self._last is not None and now - self._last < REBUILD_DEBOUNCE_SECONDS:
            return False
        self._last = now
        if self.recently_requested():
            return False
        try:
            self._store.s3.put_object(
                Bucket=self._store.bucket, Key=self._store.marker_key, ContentType='application/json',
                Body=json.dumps({'requested_at': self._wall_clock(), 'reason': reason}).encode('utf-8'),
            )
            self._target.lambda_client.invoke(
                FunctionName=self._target.function_name, InvocationType='Event',
                Payload=json.dumps({'action': self._target.action, 'reason': reason}).encode('utf-8'),
            )
        except (ClientError, BotoCoreError):
            logger.exception('Could not start a %s rebuild (%s)', self._store.label, reason)
            return False
        logger.info('%s rebuild requested: %s', self._store.label, reason)
        return True


__all__ = [
    'ALL_SCOPE',
    'POINTER_TTL_SECONDS',
    'REBUILD_DEBOUNCE_SECONDS',
    'STALE_BUILD_SECONDS',
    'STORE_READ_ERRORS',
    'WRITE_WORKERS',
    'BuildRun',
    'ParallelWriter',
    'PointerCache',
    'RebuildRequester',
    'RebuildTarget',
    'SnapshotBuildIncomplete',
    'SnapshotStore',
    'active_keywords',
    'bounded_map',
    'build_time',
    'decode_json',
    'encode_json',
    'get_json',
    'group_scope',
    'is_missing_object',
    'is_precondition_failed',
    'kept_build_ids',
    'keyword_fingerprint',
    'market_scope',
    'named_scope_key',
    'new_build_id',
    'scope_dir',
    'scope_keywords',
    'utc_iso',
]
