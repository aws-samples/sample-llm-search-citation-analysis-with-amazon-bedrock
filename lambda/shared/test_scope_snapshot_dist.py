"""Tests for the distributed scope snapshot build (``shared.scope_snapshot_dist``): it publishes what the in-process build publishes."""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import UTC, datetime
from typing import Any
from unittest.mock import patch

import pytest

from shared import scope_snapshot_dist
from shared.artifact_registry import artifact_builders
from shared.citation_rollup import CURRENT_KEY, manifest_key
from shared.partial_contract import PartialConfig
from shared.request_deadline import Deadline
from shared.scope_series_build import read_complete
from shared.scope_snapshot import SERIES_PREFIX, SNAPSHOT_PREFIX, snapshot_store
from shared.scope_snapshot_build import SnapshotSources, build_snapshots
from shared.scope_snapshot_dist import (
    BuildUnit,
    UnitCost,
    build_cost_mb,
    builder_groups,
    needs_distribution,
    plan_build,
    plan_key,
    plan_units,
    publish_build,
    read_plan,
    run_rollup_merge_step,
    run_rollup_shard_step,
    run_series,
    run_unit,
    series_batches,
    series_progress_key,
    unit_key,
    unit_passes,
    units_key,
)
from shared.snapshot_store import SnapshotBuildIncomplete, scope_keywords
from testing.citation_rollup_fixtures import SegmentedTable
from testing.scale_data import BRAND_CONFIG, ScaleSpec, keyword_items, keyword_text, persona_ids, run_timestamp
from testing.scope_snapshot_fixtures import (
    SNAPSHOT_BUCKET,
    GeneratedHistory,
    SnapshotBucket,
    bucket_with_keyword_latests,
    keywords_table,
    live_rows_budget,
)

_SPEC = ScaleSpec(keywords=12, groups=3, largest_group=8, markets=2, personas=2, runs=3, long_tail=30)
_PERSONAS = persona_ids(_SPEC)
_CONFIG = PartialConfig(brand_config=BRAND_CONFIG, personas=_PERSONAS)
_BUDGET = 40
_AT = datetime(2026, 10, 5, 7, 0, tzinfo=UTC)
#: The keyword whose newest stored run is newer than its object (F3: behind).
_BEHIND = keyword_text(3)


class _FamiliesDeadline(Deadline):
    """Lets the series step finish ``families`` families and stops it at the next one; nothing else stops."""

    def __init__(self, families: int) -> None:
        super().__init__(10**6)
        self.families = families
        self.checks = 0

    def stop_reading(self, what: str) -> bool:
        if what != 'the scope series':
            return False
        self.checks += 1
        return self.checks > self.families


def _never_spent() -> Deadline:
    return Deadline(10**6)


def _newest_run(keyword: str) -> str | None:
    return '2099-01-01T00:00:00.000000Z' if keyword == _BEHIND else run_timestamp(_SPEC.runs - 1)


def _sources(bucket: SnapshotBucket, backfills: list[list[str]] | None = None) -> SnapshotSources:
    asked = [] if backfills is None else backfills
    return SnapshotSources(
        keywords_table(keyword_items(_SPEC)), bucket, SNAPSHOT_BUCKET, BRAND_CONFIG, _PERSONAS,
        history=GeneratedHistory(_SPEC, _SPEC.runs), builders=artifact_builders(), newest_run=_newest_run,
        request_backfill=lambda keywords: asked.append(keywords) is None,
    )


def _in_process(bucket: SnapshotBucket) -> dict[str, Any]:
    with live_rows_budget(_BUDGET):
        return build_snapshots(_sources(bucket), now=lambda: _AT)


def _plan(sources: SnapshotSources) -> dict[str, Any]:
    with live_rows_budget(_BUDGET):
        return plan_build(sources, now=lambda: _AT)


def _run_units(sources: SnapshotSources, planned: dict[str, Any]) -> None:
    for unit in range(planned['units']):
        run_unit(sources, planned['build_id'], unit)


def _distributed(bucket: SnapshotBucket, series_deadlines: list[Deadline] | None = None, backfills: list[list[str]] | None = None, *, citations: Any = None) -> dict[str, Any]:
    sources = replace(_sources(bucket, backfills), citations_table=citations)
    planned = _plan(sources)
    _run_units(sources, planned)
    for batch in range(planned['series_batches']):
        for deadline in series_deadlines or [_never_spent()]:
            run_series(sources, planned['build_id'], batch, deadline)
    for shard in range(planned['rollup_shards']):
        run_rollup_shard_step(sources, planned['build_id'], shard)
    for item in range(planned['rollup_merges']):
        run_rollup_merge_step(sources, planned['build_id'], item)
    return publish_build(sources, planned['build_id'], now=lambda: _AT)


def _published(bucket: SnapshotBucket) -> dict[str, Any]:
    """What a reader sees of the published build: current.json (build ids blanked), every artifact and every series, by relative key."""
    current = json.loads(bucket.objects[f'{SNAPSHOT_PREFIX}current.json'][0])
    build_id = current.pop('build_id')
    current.pop('previous_build_id')
    for entry in current['scopes'].values():
        series = entry.pop('series')
        assert series == build_id
    prefix = f'{SNAPSHOT_PREFIX}{build_id}/'
    artifacts = {
        key.removeprefix(prefix): bucket.json_at(key) for key in bucket.keys_under(prefix)
        if '/_build/' not in f'/{key.removeprefix(prefix)}' and not key.endswith('manifest.json')
    }
    series = {key.removeprefix(SERIES_PREFIX).rsplit('/', 1)[0]: bucket.json_at(key) for key in bucket.keys_under(SERIES_PREFIX) if key.endswith(f'/{build_id}.json.gz')}
    return {'current': current, 'artifacts': artifacts, 'series': series}


@pytest.fixture
def oracle() -> dict[str, Any]:
    bucket = bucket_with_keyword_latests(_SPEC, _CONFIG)
    _in_process(bucket)
    return _published(bucket)


@pytest.fixture
def bucket() -> SnapshotBucket:
    return bucket_with_keyword_latests(_SPEC, _CONFIG)


@pytest.fixture
def sources(bucket) -> SnapshotSources:
    return _sources(bucket)


@pytest.fixture
def planned(sources) -> dict[str, Any]:
    return _plan(sources)


@pytest.fixture
def small_units():
    """Units of one scope each: every scope and builder group folded in its own invocation."""
    with patch.object(scope_snapshot_dist, 'UNIT_BUDGET_MB', 0.0):
        yield


_PARTS = ['artifacts', 'current', 'series']


class TestEquality:
    @pytest.mark.parametrize('part', _PARTS)
    def test_published_part_equals_the_in_process_build(self, oracle, bucket, part):
        _distributed(bucket)
        assert _published(bucket)[part] == oracle[part]

    @pytest.mark.parametrize('part', _PARTS)
    @pytest.mark.usefixtures('small_units')
    def test_one_scope_a_unit_publishes_the_same_part(self, oracle, bucket, part):
        _distributed(bucket)
        assert _published(bucket)[part] == oracle[part]

    def test_a_series_cut_over_three_turns_publishes_the_same_series(self, oracle, bucket):
        _distributed(bucket, [_FamiliesDeadline(1), _FamiliesDeadline(1), _never_spent()])
        assert _published(bucket)['series'] == oracle['series']


class TestPlan:
    def test_window_builders_share_a_unit_and_unknown_builders_get_the_last(self):
        assert builder_groups(['zeta', 'trends', 'latest', 'group-kpis']) == [('trends', 'group-kpis'), ('latest',), ('zeta',)]

    def test_the_first_unit_holding_all_does_the_keyword_checks(self):
        sets = {'all': {'a', 'b'}, 'market:m': {'a', 'b'}}
        assert [unit.checks for unit in plan_units(sets, sets, 1, ['latest', 'stats'])] == [True, False]

    @pytest.mark.usefixtures('small_units')
    def test_units_cover_every_scope_once_per_builder_group(self):
        sets = {'all': {'a', 'b'}, 'market:m': {'a'}, 'market:n': {'b'}}
        units = plan_units(sets, sets, 1, ['latest', 'stats'])
        assert sorted((unit.builders, unit.scopes) for unit in units) == sorted(
            (group, (key,)) for group in [('latest',), ('stats',)] for key in sets
        )

    def test_a_unit_holds_the_scopes_its_budget_allows(self):
        sets = {f'market:m{index}': {'a'} for index in range(9)}
        assert [len(scopes) for scopes in unit_passes(sets, sets, 1, UnitCost(100.0, 0.0))] == [4, 4, 1]

    def test_a_scope_heavier_than_the_budget_is_a_unit_alone(self):
        sets = {'all': {str(index) for index in range(1_000)}, 'market:m': {'a'}}
        assert unit_passes(sets, sets, 10, UnitCost(1.0, 100.0)) == [['all'], ['market:m']]

    def test_series_batches_hold_whole_families_within_the_keyword_cap(self):
        sets = {'all': {'a', 'b', 'c'}, 'group:g': {'a'}, 'group:g|market:m': {'a'}, 'group:h': {'b'}, 'market:m': {'a', 'b'}}
        with patch.object(scope_snapshot_dist, 'SERIES_BATCH_KEYWORDS', 1):
            assert series_batches(sets, sets) == [['all'], ['group:g', 'group:g|market:m'], ['group:h'], ['market:m']]

    def test_the_map_item_list_names_every_unit_by_index(self, bucket, planned):
        assert json.loads(bucket.objects[units_key(planned['build_id'])][0]) == [{'unit': index} for index in range(planned['units'])]

    def test_the_state_carries_s3_keys_not_lists(self, planned):
        assert sorted(planned) == [
            'bucket', 'build_id', 'rollup_merges', 'rollup_merges_key', 'rollup_shards', 'rollup_shards_key',
            'scopes', 'series_batches', 'series_key', 'units', 'units_key',
        ]

    def test_the_plan_reads_back_with_every_built_scope(self, bucket, planned):
        plan = read_plan(snapshot_store(bucket, SNAPSHOT_BUCKET), planned['build_id'])
        assert plan.scopes['all'] == sorted(scope_keywords(keyword_items(_SPEC))['all'])

    def test_the_plan_lives_inside_the_build(self, planned):
        assert plan_key(planned['build_id']).startswith(f"{SNAPSHOT_PREFIX}{planned['build_id']}/")


class TestIdempotence:
    def test_a_unit_run_twice_reads_no_object_the_second_time(self, bucket, sources, planned):
        run_unit(sources, planned['build_id'], 0)
        bucket.gets.clear()
        assert (run_unit(sources, planned['build_id'], 0)['status'], bucket.gets) == ('done before', [unit_key(planned['build_id'], 0)])

    def test_a_series_turn_after_the_last_reads_no_history(self, sources, planned):
        run_series(sources, planned['build_id'], 0, _never_spent())
        assert run_series(sources, planned['build_id'], 0, _never_spent()) == {
            'build_id': planned['build_id'], 'batch': 0, 'done': True, 'families_built': 0, 'history_reads': 0,
        }

    def test_a_cut_series_turn_answers_not_done(self, sources, planned):
        assert run_series(sources, planned['build_id'], 0, _FamiliesDeadline(1))['done'] is False

    def test_a_cut_family_is_not_saved_complete(self, bucket, sources, planned):
        run_series(sources, planned['build_id'], 0, _FamiliesDeadline(1))
        assert sorted(read_complete(snapshot_store(bucket, SNAPSHOT_BUCKET), series_progress_key(planned['build_id'], 0))) == ['all']


class TestPublish:
    def test_a_missing_unit_publishes_nothing(self, sources, planned):
        for batch in range(planned['series_batches']):
            run_series(sources, planned['build_id'], batch, _never_spent())
        with pytest.raises(SnapshotBuildIncomplete, match='Unit 0'):
            publish_build(sources, planned['build_id'], now=lambda: _AT)

    def test_an_unfinished_series_publishes_nothing(self, sources, planned):
        _run_units(sources, planned)
        with pytest.raises(SnapshotBuildIncomplete, match='not complete'):
            publish_build(sources, planned['build_id'], now=lambda: _AT)

    def test_the_keywords_behind_are_asked_for_once(self, bucket):
        backfills: list[list[str]] = []
        _distributed(bucket, backfills=backfills)
        assert backfills == [[_BEHIND]]

    def test_a_deleted_build_has_no_plan(self, bucket):
        with pytest.raises(SnapshotBuildIncomplete, match='No plan'):
            read_plan(snapshot_store(bucket, SNAPSHOT_BUCKET), 'gone')


class TestRouting:
    def test_a_build_over_one_unit_budget_is_distributed(self, sources):
        with live_rows_budget(_BUDGET):
            assert needs_distribution(sources) is True

    def test_a_one_keyword_tenant_builds_in_process(self, bucket):
        one = replace(_sources(bucket), keywords_table=keywords_table(keyword_items(_SPEC)[:1]))
        assert needs_distribution(one) is False

    def test_the_cost_counts_every_builder_group_over_every_scope(self):
        sets = {'all': {'a'}, 'market:m': {'a'}}
        assert build_cost_mb(sets, sets, 1, ['latest', 'mentions']) == pytest.approx(2 * (16.0 + 0.0035 + 58.0 + 0.0035))


def test_build_unit_defaults_to_no_checks() -> None:
    assert BuildUnit(('latest',), ('all',)).checks is False


#: The spec's keywords' Citations rows (3 a keyword) and one row of a keyword that is not active.
_CITATION_ROWS = [
    {'keyword': keyword_text(index), 'normalized_url': f'https://s{(index + slot) % 4}.example/{slot}', 'citation_count': 1 + slot,
     'citing_providers': ['openai'], 'content_type': 'page'}
    for index in range(_SPEC.keywords) for slot in range(3)
] + [{'keyword': 'retired keyword', 'normalized_url': 'https://s0.example/0', 'citation_count': 2, 'citing_providers': ['gemini'], 'content_type': 'page'}]


class TestCitationRollup:
    def test_the_build_publishes_the_citation_rollup(self, bucket):
        summary = _distributed(bucket, citations=SegmentedTable(_CITATION_ROWS, max_page_rows=10, item_count=len(_CITATION_ROWS)))
        assert (summary['citation_rollup']['status'], summary['citation_rollup']['urls']) == ('built', 4 * 3)

    def test_the_rollup_current_json_is_the_last_object_written(self, bucket):
        _distributed(bucket, citations=SegmentedTable(_CITATION_ROWS, max_page_rows=10, item_count=len(_CITATION_ROWS)))
        assert bucket.puts[-1] == CURRENT_KEY

    def test_the_rollup_table_scope_counts_rows_of_inactive_keywords(self, bucket):
        _distributed(bucket, citations=SegmentedTable(_CITATION_ROWS, max_page_rows=10, item_count=len(_CITATION_ROWS)))
        current = json.loads(bucket.objects[CURRENT_KEY][0])
        manifest = bucket.json_at(manifest_key(current['scopes']['table']['path']))
        assert manifest['totals']['total_citations'] == len(_CITATION_ROWS)

    def test_without_a_citations_table_no_rollup_is_built(self, bucket):
        assert _distributed(bucket)['citation_rollup'] is None

    def test_a_large_citations_table_makes_a_small_tenant_distributed(self, bucket):
        one = replace(_sources(bucket), keywords_table=keywords_table(keyword_items(_SPEC)[:1]), citations_table=SegmentedTable([], 1, item_count=10**6))
        assert needs_distribution(one) is True
