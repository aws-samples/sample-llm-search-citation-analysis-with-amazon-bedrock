"""
Build the citation rollup (``shared.citation_rollup``) in one pass over the Citations table.

Run by the GenerateSummary Lambda for the event ``{"action": "build_citation_rollup"}``:
a workflow state after each run, and an asynchronous invocation from the API
when it finds the live build stale. Steps:

1. Read the active keywords (id, keyword, groups, market), the brand config
   and every Citations row (projected parallel scan,
   ``shared.citation_rollup_source.scan_citations``).
2. Aggregate each scope (``table``, ``all``, every market, group and
   group x market that has keywords) with ``shared.citation_pages.aggregate_citations``
   and write its manifest, chunks and entries under a NEW build id.
3. Write ``current.json`` LAST, unless a newer build was published meanwhile:
   a reader sees either the old build or the complete new one.
4. Delete builds older than the previous one (and older than
   ``STALE_BUILD_SECONDS``, so a concurrent build is never deleted mid-write).

The builder runs under its own deadline: when the read or the writes cannot
finish in time it raises ``RollupBuildIncomplete`` before switching
``current.json``, so a half-written build is never served.
"""

from __future__ import annotations

import functools
import json
import logging
import time
import uuid
from collections import defaultdict
from collections.abc import Callable, Iterable, Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from shared.citation_pages import CitationAggregate, aggregate_citations, tracked_brand_terms, url_domain
from shared.citation_rollup import (
    ALL_SCOPE,
    CHUNK_CONTENT_TYPES,
    CHUNK_SIZE,
    CURRENT_KEY,
    FORMAT_VERSION,
    ROLLUP_PREFIX,
    TABLE_SCOPE,
    build_prefix,
    chunk_key,
    compact_entries,
    encode_json,
    entries_key,
    group_scope,
    is_missing_object,
    keyword_fingerprint,
    manifest_key,
    market_scope,
    scope_dir,
)
from shared.citation_rollup_source import CitationRow, scan_citations
from shared.dynamodb_batch import collect_all_items
from shared.keyword_groups import ACTIVE_KEYWORD_STATUS, keyword_group_ids
from shared.markets import keyword_market_id
from shared.request_deadline import current_deadline

logger = logging.getLogger(__name__)

#: Parallel scan segments and the per-segment page ceiling of a build (700k rows is about 250 pages).
BUILD_SCAN_SEGMENTS = 16
BUILD_MAX_SEGMENT_PAGES = 1_000
#: Concurrent S3 writes.
WRITE_WORKERS = 32
#: A build directory this old, neither current nor previous, is deleted.
STALE_BUILD_SECONDS = 1_800
_BUILD_ID_TIME = '%Y%m%dT%H%M%SZ'
_DELETE_BATCH = 1_000


class RollupBuildIncomplete(RuntimeError):
    """The build could not read or write everything in time; ``current.json`` was not switched."""


@dataclass(frozen=True)
class RollupSources:
    """What a build reads: the tables and the bucket it writes to."""

    citations_table: Any
    keywords_table: Any
    s3: Any
    bucket: str
    brand_config: dict[str, Any]


def _active_keywords(keywords_table: Any) -> list[dict[str, Any]]:
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
    """The keyword texts of every precomputed scope but ``table`` (which covers every row)."""
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


def _scope_files(
    aggregate: CitationAggregate, scope_path: str, domain_of: Callable[[str], str],
) -> list[tuple[str, Any]]:
    """``(key, value)`` of every file of one scope."""
    by_type = {
        content_type: [entry for entry in aggregate.top_urls if content_type in ('all', entry['content_type'])]
        for content_type in CHUNK_CONTENT_TYPES
    }
    files: list[tuple[str, Any]] = [(manifest_key(scope_path), {
        'totals': aggregate.totals(),
        'counts': {content_type: len(entries) for content_type, entries in by_type.items()},
        'chunk_size': CHUNK_SIZE,
    })]
    for content_type, entries in by_type.items():
        for index, start in enumerate(range(0, len(entries), CHUNK_SIZE)):
            files.append((chunk_key(scope_path, content_type, index), entries[start:start + CHUNK_SIZE]))
    files.append((entries_key(scope_path), compact_entries(aggregate.top_urls, domain_of)))
    return files


class _Writer:
    """Parallel gzip-JSON PUTs that stop (and make the build incomplete) at the deadline."""

    def __init__(self, s3: Any, bucket: str) -> None:
        self._s3 = s3
        self._bucket = bucket
        self._pool = ThreadPoolExecutor(max_workers=WRITE_WORKERS)
        self._pending: list[Any] = []
        self.objects = 0

    def put(self, files: list[tuple[str, Any]]) -> None:
        for key, value in files:
            self._pending.append(self._pool.submit(self._put_one, key, value))
        self.objects += len(files)

    def _put_one(self, key: str, value: Any) -> None:
        if current_deadline().stop_reading('the citation rollup writes'):
            raise RollupBuildIncomplete(f'Time budget spent before writing {key}')
        self._s3.put_object(Bucket=self._bucket, Key=key, Body=encode_json(value), ContentType='application/gzip')

    def finish(self) -> None:
        """Wait for every write; the first failure is raised."""
        try:
            for future in self._pending:
                future.result()
        finally:
            self._pool.shutdown(wait=True, cancel_futures=True)


def _read_rows(citations_table: Any) -> dict[str, list[CitationRow]]:
    """Every Citations row, grouped by keyword text; raises when the read could not finish."""
    rows, truncated = scan_citations(citations_table, BUILD_MAX_SEGMENT_PAGES, segments=BUILD_SCAN_SEGMENTS)
    if truncated:
        raise RollupBuildIncomplete(f'Citations scan stopped after {len(rows)} rows')
    by_keyword: dict[str, list[CitationRow]] = defaultdict(list)
    for row in rows:
        by_keyword[str(row.get('keyword', ''))].append(row)
    return by_keyword


def _build_id(now: datetime) -> str:
    return f'{now.strftime(_BUILD_ID_TIME)}-{uuid.uuid4().hex[:8]}'


def _build_time(build_id: str) -> datetime | None:
    try:
        return datetime.strptime(build_id.split('-', 1)[0], _BUILD_ID_TIME).replace(tzinfo=UTC)
    except ValueError:
        return None


def read_current(s3: Any, bucket: str) -> dict[str, Any] | None:
    """The published ``current.json``, or ``None`` when there is none."""
    try:
        body = s3.get_object(Bucket=bucket, Key=CURRENT_KEY)['Body'].read()
    except ClientError as error:
        if is_missing_object(error):
            return None
        raise
    current = json.loads(body)
    return current if isinstance(current, dict) else None


def _scope_rows(by_keyword: dict[str, list[CitationRow]], keywords: set[str] | None) -> Iterator[CitationRow]:
    """The rows of a scope's keywords (every row for ``None``, the ``table`` scope)."""
    for keyword, rows in by_keyword.items():
        if keywords is None or keyword in keywords:
            yield from rows


def _write_scopes(sources: RollupSources, build_id: str, by_keyword: dict[str, list[CitationRow]]) -> dict[str, Any]:
    """Every scope's files under ``build_id``; returns the ``scopes`` index of ``current.json``."""
    tracked = tracked_brand_terms(sources.brand_config)
    keyword_sets: dict[str, set[str] | None] = {TABLE_SCOPE: None, **scope_keywords(_active_keywords(sources.keywords_table))}
    writer = _Writer(sources.s3, sources.bucket)
    domain_of = functools.lru_cache(maxsize=None)(url_domain)
    index: dict[str, Any] = {}
    try:
        for key, keywords in keyword_sets.items():
            if current_deadline().stop_reading('the citation rollup aggregation'):
                raise RollupBuildIncomplete(f'Time budget spent after {len(index)} of {len(keyword_sets)} scopes')
            aggregate = aggregate_citations(_scope_rows(by_keyword, keywords), tracked)
            path = f'{build_prefix(build_id)}{scope_dir(key)}'
            writer.put(_scope_files(aggregate, path, domain_of))
            index[key] = {
                'path': path,
                'fingerprint': None if keywords is None else keyword_fingerprint(keywords),
                'urls': len(aggregate.top_urls),
            }
    finally:
        writer.finish()
    logger.info('Citation rollup %s: %d scopes, %d objects', build_id, len(index), writer.objects)
    return index


def _publish(sources: RollupSources, current: dict[str, Any], previous: dict[str, Any] | None) -> bool:
    """Write ``current.json`` unless a newer build is already live; whether it was written."""
    latest = read_current(sources.s3, sources.bucket)
    if latest is not None and str(latest.get('built_at', '')) > current['built_at']:
        logger.info('Citation rollup %s superseded by %s; not published', current['build_id'], latest.get('build_id'))
        return False
    if current_deadline().stop_reading('the citation rollup switch'):
        raise RollupBuildIncomplete('Time budget spent before publishing')
    current['previous_build_id'] = previous.get('build_id') if previous else None
    sources.s3.put_object(
        Bucket=sources.bucket, Key=CURRENT_KEY, Body=json.dumps(current).encode('utf-8'), ContentType='application/json',
    )
    return True


def _list_build_ids(s3: Any, bucket: str) -> list[str]:
    build_ids: list[str] = []
    paginator = s3.get_paginator('list_objects_v2')
    for page in paginator.paginate(Bucket=bucket, Prefix=ROLLUP_PREFIX, Delimiter='/'):
        build_ids.extend(common['Prefix'][len(ROLLUP_PREFIX):].rstrip('/') for common in page.get('CommonPrefixes', []))
    return build_ids


def _delete_prefix(s3: Any, bucket: str, prefix: str) -> None:
    paginator = s3.get_paginator('list_objects_v2')
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        keys = [{'Key': item['Key']} for item in page.get('Contents', [])]
        for start in range(0, len(keys), _DELETE_BATCH):
            s3.delete_objects(Bucket=bucket, Delete={'Objects': keys[start:start + _DELETE_BATCH], 'Quiet': True})


def delete_old_builds(s3: Any, bucket: str, keep: set[str], now: datetime) -> list[str]:
    """Delete every build not in ``keep`` and older than ``STALE_BUILD_SECONDS``; the ids deleted."""
    deleted = []
    for build_id in _list_build_ids(s3, bucket):
        built = _build_time(build_id)
        if build_id in keep or built is None or (now - built).total_seconds() < STALE_BUILD_SECONDS:
            continue
        _delete_prefix(s3, bucket, build_prefix(build_id))
        deleted.append(build_id)
    return deleted


def build_rollup(sources: RollupSources, now: Callable[[], datetime] = lambda: datetime.now(UTC)) -> dict[str, Any]:
    """Build, publish and clean up; the summary the workflow state records."""
    started = time.monotonic()
    built_at = now()
    build_id = _build_id(built_at)
    previous = read_current(sources.s3, sources.bucket)
    by_keyword = _read_rows(sources.citations_table)
    scopes = _write_scopes(sources, build_id, by_keyword)
    current = {
        'version': FORMAT_VERSION,
        'build_id': build_id,
        'built_at': built_at.isoformat().replace('+00:00', 'Z'),
        'brand_config_updated_at': sources.brand_config.get('updated_at'),
        'scopes': scopes,
    }
    published = _publish(sources, current, previous)
    keep = {build_id} | ({str(previous['build_id'])} if previous and previous.get('build_id') else set())
    deleted = delete_old_builds(sources.s3, sources.bucket, keep, now())
    return {
        'status': 'built' if published else 'superseded',
        'build_id': build_id,
        'scopes': len(scopes),
        'rows': sum(len(rows) for rows in by_keyword.values()),
        'urls': scopes[TABLE_SCOPE]['urls'],
        'deleted_builds': len(deleted),
        'seconds': round(time.monotonic() - started, 1),
    }
