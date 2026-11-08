"""
Build the scope snapshot (``shared.scope_snapshot``, design 2.45.0 §2.2) from every keyword's KeywordLatest object.

Run by the GenerateSummary Lambda for ``{"action": "build_scope_snapshots"}``:
the ``BuildScopeSnapshots`` workflow state after KpiAlerts, and an
asynchronous invocation when a reader finds the build stale. Steps:

1. Resolve the active keywords and every named scope (``shared.snapshot_store.scope_keywords``)
   and keep the ones a reader serves from the snapshot: ``all``, every market,
   and every group or group x market above ``shared.scope_source.LIVE_ROWS_BUDGET``
   (estimated with every answer engine, so the set covers whatever a reader routes).
2. Stream every active keyword's KeywordLatest object (read once, in parallel)
   into the accumulators of the scopes it belongs to (each registered artifact
   builder, ``shared.artifact_registry``) and keep its run tallies, compact,
   for the series. A builder whose code is not written yet
   (``NotImplementedError``) or that fails is skipped for the whole build and
   named in the summary; it never fails the build. With ``newest_run`` set,
   a keyword whose newest stored run is not in its object (no object, or an
   older one: a best-effort write failed) is counted per scope as
   ``keywords_behind``; readers then serve the scope ``stale`` with
   ``coverage.complete`` false, and the build asks for the ``latest``
   backfill of those keywords (``request_backfill``).
3. Write every scope's artifacts under a NEW build id, releasing each scope's
   accumulators once written. Steps 2-3 run in passes over the scopes
   (``fold_passes``): one pass holds at most ``FOLD_PASS_WEIGHT`` keyword-scopes
   of accumulators and reads its members' objects again, so the build's
   memory does not grow with the number of scopes.
4. Bring each built scope's series up to date, one family of scopes at a
   time and resumably (``shared.scope_series_build``).
5. Write ``current.json`` LAST (unless a newer build was published
   meanwhile), then delete old builds and series.

Bounded: the build runs under the action's deadline and raises
``SnapshotBuildIncomplete`` before switching ``current.json`` when any read or
write could not finish, so a half-written build is never served (the series
step's ``SeriesBuildIncomplete`` says how many scopes the next build resumes).
"""

from __future__ import annotations

import json
import logging
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from boto3.dynamodb.conditions import Key

from shared.artifact_registry import artifact_builders
from shared.artifact_trends import build_clock
from shared.keyword_latest import KeywordLatestDoc, config_fingerprint, personas_fingerprint, read_keyword_latest
from shared.keyword_run_kpis import tracked_brand_names
from shared.kpi_engine import owned_domains_from
from shared.kpi_tally import owned_fingerprint
from shared.partial_contract import PartialConfig
from shared.request_deadline import current_deadline
from shared.scope_series_build import (
    SeriesInputs,
    clear_progress,
    encode_latest_tallies,
    read_progress,
    starting_series,
    update_series,
)
from shared.scope_series_store import HistoryReader
from shared.scope_snapshot import (
    FORMAT_VERSION,
    SERIES_PREFIX,
    artifact_key,
    manifest_key,
    snapshot_scope,
    snapshot_store,
)
from shared.scope_source import PERSONA_ENGINES, PLAIN_ENGINES, route_scope
from shared.snapshot_artifacts import SOURCE_SNAPSHOT, ArtifactBuilder, SnapshotScope
from shared.snapshot_store import (
    ALL_SCOPE,
    STALE_BUILD_SECONDS,
    BuildRun,
    ParallelWriter,
    SnapshotBuildIncomplete,
    SnapshotStore,
    active_keywords,
    bounded_map,
    build_time,
    keyword_fingerprint,
    scope_dir,
    scope_keywords,
)

logger = logging.getLogger(__name__)

#: Concurrent KeywordLatest reads of a build.
READ_WORKERS = 64
#: Keyword-scope memberships x personas one fold pass holds the accumulators of. Measured at 10 personas x 4
#: engines with the real builders: ~110 KB of accumulators per keyword-scope (``latest`` and ``mentions`` pools
#: hold every brand of a scope), so a pass of 6,000 keyword-scopes holds ~660 MB.
FOLD_PASS_WEIGHT = 60_000

#: What a builder may raise while folding or finalizing; it is skipped for the build, the build goes on.
_BUILDER_ERRORS = (NotImplementedError, KeyError, TypeError, ValueError, AttributeError, IndexError, ArithmeticError)

NewestRun = Callable[[str], str | None]
"""A keyword's newest stored run timestamp (``None``: it has never run)."""


def newest_search_run(search_results: Any) -> NewestRun:
    """``NewestRun`` over SearchResults: one newest-first, one-row, key-only query per keyword."""

    def newest(keyword: str) -> str | None:
        items = search_results.query(
            KeyConditionExpression=Key('keyword').eq(keyword), ScanIndexForward=False, Limit=1,
            ProjectionExpression='#tp', ExpressionAttributeNames={'#tp': 'timestamp_provider'},
        ).get('Items') or []
        return str(items[0]['timestamp_provider']).split('#', 1)[0] if items else None

    return newest


@dataclass(frozen=True)
class SnapshotSources:
    """What a build reads and where it writes."""

    keywords_table: Any
    s3: Any
    bucket: str
    brand_config: Mapping[str, Any]
    personas: tuple[str, ...]
    history: HistoryReader | None = None
    """A keyword's stored per-run tallies; ``None`` where KeywordRunKpis is not deployed."""
    builders: Mapping[str, ArtifactBuilder[Any]] | None = None
    """The artifact builders (default: every registered one)."""
    newest_run: NewestRun | None = None
    """A keyword's newest stored run, to find objects a failed write left behind; ``None``: not checked."""
    request_backfill: Callable[[list[str]], bool] | None = None
    """Asks for the ``latest`` backfill of the keywords left behind; ``None``: not asked."""
    citations_table: Any = None
    """The Citations table: the distributed build also builds the citation rollup (``shared.citation_rollup_dist``); ``None``: it does not."""
    rollup_bucket: str | None = None
    """The rollup's bucket (``None``: ``bucket``)."""


def built_scope_keys(scope_sets: Mapping[str, set[str]], personas: int) -> list[str]:
    """The scopes a build covers: ``all``, every market, and every group (x market) a reader would serve from the snapshot."""
    chosen = []
    for key, keywords in scope_sets.items():
        kind = snapshot_scope(key, '', 0).kind
        reader_route = route_scope('group', len(keywords), personas=personas, engines=PERSONA_ENGINES, plain_engines=PLAIN_ENGINES)
        if kind != 'group' or reader_route == SOURCE_SNAPSHOT:
            chosen.append(key)
    return sorted(chosen)


@dataclass
class _Fold:
    """The accumulators of every built scope and builder, which builders were dropped, and what the series step needs."""

    scopes: dict[str, SnapshotScope]
    builders: dict[str, ArtifactBuilder[Any]]
    accumulators: dict[tuple[str, str], Any] = field(default_factory=dict)
    skipped: dict[str, str] = field(default_factory=dict)
    """Builder name -> why it was skipped for this build."""
    analyzed: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    behind: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    """Scope key -> its keywords whose newest stored run is not in their KeywordLatest object."""
    behind_keywords: set[str] = field(default_factory=set)
    latest: dict[str, bytes] = field(default_factory=dict)
    """Keyword -> its KeywordLatest tallies, compact (``shared.scope_series_build.encode_latest_tallies``)."""
    stale_config: int = 0
    keep_latest: bool = True
    """Whether ``latest`` is kept (a distributed fold unit leaves it to the series step, ``shared.scope_snapshot_dist``)."""

    def _skip(self, name: str, error: BaseException) -> None:
        if name in self.skipped:
            return
        self.skipped[name] = type(error).__name__
        if isinstance(error, NotImplementedError):
            logger.info('Scope snapshot: the %s artifacts are not implemented yet; skipped', name)
        else:
            logger.error('Scope snapshot: the %s artifacts failed; skipped for this build', name, exc_info=error)

    def add(self, doc: KeywordLatestDoc, scope_keys: list[str]) -> None:
        for key in scope_keys:
            self.analyzed[key] += 1
            for name, builder in self.builders.items():
                if name in self.skipped:
                    continue
                try:
                    self.accumulators[key, name] = builder.fold(self.accumulators.get((key, name)), doc, self.scopes[key])
                except _BUILDER_ERRORS as error:
                    self._skip(name, error)

    def files(self, key: str, build_id: str) -> tuple[list[tuple[str, Any]], list[str]]:
        """The ``(S3 key, object)`` of every artifact of scope ``key`` and the artifact names written; the scope's accumulators are released."""
        artifacts: dict[str, Any] = {}
        for name, builder in self.builders.items():
            accumulator = self.accumulators.pop((key, name), None)
            if name in self.skipped:
                continue
            try:
                produced = builder.finalize(accumulator)
            except _BUILDER_ERRORS as error:
                self._skip(name, error)
                continue
            clash = set(produced) & set(artifacts)
            if clash:
                self._skip(name, ValueError(f'{name} writes {sorted(clash)} twice'))
                continue
            artifacts.update(produced)
        directory = self.scopes[key].scope_dir
        return [(artifact_key(build_id, directory, artifact), value) for artifact, value in artifacts.items()], sorted(artifacts)


def _is_behind(doc: KeywordLatestDoc | None, newest: str | None) -> bool:
    """Whether a keyword's newest stored run ``newest`` is missing from its object ``doc``."""
    if newest is None:
        return False
    latest = (doc or {}).get('latest') or {}
    return str(latest.get('timestamp') or '') < newest


def _fold_keywords(
    sources: SnapshotSources, fold: _Fold, memberships: Mapping[str, list[str]], config: str, seen: set[str], workers: int = READ_WORKERS,
) -> int:
    """Read every member's KeywordLatest object once and fold it into its scopes of this pass; the objects found not ``seen`` in an earlier pass.

    What a keyword contributes once per build (its series tallies, the stale and behind counts) is
    taken the first time a pass reads it; ``seen`` then holds it.
    """
    found = 0
    newest_run = sources.newest_run

    def read(keyword: str) -> tuple[KeywordLatestDoc | None, bool]:
        doc = read_keyword_latest(sources.s3, sources.bucket, keyword)[0]
        return doc, newest_run is not None and keyword not in seen and _is_behind(doc, newest_run(keyword))

    for keyword, (doc, behind) in bounded_map(read, sorted(memberships), workers):
        if current_deadline().stop_reading('the scope snapshot fold'):
            raise SnapshotBuildIncomplete(f'Time budget spent after folding {found} KeywordLatest objects')
        first = keyword not in seen
        seen.add(keyword)
        if behind:
            fold.behind_keywords.add(keyword)
        if keyword in fold.behind_keywords:
            for key in memberships[keyword]:
                fold.behind[key] += 1
        if doc is None:
            continue
        fold.add(doc, memberships[keyword])
        if first:
            found += 1
            fold.stale_config += doc.get('config') != config
            if fold.keep_latest:
                fold.latest[keyword] = encode_latest_tallies(doc.get('tallies') or {})
    return found


def _write(store: SnapshotStore, build_id: str, fold: _Fold, keys: Iterable[str], scope_sets: Mapping[str, set[str]]) -> dict[str, Any]:
    """The artifacts of the scopes ``keys`` (their accumulators released); their entries of the ``scopes`` index of ``current.json``."""
    writer = ParallelWriter(store)
    index: dict[str, Any] = {}
    try:
        for key in keys:
            scope = fold.scopes[key]
            if current_deadline().stop_reading('the scope snapshot writes'):
                raise SnapshotBuildIncomplete(f'Time budget spent after writing {len(index)} more of {len(fold.scopes)} scopes')
            files, names = fold.files(key, build_id)
            writer.put(files)
            index[key] = {
                'dir': scope.scope_dir, 'kind': scope.kind, 'fingerprint': keyword_fingerprint(scope_sets[key]),
                'keywords_total': scope.keywords_total, 'keywords_analyzed': fold.analyzed.get(key, 0),
                'keywords_behind': fold.behind.get(key, 0), 'artifacts': names,
            }
    finally:
        writer.finish()
    return index


def _delete_old_series(store: SnapshotStore, keep: set[str], now: datetime) -> int:
    """Delete every series object whose build is neither kept nor younger than ``STALE_BUILD_SECONDS``; how many."""
    paginator = store.s3.get_paginator('list_objects_v2')
    stale = []
    for page in paginator.paginate(Bucket=store.bucket, Prefix=SERIES_PREFIX):
        for item in page.get('Contents', []):
            series_id = item['Key'].rsplit('/', 1)[-1].removesuffix('.json.gz')
            built = build_time(series_id)
            if series_id not in keep and built is not None and (now - built).total_seconds() >= STALE_BUILD_SECONDS:
                stale.append({'Key': item['Key']})
    for start in range(0, len(stale), 1_000):
        store.s3.delete_objects(Bucket=store.bucket, Delete={'Objects': stale[start:start + 1_000], 'Quiet': True})
    return len(stale)


def _request_backfill(sources: SnapshotSources, keywords: list[str]) -> bool:
    if not keywords or sources.request_backfill is None:
        return False
    logger.warning('Scope snapshot: %d keywords have runs their KeywordLatest object lacks; asking for their backfill', len(keywords))
    return sources.request_backfill(sorted(keywords))


def fold_passes(keys: Iterable[str], scope_sets: Mapping[str, set[str]], personas: int) -> list[list[str]]:
    """The built scopes in fold passes of at most ``FOLD_PASS_WEIGHT`` keyword-personas each (a heavier scope alone).

    ``all`` and the markets come first (each keyword is in ``all`` and one market), then the groups
    in key order. Each pass reads its members' objects again, so a pass is as large as memory allows.
    """
    ordered = sorted(keys, key=lambda key: (snapshot_scope(key, '', 0).kind == 'group', key))
    passes: list[list[str]] = []
    current: list[str] = []
    weight = 0
    for key in ordered:
        cost = len(scope_sets[key]) * max(1, personas)
        if current and weight + cost > FOLD_PASS_WEIGHT:
            passes.append(current)
            current, weight = [], 0
        current.append(key)
        weight += cost
    return [*passes, current] if current else passes


def _memberships(keys: Iterable[str], scope_sets: Mapping[str, set[str]]) -> dict[str, list[str]]:
    """Each keyword of the scopes ``keys`` and which of them it belongs to."""
    memberships: dict[str, list[str]] = defaultdict(list)
    for key in keys:
        for keyword in scope_sets[key]:
            memberships[keyword].append(key)
    return memberships


def resolve_built_scopes(sources: SnapshotSources) -> tuple[dict[str, set[str]], list[str]]:
    """Every named scope's keywords (``all`` even without any) and the scopes a build covers (``built_scope_keys``)."""
    scope_sets = scope_keywords(active_keywords(sources.keywords_table))
    scope_sets.setdefault(ALL_SCOPE, set())
    return scope_sets, built_scope_keys(scope_sets, len(sources.personas))


def series_identity(brand_config: Mapping[str, Any]) -> tuple[str, tuple[str, ...]]:
    """What a scope series is counted against: the owned-domains fingerprint and the tracked brand names."""
    return owned_fingerprint(owned_domains_from(brand_config)), tuple(tracked_brand_names(brand_config))


@dataclass(frozen=True)
class BuildOutcome:
    """What a build publishes besides its scopes' entries (``current.json``)."""

    config: str
    personas: tuple[str, ...]
    stale_config: int
    behind: int
    skipped: Mapping[str, str]


def publish_current(run: BuildRun, brand_config: Mapping[str, Any], outcome: BuildOutcome, scopes: dict[str, Any], now: Callable[[], datetime]) -> tuple[bool, list[str]]:
    """Write the build's manifest and then ``current.json`` LAST (unless superseded); whether published, and the builds deleted."""
    current = {
        **run.header(FORMAT_VERSION, brand_config), 'personas': personas_fingerprint(outcome.personas), 'config': outcome.config,
        'keywords_stale_config': outcome.stale_config, 'keywords_behind': outcome.behind,
        'skipped_artifacts': dict(outcome.skipped), 'scopes': scopes,
    }
    run.store.s3.put_object(Bucket=run.store.bucket, Key=manifest_key(run.build_id), Body=json.dumps(current).encode('utf-8'), ContentType='application/json')
    published, deleted = run.finish(current, now)
    if published:
        clear_progress(run.store)
    return published, deleted


def build_snapshots(sources: SnapshotSources, now: Callable[[], datetime] = lambda: datetime.now(UTC)) -> dict[str, Any]:
    """Build, publish and clean up the scope snapshot; the summary the workflow state records."""
    run = BuildRun.begin(snapshot_store(sources.s3, sources.bucket), now)
    scope_sets, keys = resolve_built_scopes(sources)
    fold = _Fold({key: snapshot_scope(key, scope_dir(key), len(scope_sets[key])) for key in keys}, dict(sources.builders or artifact_builders()))
    config = config_fingerprint(PartialConfig(brand_config=sources.brand_config, personas=sources.personas))
    passes = fold_passes(keys, scope_sets, len(sources.personas))
    seen: set[str] = set()
    found = 0
    scopes: dict[str, Any] = {}
    with build_clock(run.built_at):
        for scope_pass in passes:
            found += _fold_keywords(sources, fold, _memberships(scope_pass, scope_sets), config, seen)
            scopes.update(_write(run.store, run.build_id, fold, scope_pass, scope_sets))
    backfill_requested = _request_backfill(sources, sorted(fold.behind_keywords))
    progress = read_progress(run.store)
    series = update_series(SeriesInputs(
        run.store, run.build_id, *series_identity(sources.brand_config),
        {key: scope_sets[key] for key in keys}, fold.latest, sources.history, starting_series(run.previous, progress), progress,
    ), current_deadline())
    for key, entry in scopes.items():
        entry['series'] = series.series[key]
    outcome = BuildOutcome(config, tuple(sources.personas), fold.stale_config, len(fold.behind_keywords), fold.skipped)
    published, deleted = publish_current(run, sources.brand_config, outcome, scopes, now)
    return {
        'status': 'built' if published else 'superseded', 'build_id': run.build_id, 'scopes': len(scopes),
        'keywords': len(seen), 'fold_passes': len(passes), 'keyword_latest_found': found, 'keywords_stale_config': fold.stale_config,
        'keywords_behind': len(fold.behind_keywords), 'backfill_requested': backfill_requested,
        'history_reads': series.history_reads, 'series_rebuilt': series.rebuilt, 'series_resumed': series.resumed,
        'self_check_mismatches': series.mismatched, 'skipped_artifacts': sorted(fold.skipped), 'deleted_builds': len(deleted),
        'deleted_series': _delete_old_series(run.store, run.keep | set(progress.values()), now()), 'seconds': run.seconds(),
    }


__all__ = [
    'FOLD_PASS_WEIGHT',
    'READ_WORKERS',
    'BuildOutcome',
    'NewestRun',
    'SnapshotSources',
    'build_snapshots',
    'built_scope_keys',
    'fold_passes',
    'newest_search_run',
    'publish_current',
    'resolve_built_scopes',
    'series_identity',
]
