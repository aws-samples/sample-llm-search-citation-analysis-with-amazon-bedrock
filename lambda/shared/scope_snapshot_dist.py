"""
The distributed scope snapshot build (2.45.0 wave 6): ``shared.scope_snapshot_build`` cut into Lambda invocations a state machine runs.

At the 10x design point (5,000 keywords, 281 built scopes, 10 personas, 365 runs) the in-process build
takes ~4,000 CPU s and several GB, more than one Lambda invocation. Here the same steps run as separate
invocations, each bounded in CPU and memory (``CitationAnalysis-ScopeSnapshotBuild``, CDK in the wave 6
report):

1. **plan** (``plan_build``): resolve the active keywords and the built scopes once, cut the work into
   *units* (``BuildUnit``: a group of builders x a set of scopes whose accumulators fit one invocation,
   ``plan_units``) and write ``_build/plan.json.gz`` and ``_build/units.json`` (the Map's item list:
   ``[{"unit": 0}, ...]``) under the new build id. The state carries only the build id and S3 keys.
2. **units** (``run_unit``, a Distributed Map over ``units.json``): fold the unit's scopes for the unit's
   builders from the KeywordLatest objects (the same ``_Fold`` as the in-process build), write their
   artifacts under the build id, then the unit's fragment ``_build/units/<n>.json`` (its scopes' index
   entries, the builders skipped). A unit whose fragment exists is not run again (retries are idempotent).
   The unit holding ``all`` of the first builder group also does the once-per-build keyword checks
   (``keywords_behind``, stale configs), which the publish step spreads over the scopes.
3. **series** (``run_series``, a second Distributed Map over ``_build/series.json``, each item looping while
   ``done`` is false): ``shared.scope_series_build.update_series`` over one *batch* of whole scope families
   (``series_batches``, ~``SERIES_BATCH_KEYWORDS`` keywords of history each) under the invocation's deadline,
   with its own progress file (batches run at once). A family it finishes is saved *complete* under the build
   id and is skipped by the next turn; a family cut by the deadline saves its series as far as it got, and
   the next turn resumes it (``all`` at 10x takes several turns).
4. **publish** (``publish_build``): merge the fragments into ``current.json``'s ``scopes`` index (a scope's
   artifacts are the union of its units'), write the manifest and ``current.json`` LAST, ask for the
   ``latest`` backfill of the keywords behind, delete old builds and series. Raises
   ``SnapshotBuildIncomplete`` (nothing published) when a fragment or a series is missing. Then the
   citation rollup's ``current.json`` (``shared.citation_rollup_dist.publish_rollup``), the build's last write.

With a Citations table (``SnapshotSources.citations_table``) the same build also builds the citation rollup:
the plan step plans its shards and merges (``shared.citation_rollup_dist``), two more Maps run them
(``run_rollup_shard_step``, ``run_rollup_merge_step``, in parallel with the series Map), and publish switches it.

A unit's builders are folded exactly as in-process (same ``_Fold``, same keyword order, same artifacts):
``lambda/shared/test_scope_snapshot_dist.py`` holds the in-process build as the oracle.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable, Iterable, Mapping
from dataclasses import asdict, dataclass, replace
from datetime import UTC, datetime
from typing import Any, Final

from shared import scope_series_build as series_build
from shared.artifact_registry import artifact_builders
from shared.artifact_trends import build_clock
from shared.citation_rollup_dist import (
    plan_rollup,
    publish_rollup,
    rollup_needs_distribution,
    run_rollup_merge,
    run_rollup_shard,
    write_rollup_plan,
)
from shared.keyword_latest import config_fingerprint, read_keyword_latest
from shared.partial_contract import PartialConfig
from shared.request_deadline import Deadline
from shared.scope_snapshot import SNAPSHOT_PREFIX, snapshot_scope, snapshot_store
from shared.scope_snapshot_build import (
    READ_WORKERS,
    BuildOutcome,
    SnapshotSources,
    _delete_old_series,
    _Fold,
    _fold_keywords,
    _memberships,
    _request_backfill,
    _write,
    publish_current,
    resolve_built_scopes,
    series_identity,
)
from shared.snapshot_artifacts import ArtifactBuilder
from shared.snapshot_store import (
    ALL_SCOPE,
    BuildRun,
    SnapshotBuildIncomplete,
    SnapshotStore,
    bounded_map,
    encode_json,
    get_json,
    scope_dir,
)

logger = logging.getLogger(__name__)

PLAN_ACTION: Final = 'snapshot_build_plan'
UNIT_ACTION: Final = 'snapshot_build_unit'
SERIES_ACTION: Final = 'snapshot_build_series'
PUBLISH_ACTION: Final = 'snapshot_build_publish'

#: Builders folded together in a unit (the window builders share one decoded run list per keyword); a builder
#: not named here (a test's, a new one) goes into the last group.
BUILDER_GROUPS: tuple[tuple[str, ...], ...] = (
    ('trends', 'group-kpis'),
    ('latest',),
    ('mentions',),
    ('stats', 'sentiment', 'gaps', 'prompts', 'recommendations', 'content-ideas', 'competitor', 'insights'),
)
@dataclass(frozen=True)
class UnitCost:
    """The heap a group's accumulators take per scope: a fixed part (the pooled brand and domain tables) and a part per keyword x persona."""

    scope_mb: float
    keyword_persona_kb: float

    def of(self, keywords: int, personas: int) -> float:
        return self.scope_mb + keywords * max(1, personas) * self.keyword_persona_kb / 1000


#: Measured at the 10x point (10 personas x 4 engines, real builders; ``~/workspace/cas-timeouts/report-w6-b.md``): ``latest``
#: and ``mentions`` pool every brand of a scope, ~15 and ~55 MB a group whatever its size (plus a finalize transient of ~15 and
#: ~60 MB); the window builders hold ~70 KB of runs a keyword and ``group-kpis`` finalizes ~47 KB a keyword more; the list
#: builders hold a few MB a scope.
UNIT_COSTS: Mapping[tuple[str, ...], UnitCost] = {
    BUILDER_GROUPS[0]: UnitCost(1.0, 12.0),
    BUILDER_GROUPS[1]: UnitCost(16.0, 3.5),
    BUILDER_GROUPS[2]: UnitCost(58.0, 3.5),
    BUILDER_GROUPS[3]: UnitCost(5.0, 6.0),
}
#: The cost of a group whose builders ``BUILDER_GROUPS`` does not name (a test's, a new builder's), until measured.
DEFAULT_UNIT_COST = UnitCost(12.0, 6.0)
#: Heap one unit's accumulators may take (MB). With the ``UNIT_READ_WORKERS`` objects in flight (~50 MB) and the runtime
#: (~150 MB RSS) a unit stays under ~60% of a 1,536 MB Lambda; a scope heavier than this alone is a unit alone (``all``).
UNIT_BUDGET_MB = 450.0
#: Concurrent KeywordLatest reads of a unit: 2 x workers decoded objects (~1.5 MB each at 10 personas) wait for the fold.
UNIT_READ_WORKERS = 16


def _build_dir(build_id: str) -> str:
    return f'{SNAPSHOT_PREFIX}{build_id}/_build/'


def plan_key(build_id: str) -> str:
    return f'{_build_dir(build_id)}plan.json.gz'


def units_key(build_id: str) -> str:
    """The Distributed Map's item list (plain JSON, ``ItemReader`` ``InputType: JSON``)."""
    return f'{_build_dir(build_id)}units.json'


def unit_key(build_id: str, unit: int) -> str:
    return f'{_build_dir(build_id)}units/{unit}.json'


def series_items_key(build_id: str) -> str:
    """The series Map's item list (``[{"batch": 0}, ...]``)."""
    return f'{_build_dir(build_id)}series.json'


def series_progress_key(build_id: str, batch: int) -> str:
    """One series batch's progress: batches run at once, so each saves its own."""
    return f'{_build_dir(build_id)}series/{batch}.json'


#: Distinct keywords whose year of history one series batch reads (~one 480 s turn at the 10x point); ``all`` is a batch
#: alone and takes several turns.
SERIES_BATCH_KEYWORDS = 1_200


def series_batches(keys: Iterable[str], scope_sets: Mapping[str, set[str]]) -> list[list[str]]:
    """The built scopes in batches of whole families (``scope_families``) of at most ``SERIES_BATCH_KEYWORDS`` distinct keywords."""
    batches: list[list[str]] = []
    current: list[str] = []
    keywords: set[str] = set()
    for family in series_build.scope_families(keys):
        members = set().union(*(scope_sets[key] for key in family))
        if current and len(keywords | members) > SERIES_BATCH_KEYWORDS:
            batches.append(current)
            current, keywords = [], set()
        current.extend(family)
        keywords |= members
    return [*batches, current] if current else batches


@dataclass(frozen=True)
class BuildUnit:
    """One invocation's fold: these builders over these scopes; ``checks``: also the once-per-build keyword checks."""

    builders: tuple[str, ...]
    scopes: tuple[str, ...]
    checks: bool = False


def builder_groups(names: Iterable[str]) -> list[tuple[str, ...]]:
    """``names`` in the ``BUILDER_GROUPS`` they belong to (in that order); the others in one last group."""
    chosen = set(names)
    groups = [tuple(name for name in group if name in chosen) for group in BUILDER_GROUPS]
    named = {name for group in BUILDER_GROUPS for name in group}
    groups.append(tuple(sorted(chosen - named)))
    return [group for group in groups if group]


def _unit_cost(group: tuple[str, ...]) -> UnitCost:
    return next((cost for known, cost in UNIT_COSTS.items() if set(group) <= set(known)), DEFAULT_UNIT_COST)


def unit_passes(keys: Iterable[str], scope_sets: Mapping[str, set[str]], personas: int, cost: UnitCost) -> list[list[str]]:
    """The scopes in units of at most ``UNIT_BUDGET_MB`` by ``cost`` (a heavier scope alone): ``all`` and the markets first, then the groups."""
    ordered = sorted(keys, key=lambda key: (snapshot_scope(key, '', 0).kind == 'group', key))
    passes: list[list[str]] = []
    current: list[str] = []
    held = 0.0
    for key in ordered:
        scope_cost = cost.of(len(scope_sets[key]), personas)
        if current and held + scope_cost > UNIT_BUDGET_MB:
            passes.append(current)
            current, held = [], 0.0
        current.append(key)
        held += scope_cost
    return [*passes, current] if current else passes


def plan_units(keys: Iterable[str], scope_sets: Mapping[str, set[str]], personas: int, names: Iterable[str]) -> list[BuildUnit]:
    """The build cut into units: per builder group, the scopes in units within ``UNIT_BUDGET_MB`` (``unit_passes``).

    The first unit holding ``all`` carries the keyword checks (every active keyword is in ``all``).
    """
    chosen = sorted(keys)
    units = [
        BuildUnit(group, tuple(scopes))
        for group in builder_groups(names)
        for scopes in unit_passes(chosen, scope_sets, personas, _unit_cost(group))
    ]
    first = next((index for index, unit in enumerate(units) if ALL_SCOPE in unit.scopes), None)
    if first is not None:
        units[first] = replace(units[first], checks=True)
    return units


@dataclass(frozen=True)
class BuildPlan:
    """What every step of one distributed build reads (``plan.json.gz``)."""

    build_id: str
    built_at: str
    """The build's start, ISO with microseconds (``current.json`` says it to the second): every unit's window presets end there."""
    previous: dict[str, Any] | None
    config: str
    personas: tuple[str, ...]
    owned: str
    tracked: tuple[str, ...]
    brand_config_updated_at: Any
    scopes: dict[str, list[str]]
    """Each built scope's keywords, sorted."""
    units: list[BuildUnit]
    series_batches: list[list[str]]
    """The scopes each series batch brings up to date (whole families)."""

    def scope_sets(self) -> dict[str, set[str]]:
        return {key: set(keywords) for key, keywords in self.scopes.items()}

    @property
    def started(self) -> datetime:
        return datetime.fromisoformat(self.built_at)

    def run(self, store: SnapshotStore) -> BuildRun:
        return BuildRun(store, self.build_id, self.started, self.previous, time.monotonic())


def _write_json(store: SnapshotStore, key: str, value: Any, *, gzipped: bool) -> None:
    body = encode_json(value) if gzipped else json.dumps(value).encode('utf-8')
    store.s3.put_object(Bucket=store.bucket, Key=key, Body=body, ContentType='application/gzip' if gzipped else 'application/json')


def read_plan(store: SnapshotStore, build_id: str) -> BuildPlan:
    """The plan of ``build_id``; ``SnapshotBuildIncomplete`` when it is gone (the build was deleted)."""
    doc = get_json(store.s3, store.bucket, plan_key(build_id))
    if not isinstance(doc, dict):
        raise SnapshotBuildIncomplete(f'No plan for the scope snapshot build {build_id}')
    units = [BuildUnit(tuple(unit['builders']), tuple(unit['scopes']), bool(unit['checks'])) for unit in doc['units']]
    return BuildPlan(**{**doc, 'personas': tuple(doc['personas']), 'tracked': tuple(doc['tracked']), 'units': units})


def plan_build(sources: SnapshotSources, now: Callable[[], datetime] = lambda: datetime.now(UTC)) -> dict[str, Any]:
    """Step 1: resolve the scopes, cut the units, write the plan and the Map's item list; the state's next input."""
    store = snapshot_store(sources.s3, sources.bucket)
    run = BuildRun.begin(store, now)
    scope_sets, keys = resolve_built_scopes(sources)
    names = sorted(sources.builders or artifact_builders())
    units = plan_units(keys, scope_sets, len(sources.personas), names)
    owned, tracked = series_identity(sources.brand_config)
    plan = BuildPlan(
        build_id=run.build_id, built_at=run.built_at.isoformat(), previous=run.previous,
        config=config_fingerprint(PartialConfig(brand_config=sources.brand_config, personas=sources.personas)),
        personas=tuple(sources.personas), owned=owned, tracked=tracked, brand_config_updated_at=sources.brand_config.get('updated_at'),
        scopes={key: sorted(scope_sets[key]) for key in keys}, units=units, series_batches=series_batches(keys, scope_sets),
    )
    _write_json(store, plan_key(run.build_id), asdict(plan), gzipped=True)
    _write_json(store, units_key(run.build_id), [{'unit': index} for index in range(len(units))], gzipped=False)
    _write_json(store, series_items_key(run.build_id), [{'batch': index} for index in range(len(plan.series_batches))], gzipped=False)
    rollup = None if sources.citations_table is None else plan_rollup(
        sources.citations_table, sources.keywords_table, sources.s3, _rollup_bucket(sources), sources.brand_config, now,
    )
    rollup_items = write_rollup_plan(store, _build_dir(run.build_id), rollup)
    logger.info('Scope snapshot %s planned: %d scopes in %d units, rollup %s', run.build_id, len(keys), len(units), rollup_items)
    return {
        'build_id': run.build_id, 'bucket': sources.bucket, 'units_key': units_key(run.build_id), 'units': len(units),
        'series_key': series_items_key(run.build_id), 'series_batches': len(plan.series_batches), 'scopes': len(keys), **rollup_items,
    }


def _rollup_bucket(sources: SnapshotSources) -> str:
    return sources.rollup_bucket or sources.bucket


def run_rollup_shard_step(sources: SnapshotSources, build_id: str, shard: int) -> dict[str, Any]:
    """Step 2b, one item of the rollup shard Map (``shared.citation_rollup_dist.run_rollup_shard``)."""
    return run_rollup_shard(snapshot_store(sources.s3, sources.bucket), _build_dir(build_id), sources.citations_table, sources.s3, _rollup_bucket(sources), shard)


def run_rollup_merge_step(sources: SnapshotSources, build_id: str, item: int) -> dict[str, Any]:
    """Step 3b, one item of the rollup merge Map (``shared.citation_rollup_dist.run_rollup_merge``)."""
    return run_rollup_merge(snapshot_store(sources.s3, sources.bucket), _build_dir(build_id), sources.s3, _rollup_bucket(sources), item)



def run_unit(sources: SnapshotSources, build_id: str, index: int) -> dict[str, Any]:
    """Step 2, one Map item: fold, finalize and write unit ``index``'s artifacts, then its fragment (skipped when written)."""
    store = snapshot_store(sources.s3, sources.bucket)
    fragment_key = unit_key(build_id, index)
    if get_json(store.s3, store.bucket, fragment_key, gzipped=False) is not None:
        return {'unit': index, 'status': 'done before'}
    plan = read_plan(store, build_id)
    unit = plan.units[index]
    every = dict(sources.builders or artifact_builders())
    builders: dict[str, ArtifactBuilder[Any]] = {name: every[name] for name in unit.builders}
    scope_sets = {key: set(plan.scopes[key]) for key in unit.scopes}
    fold = _Fold({key: snapshot_scope(key, scope_dir(key), len(scope_sets[key])) for key in unit.scopes}, builders, keep_latest=False)
    unit_sources = sources if unit.checks else replace(sources, newest_run=None)
    with build_clock(plan.started):
        found = _fold_keywords(unit_sources, fold, _memberships(unit.scopes, scope_sets), plan.config, set(), UNIT_READ_WORKERS)
        entries = _write(store, build_id, fold, unit.scopes, scope_sets)
    fragment = {
        'scopes': entries, 'skipped': dict(fold.skipped), 'checks': unit.checks,
        'behind_keywords': sorted(fold.behind_keywords), 'stale_config': fold.stale_config, 'found': found,
    }
    _write_json(store, fragment_key, fragment, gzipped=False)
    return {'unit': index, 'status': 'built', 'scopes': len(entries), 'keywords': found}


def _series_tallies(sources: SnapshotSources, keywords: Iterable[str]) -> dict[str, bytes]:
    """Each keyword's KeywordLatest tallies, compact, read in parallel (a keyword without an object is absent)."""

    def read(keyword: str) -> bytes | None:
        doc = read_keyword_latest(sources.s3, sources.bucket, keyword)[0]
        return None if doc is None else series_build.encode_latest_tallies(doc.get('tallies') or {})

    return {keyword: encoded for keyword, encoded in bounded_map(read, sorted(keywords), READ_WORKERS) if encoded is not None}


def run_series(sources: SnapshotSources, build_id: str, batch: int, deadline: Deadline) -> dict[str, Any]:
    """Step 3, one turn of one series batch (a Map item looping while ``done`` is false): its families until done or ``deadline``."""
    store = snapshot_store(sources.s3, sources.bucket)
    plan = read_plan(store, build_id)
    members = {key: set(plan.scopes[key]) for key in plan.series_batches[batch]}
    progress_key = series_progress_key(build_id, batch)
    complete, progress = series_build.read_complete(store, progress_key), series_build.read_progress(store, progress_key)
    remaining = [family for family in series_build.scope_families(members) if any(complete.get(key) != build_id for key in family)]
    keywords = set().union(*(members[key] for family in remaining for key in family)) if remaining else set()
    inputs = series_build.SeriesInputs(
        store, build_id, plan.owned, plan.tracked, members, _series_tallies(sources, keywords), sources.history,
        series_build.starting_series(plan.previous, progress), progress, complete, progress_key,
    )
    try:
        outcome = series_build.update_series(inputs, deadline)
    except series_build.SeriesBuildIncomplete as error:
        logger.info('Scope snapshot %s: series cut (%s); %d scopes saved', build_id, error, error.scopes_saved)
        return {'build_id': build_id, 'batch': batch, 'done': False, 'families_left': len(remaining), 'scopes_saved': error.scopes_saved}
    return {'build_id': build_id, 'batch': batch, 'done': True, 'families_built': len(remaining), 'history_reads': outcome.history_reads}


def _read_fragments(store: SnapshotStore, plan: BuildPlan) -> list[dict[str, Any]]:
    fragments = []
    for index in range(len(plan.units)):
        doc = get_json(store.s3, store.bucket, unit_key(plan.build_id, index), gzipped=False)
        if not isinstance(doc, dict):
            raise SnapshotBuildIncomplete(f'Unit {index} of the scope snapshot build {plan.build_id} is not written')
        fragments.append(doc)
    return fragments


def merged_scopes(fragments: Iterable[Mapping[str, Any]], scope_sets: Mapping[str, set[str]], behind: set[str]) -> dict[str, Any]:
    """The ``scopes`` index of ``current.json`` from every unit's entries: a scope's artifacts are the union of its units'."""
    scopes: dict[str, Any] = {}
    for fragment in fragments:
        for key, entry in fragment['scopes'].items():
            known = scopes.get(key)
            if known is None:
                scopes[key] = {**entry, 'keywords_behind': len(scope_sets[key] & behind)}
            else:
                known['artifacts'] = sorted({*known['artifacts'], *entry['artifacts']})
    return {key: scopes[key] for key in sorted(scopes)}


def publish_build(sources: SnapshotSources, build_id: str, now: Callable[[], datetime] = lambda: datetime.now(UTC)) -> dict[str, Any]:
    """Step 4: ``current.json`` from the fragments and the series, written LAST; the build summary."""
    store = snapshot_store(sources.s3, sources.bucket)
    plan = read_plan(store, build_id)
    run = plan.run(store)
    fragments = _read_fragments(store, plan)
    complete: dict[str, str] = {}
    for batch in range(len(plan.series_batches)):
        complete.update(series_build.read_complete(store, series_progress_key(build_id, batch)))
    missing = sorted(key for key in plan.scopes if complete.get(key) != build_id)
    if missing:
        raise SnapshotBuildIncomplete(f'{len(missing)} scope series of the build {build_id} are not complete (first: {missing[0]})')
    checks = next((fragment for fragment in fragments if fragment['checks']), {'behind_keywords': [], 'stale_config': 0, 'found': 0})
    behind = set(checks['behind_keywords'])
    scope_sets = plan.scope_sets()
    scopes = merged_scopes(fragments, scope_sets, behind)
    for entry in scopes.values():
        entry['series'] = build_id
    skipped: dict[str, str] = {}
    for fragment in fragments:
        skipped.update({name: why for name, why in fragment['skipped'].items() if name not in skipped})
    backfill_requested = _request_backfill(sources, sorted(behind))
    progress = dict.fromkeys(complete, build_id)
    outcome = BuildOutcome(plan.config, plan.personas, checks['stale_config'], len(behind), skipped)
    published, deleted = publish_current(run, {'updated_at': plan.brand_config_updated_at}, outcome, scopes, now)
    rollup = publish_rollup(store, _build_dir(build_id), sources.s3, _rollup_bucket(sources), now)
    return {
        'status': 'built' if published else 'superseded', 'build_id': build_id, 'scopes': len(scopes), 'units': len(fragments),
        'keyword_latest_found': checks['found'], 'keywords_stale_config': checks['stale_config'], 'keywords_behind': len(behind),
        'backfill_requested': backfill_requested, 'skipped_artifacts': sorted(skipped), 'deleted_builds': len(deleted),
        'deleted_series': _delete_old_series(store, run.keep | set(progress.values()), now()), 'citation_rollup': rollup,
    }


def build_cost_mb(keys: Iterable[str], scope_sets: Mapping[str, set[str]], personas: int, names: Iterable[str]) -> float:
    """The heap the in-process build would hold by the ``UNIT_COSTS`` model: every builder group over every built scope."""
    chosen = list(keys)
    return sum(_unit_cost(group).of(len(scope_sets[key]), personas) for group in builder_groups(names) for key in chosen)


def needs_distribution(sources: SnapshotSources) -> bool:
    """Whether the build runs distributed: its snapshots hold more than one unit's budget (``UNIT_BUDGET_MB``), or its citation
    rollup is too large for one invocation (``shared.citation_rollup_dist.rollup_needs_distribution``); else it runs in process.

    One rule for both builds: the state machine builds both, so a tenant is either distributed for both or for neither.
    """
    if rollup_needs_distribution(sources.citations_table):
        return True
    scope_sets, keys = resolve_built_scopes(sources)
    names = sources.builders or artifact_builders()
    return build_cost_mb(keys, scope_sets, len(sources.personas), names) > UNIT_BUDGET_MB


__all__ = [
    'BUILDER_GROUPS',
    'PLAN_ACTION',
    'PUBLISH_ACTION',
    'SERIES_ACTION',
    'UNIT_ACTION',
    'UNIT_BUDGET_MB',
    'UNIT_COSTS',
    'BuildPlan',
    'BuildUnit',
    'UnitCost',
    'build_cost_mb',
    'builder_groups',
    'merged_scopes',
    'needs_distribution',
    'plan_build',
    'plan_key',
    'plan_units',
    'publish_build',
    'read_plan',
    'run_rollup_merge_step',
    'run_rollup_shard_step',
    'run_series',
    'run_unit',
    'series_batches',
    'series_items_key',
    'series_progress_key',
    'unit_key',
    'unit_passes',
    'units_key',
]
