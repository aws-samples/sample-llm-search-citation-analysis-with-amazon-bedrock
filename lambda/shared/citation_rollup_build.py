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
import logging
from collections import defaultdict
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from shared.citation_pages import CitationAggregate, aggregate_citations, tracked_brand_terms, url_domain
from shared.citation_rollup import (
    CHUNK_CONTENT_TYPES,
    CHUNK_SIZE,
    FORMAT_VERSION,
    ROLLUP_PREFIX,
    TABLE_SCOPE,
    build_prefix,
    chunk_key,
    compact_entries,
    entries_key,
    keyword_fingerprint,
    manifest_key,
    scope_dir,
)
from shared.citation_rollup_source import CitationRow, scan_citations
from shared.request_deadline import current_deadline
from shared.snapshot_store import (
    WRITE_WORKERS,
    BuildRun,
    ParallelWriter,
    SnapshotBuildIncomplete,
    SnapshotStore,
    active_keywords,
    scope_keywords,
)

logger = logging.getLogger(__name__)

#: Parallel scan segments and the per-segment page ceiling of a build (700k rows is about 250 pages).
BUILD_SCAN_SEGMENTS = 16
BUILD_MAX_SEGMENT_PAGES = 1_000

__all__ = ['WRITE_WORKERS', 'RollupBuildIncomplete', 'RollupSources', 'build_rollup', 'delete_old_builds']


class RollupBuildIncomplete(SnapshotBuildIncomplete):
    """The build could not read or write everything in time; ``current.json`` was not switched."""


@dataclass(frozen=True)
class RollupSources:
    """What a build reads: the tables and the bucket it writes to."""

    citations_table: Any
    keywords_table: Any
    s3: Any
    bucket: str
    brand_config: dict[str, Any]


def _store(s3: Any, bucket: str) -> SnapshotStore:
    return SnapshotStore(s3, bucket, ROLLUP_PREFIX, 'citation rollup')


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


def _read_rows(citations_table: Any) -> dict[str, list[CitationRow]]:
    """Every Citations row, grouped by keyword text; raises when the read could not finish."""
    rows, truncated = scan_citations(citations_table, BUILD_MAX_SEGMENT_PAGES, segments=BUILD_SCAN_SEGMENTS)
    if truncated:
        raise RollupBuildIncomplete(f'Citations scan stopped after {len(rows)} rows')
    by_keyword: dict[str, list[CitationRow]] = defaultdict(list)
    for row in rows:
        by_keyword[str(row.get('keyword', ''))].append(row)
    return by_keyword


def _scope_rows(by_keyword: dict[str, list[CitationRow]], keywords: set[str] | None) -> Iterator[CitationRow]:
    """The rows of a scope's keywords (every row for ``None``, the ``table`` scope)."""
    for keyword, rows in by_keyword.items():
        if keywords is None or keyword in keywords:
            yield from rows


def _write_scopes(sources: RollupSources, build_id: str, by_keyword: dict[str, list[CitationRow]]) -> dict[str, Any]:
    """Every scope's files under ``build_id``; returns the ``scopes`` index of ``current.json``."""
    tracked = tracked_brand_terms(sources.brand_config)
    keyword_sets: dict[str, set[str] | None] = {TABLE_SCOPE: None, **scope_keywords(active_keywords(sources.keywords_table))}
    writer = ParallelWriter(_store(sources.s3, sources.bucket), RollupBuildIncomplete)
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


def delete_old_builds(s3: Any, bucket: str, keep: set[str], now: datetime) -> list[str]:
    """Delete every build not in ``keep`` and older than ``STALE_BUILD_SECONDS``; the ids deleted."""
    return _store(s3, bucket).delete_old_builds(keep, now)


def build_rollup(sources: RollupSources, now: Callable[[], datetime] = lambda: datetime.now(UTC)) -> dict[str, Any]:
    """Build, publish and clean up; the summary the workflow state records."""
    run = BuildRun.begin(_store(sources.s3, sources.bucket), now)
    by_keyword = _read_rows(sources.citations_table)
    scopes = _write_scopes(sources, run.build_id, by_keyword)
    try:
        published, deleted = run.finish({**run.header(FORMAT_VERSION, sources.brand_config), 'scopes': scopes}, now)
    except SnapshotBuildIncomplete as error:
        raise RollupBuildIncomplete(str(error)) from error
    return {
        'status': 'built' if published else 'superseded',
        'build_id': run.build_id,
        'scopes': len(scopes),
        'rows': sum(len(rows) for rows in by_keyword.values()),
        'urls': scopes[TABLE_SCOPE]['urls'],
        'deleted_builds': len(deleted),
        'seconds': run.seconds(),
    }
