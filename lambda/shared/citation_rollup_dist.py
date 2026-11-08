"""
The citation rollup (``shared.citation_rollup``) built by the distributed scope snapshot build (2.45.0 wave 6).

At the 10x design point (5,000 keywords, 710k Citations rows, 11,056 named scopes) the in-process
rollup (``shared.citation_rollup_build``) takes ~1,400 CPU s and ~1.6 GB in one invocation: it holds
every row and aggregates every scope over them. Here the same rollup is built by the
``CitationAnalysis-ScopeSnapshotBuild`` state machine next to the snapshots, each invocation bounded:

1. **plan** (``plan_rollup``, inside the snapshot plan step): the active keywords cut into *shards*
   (``plan_shards``: whole markets packed up to ``ROLLUP_SHARD_ROWS`` estimated rows, a larger market
   split), each scope's shards, and the *merges*. Written to ``_build/rollup-plan.json.gz`` with the Map
   item lists ``rollup-shards.json`` (one item per shard plus the *rest* item) and ``rollup-merges.json``.
2. **shards** (``run_rollup_shard``, a Distributed Map): read the shard's keywords' Citations partitions
   by Query (projected), aggregate every scope those keywords are in over them
   (``shared.citation_pages.aggregate_citations``, as in process). A scope only this shard touches is
   written FINAL (manifest, chunks, entries); a scope several shards touch is written as this shard's
   *partial* (its manifest and entries) under ``<rollup build>/_partials/<shard>/``. The *rest* item
   scans the table (projected, segmented, streamed) for the rows of keywords that are not active,
   which only ``table`` counts. Each item ends by writing its fragment; an item whose fragment exists
   returns at once (retries are idempotent).
3. **merges** (``run_rollup_merge``, a second Distributed Map): every scope several shards touch (groups
   across markets, a split market, ``all``) and ``table`` (``all``'s inputs plus the rest) is the merge of
   its partials (``merge_scope``). The inputs cover disjoint keyword sets, so per URL the citation counts
   and provider counts add up and the keyword lists concatenate: the merge equals aggregating the scope's
   rows at once (``lambda/shared/test_citation_rollup_dist.py`` holds the in-process build as the oracle).
   ``all`` and ``table`` are merged from compact rows and written in slices, never as full entry dicts.
4. **publish** (``publish_rollup``, after the snapshots' ``current.json``): the fragments make the
   ``scopes`` index; the rollup's ``current.json`` is written LAST, then the partials are deleted.

Small tenants (``rollup_needs_distribution`` false) keep the in-process build.
"""

from __future__ import annotations

import functools
import gzip
import io
import json
import time
from collections import Counter
from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Any, Final

from boto3.dynamodb.conditions import Key

from shared.citation_pages import (
    BrandTerms,
    CitationAggregate,
    aggregate_citations,
    detect_brand_in_url,
    tracked_brand_terms,
    url_domain,
)
from shared.citation_rollup import (
    CHUNK_CONTENT_TYPES,
    CHUNK_SIZE,
    FORMAT_VERSION,
    TABLE_SCOPE,
    build_prefix,
    chunk_key,
    entries_key,
    keyword_fingerprint,
    manifest_key,
    scope_dir,
)
from shared.citation_rollup_build import RollupBuildIncomplete, _scope_files, _store
from shared.citation_rollup_source import CitationRow, projected
from shared.request_deadline import current_deadline
from shared.snapshot_store import (
    ALL_SCOPE,
    BuildRun,
    ParallelWriter,
    SnapshotStore,
    active_keywords,
    bounded_map,
    encode_json,
    get_json,
    scope_keywords,
)
from shared.youtube import CONTENT_TYPES

SHARD_ACTION: Final = 'snapshot_build_rollup_shard'
MERGE_ACTION: Final = 'snapshot_build_rollup_merge'

#: A table estimated above this many Citations rows is rolled up distributed. In process the build grows linearly: 142k rows
#: measured 279 CPU s and 321 MB (tracemalloc), so 100k rows is ~200 s and ~230 MB, within GenerateSummary's 1,024 MB.
ROLLUP_IN_PROCESS_ROWS = 100_000
#: Estimated Citations rows one shard aggregates. Measured at 10x: a 333-keyword market (47k rows, ~740 scopes) peaks at 108 MB, 89 CPU s.
ROLLUP_SHARD_ROWS = 60_000
#: Estimated rows one merge item merges (its inputs' URLs); ``all`` and ``table`` are heavier and are items alone.
ROLLUP_MERGE_ROWS = 150_000
#: Concurrent partition reads of a shard and scan segments of the rest item.
SHARD_READ_WORKERS = 16
REST_SEGMENTS = 16
#: Compact rows encoded per slice when the ``entries`` file of a merged scope is written.
ENTRIES_SLICE = 5_000
#: The shard number of the rest item (the Map item ``{"shard": len(shards)}``).
REST: Final = 'rest'


def citation_rows_estimate(citations_table: Any) -> int:
    """The Citations table's item count as DynamoDB last measured it (``DescribeTable``, refreshed about every 6 hours)."""
    count = getattr(citations_table, 'item_count', 0)
    return count if isinstance(count, int) else 0


def rollup_needs_distribution(citations_table: Any) -> bool:
    """Whether the rollup is too large for one invocation (``ROLLUP_IN_PROCESS_ROWS``)."""
    return citations_table is not None and citation_rows_estimate(citations_table) > ROLLUP_IN_PROCESS_ROWS


# ---------------------------------------------------------------------------
# Plan
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class RollupPlan:
    """What every rollup step of one distributed build reads (``_build/rollup-plan.json.gz``)."""

    build_id: str
    """The rollup's own build id (its files live under ``citation-rollups/<build_id>/``)."""
    built_at: str
    previous: dict[str, Any] | None
    brand_config_updated_at: Any
    tracked: BrandTerms
    shards: list[list[str]]
    """Each shard's keywords."""
    memberships: dict[str, list[str]]
    """Each active keyword's named scopes (``all``, its market, its groups and group x markets)."""
    scope_shards: dict[str, list[int]]
    """Each named scope's shards (``table`` is ``all``'s plus the rest)."""
    fingerprints: dict[str, str]
    merges: list[list[str]]
    """The scopes each merge item merges."""

    def final_path(self, key: str) -> str:
        return f'{build_prefix(self.build_id)}{scope_dir(key)}'

    def partial_path(self, shard: int | str, key: str) -> str:
        return f'{build_prefix(self.build_id)}_partials/{shard}/{scope_dir(key)}'

    def written_path(self, key: str, shard: int) -> str:
        """Where shard ``shard`` writes scope ``key``: its final directory when no other shard touches it, else a partial."""
        return self.final_path(key) if len(self.scope_shards[key]) == 1 else self.partial_path(shard, key)

    def inputs(self, key: str) -> list[str]:
        """The directories a merge of ``key`` reads."""
        if key == TABLE_SCOPE:
            return [*self.inputs(ALL_SCOPE), self.partial_path(REST, TABLE_SCOPE)] if ALL_SCOPE in self.scope_shards else [self.partial_path(REST, TABLE_SCOPE)]
        return [self.written_path(key, shard) for shard in self.scope_shards[key]]


def plan_shards(keywords_by_market: Mapping[str, Sequence[str]], rows_per_keyword: float) -> list[list[str]]:
    """Whole markets packed into shards of at most ``ROLLUP_SHARD_ROWS`` estimated rows; a larger market split in such shards."""
    capacity = max(1, int(ROLLUP_SHARD_ROWS // max(rows_per_keyword, 1.0)))
    shards: list[list[str]] = []
    current: list[str] = []
    for market in sorted(keywords_by_market):
        keywords = sorted(keywords_by_market[market])
        if len(keywords) > capacity:
            shards.extend(keywords[start:start + capacity] for start in range(0, len(keywords), capacity))
            continue
        if current and len(current) + len(keywords) > capacity:
            shards.append(current)
            current = []
        current.extend(keywords)
    return [*shards, current] if current else shards


def plan_merges(scope_shards: Mapping[str, Sequence[int]], scope_sizes: Mapping[str, int], rows_per_keyword: float) -> list[list[str]]:
    """The scopes several shards touch, plus ``table``, in items of at most ``ROLLUP_MERGE_ROWS`` estimated rows (a heavier one alone)."""
    merged = sorted(key for key, shards in scope_shards.items() if len(shards) > 1 or key == TABLE_SCOPE)
    items: list[list[str]] = []
    current: list[str] = []
    held = 0.0
    for key in merged:
        cost = scope_sizes.get(key, 0) * rows_per_keyword
        if current and held + cost > ROLLUP_MERGE_ROWS:
            items.append(current)
            current, held = [], 0.0
        current.append(key)
        held += cost
    return [*items, current] if current else items


def plan_rollup(
    citations_table: Any, keywords_table: Any, s3: Any, bucket: str, brand_config: Mapping[str, Any], now: Callable[[], datetime],
) -> RollupPlan:
    """Resolve the scopes, cut the shards and merges; the plan (not written: ``write_rollup_plan``)."""
    active = active_keywords(keywords_table)
    scope_sets = scope_keywords(active)
    memberships: dict[str, list[str]] = {}
    for key in sorted(scope_sets):
        for keyword in scope_sets[key]:
            memberships.setdefault(keyword, []).append(key)
    by_market: dict[str, list[str]] = {}
    for key, keywords in scope_sets.items():
        if key.startswith('market:'):
            by_market[key] = sorted(keywords)
    rows_per_keyword = citation_rows_estimate(citations_table) / max(1, len(memberships))
    shards = plan_shards(by_market, rows_per_keyword)
    scope_shards: dict[str, list[int]] = {}
    for index, keywords in enumerate(shards):
        for key in sorted({key for keyword in keywords for key in memberships[keyword]}):
            scope_shards.setdefault(key, []).append(index)
    scope_shards[TABLE_SCOPE] = list(scope_shards.get(ALL_SCOPE, []))
    sizes = {key: len(keywords) for key, keywords in scope_sets.items()} | {TABLE_SCOPE: len(memberships)}
    run = BuildRun.begin(_store(s3, bucket), now)
    return RollupPlan(
        build_id=run.build_id, built_at=run.built_at.isoformat(), previous=run.previous,
        brand_config_updated_at=brand_config.get('updated_at'), tracked=tracked_brand_terms(brand_config),
        shards=shards, memberships=memberships, scope_shards=scope_shards,
        fingerprints={key: keyword_fingerprint(keywords) for key, keywords in scope_sets.items()},
        merges=plan_merges(scope_shards, sizes, rows_per_keyword),
    )


def plan_object_key(build_dir: str) -> str:
    return f'{build_dir}rollup-plan.json.gz'


def shard_items_key(build_dir: str) -> str:
    return f'{build_dir}rollup-shards.json'


def merge_items_key(build_dir: str) -> str:
    return f'{build_dir}rollup-merges.json'


def _fragment_key(build_dir: str, kind: str, index: int) -> str:
    return f'{build_dir}rollup/{kind}/{index}.json'


def _put_plain(store: SnapshotStore, key: str, value: Any) -> None:
    store.s3.put_object(Bucket=store.bucket, Key=key, Body=json.dumps(value).encode('utf-8'), ContentType='application/json')


def write_rollup_plan(store: SnapshotStore, build_dir: str, plan: RollupPlan | None) -> dict[str, Any]:
    """Write the plan and the two Map item lists (empty without a plan); the keys and counts the state carries."""
    shards = [] if plan is None else [{'shard': index} for index in range(len(plan.shards) + 1)]
    merges = [] if plan is None else [{'merge': index} for index in range(len(plan.merges))]
    if plan is not None:
        store.s3.put_object(Bucket=store.bucket, Key=plan_object_key(build_dir), Body=encode_json(asdict(plan)), ContentType='application/gzip')
    _put_plain(store, shard_items_key(build_dir), shards)
    _put_plain(store, merge_items_key(build_dir), merges)
    return {
        'rollup_shards_key': shard_items_key(build_dir), 'rollup_shards': len(shards),
        'rollup_merges_key': merge_items_key(build_dir), 'rollup_merges': len(merges),
    }


def read_rollup_plan(store: SnapshotStore, build_dir: str) -> RollupPlan | None:
    """The build's rollup plan, ``None`` when the build plans no rollup (no Citations table)."""
    doc = get_json(store.s3, store.bucket, plan_object_key(build_dir))
    return RollupPlan(**doc) if isinstance(doc, dict) else None


# ---------------------------------------------------------------------------
# Shards
# ---------------------------------------------------------------------------

def _partition(citations_table: Any, keyword: str) -> list[CitationRow]:
    """Every projected row of one keyword's partition; raises when the deadline stops the read."""
    params = projected(KeyConditionExpression=Key('keyword').eq(keyword))
    rows: list[CitationRow] = []
    while True:
        if current_deadline().stop_reading('a rollup shard read'):
            raise RollupBuildIncomplete(f'Time budget spent reading the Citations of {keyword!r}')
        response = citations_table.query(**params)
        rows.extend(response.get('Items', []))
        last_key = response.get('LastEvaluatedKey')
        if not last_key:
            return rows
        params['ExclusiveStartKey'] = last_key


def _rest_segment(citations_table: Any, segment: int, active: frozenset[str]) -> list[CitationRow]:
    """One scan segment's rows of keywords that are not active (pages are filtered as they arrive)."""
    params = projected(Segment=segment, TotalSegments=REST_SEGMENTS)
    rows: list[CitationRow] = []
    while True:
        if current_deadline().stop_reading('the rollup rest scan'):
            raise RollupBuildIncomplete('Time budget spent scanning the Citations rows of inactive keywords')
        response = citations_table.scan(**params)
        rows.extend(row for row in response.get('Items', []) if str(row.get('keyword', '')) not in active)
        last_key = response.get('LastEvaluatedKey')
        if not last_key:
            return rows
        params['ExclusiveStartKey'] = last_key


def _rest_rows(citations_table: Any, active: frozenset[str]) -> list[CitationRow]:
    with ThreadPoolExecutor(max_workers=REST_SEGMENTS) as pool:
        parts = list(pool.map(lambda segment: _rest_segment(citations_table, segment, active), range(REST_SEGMENTS)))
    return [row for part in parts for row in part]


#: ``url_domain`` memoized for the container (a shard calls it once per URL and scope).
_DOMAINS: Callable[[str], str] = functools.lru_cache(maxsize=200_000)(url_domain)


def _partial_files(aggregate: CitationAggregate, path: str) -> list[tuple[str, Any]]:
    """A partial's files: what a merge reads, the manifest (first) and the entries (last), no chunks."""
    files = _scope_files(aggregate, path, _DOMAINS)
    return [files[0], files[-1]]


def _write_shard(plan: RollupPlan, rows_by_keyword: Mapping[str, list[CitationRow]], shard: int, writer: ParallelWriter) -> dict[str, Any]:
    """Every scope the shard's keywords are in, aggregated over them; the index entries of the scopes written final."""
    scopes: dict[str, list[str]] = {}
    for keyword in plan.shards[shard]:
        for key in plan.memberships[keyword]:
            scopes.setdefault(key, []).append(keyword)
    finals: dict[str, Any] = {}
    for key in sorted(scopes):
        aggregate = aggregate_citations((row for keyword in scopes[key] for row in rows_by_keyword[keyword]), plan.tracked)
        path = plan.written_path(key, shard)
        if path == plan.final_path(key):
            writer.put(_scope_files(aggregate, path, _DOMAINS))
            finals[key] = {'path': path, 'fingerprint': plan.fingerprints[key], 'urls': len(aggregate.top_urls)}
        else:
            writer.put(_partial_files(aggregate, path))
    return finals


def run_rollup_shard(snapshots: SnapshotStore, build_dir: str, citations_table: Any, s3: Any, bucket: str, shard: int) -> dict[str, Any]:
    """Step 2, one Map item: shard ``shard`` (or the rest, ``shard == len(shards)``) aggregated and written, then its fragment."""
    fragment_key = _fragment_key(build_dir, 'shards', shard)
    if get_json(snapshots.s3, snapshots.bucket, fragment_key, gzipped=False) is not None:
        return {'shard': shard, 'status': 'done before'}
    plan = read_rollup_plan(snapshots, build_dir)
    if plan is None:
        raise RollupBuildIncomplete(f'No rollup plan under {build_dir}')
    writer = ParallelWriter(_store(s3, bucket), RollupBuildIncomplete)
    try:
        if shard == len(plan.shards):
            rows = _rest_rows(citations_table, frozenset(plan.memberships))
            writer.put(_partial_files(aggregate_citations(rows, plan.tracked), plan.partial_path(REST, TABLE_SCOPE)))
            finals: dict[str, Any] = {}
            read = len(rows)
        else:
            by_keyword = dict(bounded_map(lambda keyword: _partition(citations_table, keyword), plan.shards[shard], SHARD_READ_WORKERS))
            finals = _write_shard(plan, by_keyword, shard, writer)
            read = sum(len(rows) for rows in by_keyword.values())
    finally:
        writer.finish()
    _put_plain(snapshots, fragment_key, {'scopes': finals, 'rows': read})
    return {'shard': shard, 'status': 'built', 'rows': read, 'final_scopes': len(finals), 'objects': writer.objects}


# ---------------------------------------------------------------------------
# Merges
# ---------------------------------------------------------------------------

@dataclass
class MergedScope:
    """A scope merged from partials over disjoint keywords: compact rows (``CompactEntry``, base order) and its totals."""

    keywords: list[str]
    rows: list[list[Any]]
    citations: int
    providers: Counter[str]
    brands: Counter[str]

    def totals(self) -> dict[str, Any]:
        """``shared.citation_pages.CitationAggregate.totals`` of the merged scope."""
        counts = dict.fromkeys(CONTENT_TYPES, 0)
        for row in self.rows:
            counts[row[3]] += 1
        return {
            'total_citations': self.citations,
            'total_urls': len(self.rows),
            'total_citation_count': sum(row[1] for row in self.rows),
            'content_type_counts': counts,
            'provider_stats': [{'provider': name, 'citation_count': count} for name, count in self.providers.items()],
            'brand_stats': [{'brand': name, 'mention_count': count} for name, count in self.brands.items()],
        }


def _read_input(s3: Any, bucket: str, path: str) -> tuple[dict[str, Any], dict[str, Any]]:
    manifest, entries = get_json(s3, bucket, manifest_key(path)), get_json(s3, bucket, entries_key(path))
    if not isinstance(manifest, dict) or not isinstance(entries, dict):
        raise RollupBuildIncomplete(f'The rollup input {path} is not written')
    return manifest, entries


def merge_scope(inputs: Iterable[tuple[Mapping[str, Any], Mapping[str, Any]]], tracked: BrandTerms) -> MergedScope:
    """``(manifest, entries)`` of partials over disjoint keyword sets merged into one scope.

    Per URL: citation counts and provider counts add up, keyword lists concatenate (disjoint), the
    content type and domain are the first partial's. ``brand_stats`` is recomputed from the merged URLs,
    as ``aggregate_citations`` does.
    """
    keywords: list[str] = []
    by_url: dict[str, list[Any]] = {}
    citations = 0
    providers: Counter[str] = Counter()
    for manifest, entries in inputs:
        offset = len(keywords)
        keywords.extend(entries['keywords'])
        totals = manifest['totals']
        citations += int(totals['total_citations'])
        for stat in totals['provider_stats']:
            providers[stat['provider']] += int(stat['citation_count'])
        for url, count, _keyword_count, content_type, domain, by_provider, indices in entries['entries']:
            shifted = [offset + index for index in indices]
            known = by_url.get(url)
            if known is None:
                by_url[url] = [url, count, 0, content_type, domain, dict(by_provider), shifted]
                continue
            known[1] += count
            merged_providers = known[5]
            for provider, provider_count in by_provider.items():
                merged_providers[provider] = merged_providers.get(provider, 0) + provider_count
            known[6].extend(shifted)
    order = sorted(range(len(keywords)), key=keywords.__getitem__)
    position = [0] * len(keywords)
    for new, old in enumerate(order):
        position[old] = new
    brands: Counter[str] = Counter()
    rows = list(by_url.values())
    del by_url
    for row in rows:
        row[6] = sorted(position[index] for index in row[6])
        row[2] = len(row[6])
        brands[detect_brand_in_url(row[0].lower(), tracked)] += row[1]
    rows.sort(key=lambda row: (-row[1], -row[2], row[0]))
    return MergedScope([keywords[old] for old in order], rows, citations, providers, brands)


def _full_entry(row: Sequence[Any], keywords: Sequence[str]) -> dict[str, Any]:
    return {
        'url': row[0], 'citation_count': row[1], 'by_provider': row[5], 'keyword_count': row[2],
        'keywords': [keywords[index] for index in row[6]], 'content_type': row[3],
    }


def _chunk_files(merged: MergedScope, path: str) -> Iterator[tuple[str, Any]]:
    """The scope's chunks, built 1,000 entries at a time as the writer takes them."""
    for content_type in CHUNK_CONTENT_TYPES:
        selected = merged.rows if content_type == 'all' else [row for row in merged.rows if row[3] == content_type]
        for index, start in enumerate(range(0, len(selected), CHUNK_SIZE)):
            yield chunk_key(path, content_type, index), [_full_entry(row, merged.keywords) for row in selected[start:start + CHUNK_SIZE]]


def encode_entries(keywords: Sequence[str], rows: Sequence[Sequence[Any]]) -> bytes:
    """``encode_json({'keywords': keywords, 'entries': rows})`` encoded ``ENTRIES_SLICE`` rows at a time (no whole-file string)."""
    buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=buffer, mode='wb', compresslevel=5) as gz:
        gz.write(b'{"keywords":' + json.dumps(list(keywords), separators=(',', ':'), ensure_ascii=False).encode('utf-8') + b',"entries":[')
        for start in range(0, len(rows), ENTRIES_SLICE):
            if start:
                gz.write(b',')
            gz.write(json.dumps(list(rows[start:start + ENTRIES_SLICE]), separators=(',', ':'), ensure_ascii=False)[1:-1].encode('utf-8'))
        gz.write(b']}')
    return buffer.getvalue()


def _write_merged(store: SnapshotStore, merged: MergedScope, path: str) -> None:
    counts = dict.fromkeys(CHUNK_CONTENT_TYPES, 0)
    for row in merged.rows:
        counts['all'] += 1
        counts[row[3]] += 1
    writer = ParallelWriter(store, RollupBuildIncomplete)
    try:
        writer.put([(manifest_key(path), {'totals': merged.totals(), 'counts': counts, 'chunk_size': CHUNK_SIZE})])
        writer.put(_chunk_files(merged, path))
    finally:
        writer.finish()
    if current_deadline().stop_reading('the rollup entries write'):
        raise RollupBuildIncomplete(f'Time budget spent before writing {entries_key(path)}')
    store.s3.put_object(Bucket=store.bucket, Key=entries_key(path), Body=encode_entries(merged.keywords, merged.rows), ContentType='application/gzip')


def run_rollup_merge(snapshots: SnapshotStore, build_dir: str, s3: Any, bucket: str, item: int) -> dict[str, Any]:
    """Step 3, one Map item: merge item ``item``'s scopes from their partials, write them final, then its fragment."""
    fragment_key = _fragment_key(build_dir, 'merges', item)
    if get_json(snapshots.s3, snapshots.bucket, fragment_key, gzipped=False) is not None:
        return {'merge': item, 'status': 'done before'}
    plan = read_rollup_plan(snapshots, build_dir)
    if plan is None:
        raise RollupBuildIncomplete(f'No rollup plan under {build_dir}')
    store = _store(s3, bucket)
    finals: dict[str, Any] = {}
    for key in plan.merges[item]:
        merged = merge_scope((_read_input(s3, bucket, path) for path in plan.inputs(key)), plan.tracked)
        path = plan.final_path(key)
        _write_merged(store, merged, path)
        finals[key] = {'path': path, 'fingerprint': None if key == TABLE_SCOPE else plan.fingerprints[key], 'urls': len(merged.rows)}
        del merged
    _put_plain(snapshots, fragment_key, {'scopes': finals})
    return {'merge': item, 'status': 'built', 'scopes': len(finals)}


# ---------------------------------------------------------------------------
# Publish
# ---------------------------------------------------------------------------

def publish_rollup(
    snapshots: SnapshotStore, build_dir: str, s3: Any, bucket: str, now: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> dict[str, Any] | None:
    """Step 4 (after the snapshots' ``current.json``): the rollup's ``current.json`` from the fragments, LAST; ``None`` without a plan."""
    plan = read_rollup_plan(snapshots, build_dir)
    if plan is None:
        return None
    scopes: dict[str, Any] = {}
    for kind, count in (('shards', len(plan.shards) + 1), ('merges', len(plan.merges))):
        for index in range(count):
            fragment = get_json(snapshots.s3, snapshots.bucket, _fragment_key(build_dir, kind, index), gzipped=False)
            if not isinstance(fragment, dict):
                raise RollupBuildIncomplete(f'Rollup {kind} item {index} of {build_dir} is not written')
            scopes.update(fragment['scopes'])
    missing = sorted({*plan.scope_shards} - set(scopes))
    if missing:
        raise RollupBuildIncomplete(f'{len(missing)} rollup scopes are not built (first: {missing[0]})')
    store = _store(s3, bucket)
    run = BuildRun(store, plan.build_id, datetime.fromisoformat(plan.built_at), plan.previous, time.monotonic())
    current = {**run.header(FORMAT_VERSION, {'updated_at': plan.brand_config_updated_at}), 'scopes': {key: scopes[key] for key in sorted(scopes)}}
    published, deleted = run.finish(current, now)
    store.delete_prefix(f'{build_prefix(plan.build_id)}_partials/')
    return {
        'status': 'built' if published else 'superseded', 'build_id': plan.build_id, 'scopes': len(scopes),
        'shards': len(plan.shards), 'merges': len(plan.merges), 'urls': scopes[TABLE_SCOPE]['urls'], 'deleted_builds': len(deleted),
    }


__all__ = [
    'MERGE_ACTION',
    'REST',
    'ROLLUP_IN_PROCESS_ROWS',
    'ROLLUP_MERGE_ROWS',
    'ROLLUP_SHARD_ROWS',
    'SHARD_ACTION',
    'MergedScope',
    'RollupPlan',
    'citation_rows_estimate',
    'encode_entries',
    'merge_items_key',
    'merge_scope',
    'plan_merges',
    'plan_rollup',
    'plan_shards',
    'publish_rollup',
    'read_rollup_plan',
    'rollup_needs_distribution',
    'run_rollup_merge',
    'run_rollup_shard',
    'shard_items_key',
    'write_rollup_plan',
]
