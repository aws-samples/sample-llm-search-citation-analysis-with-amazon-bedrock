"""Tests for the scope snapshot build (``shared.scope_snapshot_build``): scopes, the fold, series, publishing and failures."""

from __future__ import annotations

import gc
import json
import weakref
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import patch

import pytest

from shared import scope_snapshot_build
from shared.keyword_latest import KEYWORDS_PREFIX, keyword_latest_key, latest_tallies, read_keyword_latest
from shared.partial_contract import PartialConfig
from shared.scope_series import ScopeSeries
from shared.scope_series_build import PROGRESS_KEY, SeriesBuildIncomplete, scope_families
from shared.scope_snapshot import SERIES_PREFIX, artifact_key, series_key
from shared.scope_snapshot_build import SnapshotSources, build_snapshots, built_scope_keys, fold_passes
from shared.snapshot_store import SnapshotBuildIncomplete, group_scope, market_scope, scope_dir, scope_keywords
from testing.deadlines import spent_deadline
from testing.scale_data import (
    BRAND_CONFIG,
    ScaleSpec,
    group_id,
    keyword_items,
    keyword_text,
    market_id,
    persona_ids,
    run_timestamp,
)
from testing.scope_snapshot_fixtures import (
    SNAPSHOT_BUCKET,
    GeneratedHistory,
    PendingBuilder,
    SnapshotBucket,
    bucket_with_keyword_latests,
    full_tally,
    keywords_table,
    live_rows_budget,
    write_keyword_latests,
)
from testing.snapshot_fakes import KeywordListBuilder

_SPEC = ScaleSpec(keywords=12, groups=3, largest_group=8, markets=2, personas=1, runs=3, long_tail=30)
_PERSONAS = persona_ids(_SPEC)
_CONFIG = PartialConfig(brand_config=BRAND_CONFIG, personas=_PERSONAS)
#: Rows a scope may read live in these tests: 8 keywords x 1 persona x 4 engines x 2 runs = 64 is over it, 2 keywords are under.
_BUDGET = 40
_START = datetime(2026, 10, 5, 7, 0, tzinfo=UTC)


def _sources(bucket: SnapshotBucket, items: list[dict[str, Any]] | None = None, history: GeneratedHistory | None = None) -> SnapshotSources:
    return SnapshotSources(
        keywords_table(keyword_items(_SPEC) if items is None else items), bucket, SNAPSHOT_BUCKET, BRAND_CONFIG, _PERSONAS,
        history=history, builders={'keyword-list': KeywordListBuilder(), 'pending': PendingBuilder()},
    )


def _build(sources: SnapshotSources, at: datetime = _START) -> dict[str, Any]:
    with live_rows_budget(_BUDGET):
        return build_snapshots(sources, now=lambda: at)


def _current(bucket: SnapshotBucket) -> dict[str, Any]:
    current = json.loads(bucket.objects['scope-snapshots/current.json'][0])
    assert isinstance(current, dict)
    return current


def _series(bucket: SnapshotBucket, key: str) -> ScopeSeries:
    current = _current(bucket)
    return ScopeSeries(key, bucket.json_at(series_key(scope_dir(key), current['scopes'][key]['series'])))


def _rebuilt(key: str, members: set[int], runs: range) -> ScopeSeries:
    series = ScopeSeries(key)
    for index in sorted(members):
        for run in runs:
            series.add(keyword_text(index), full_tally(_SPEC, index, run))
    return series


def _members(key: str, items: list[dict[str, Any]] | None = None) -> set[int]:
    texts = scope_keywords(keyword_items(_SPEC) if items is None else items)[key]
    return {int(text.rsplit(' ', 1)[-1]) for text in texts}


@pytest.fixture
def bucket() -> SnapshotBucket:
    return bucket_with_keyword_latests(_SPEC, _CONFIG)


@pytest.fixture
def built(bucket) -> dict[str, Any]:
    return _build(_sources(bucket, history=GeneratedHistory(_SPEC, _SPEC.runs)))


class TestScopes:
    def test_builds_all_every_market_and_only_the_groups_over_the_live_budget(self):
        sets = scope_keywords(keyword_items(_SPEC))
        with live_rows_budget(_BUDGET):
            chosen = built_scope_keys(sets, len(_PERSONAS))
        large = sorted(key for key in sets if key.startswith('group:') and len(sets[key]) * 4 * 2 > _BUDGET)
        assert chosen == sorted(['all', market_scope(market_id(0)), market_scope(market_id(1)), *large])

    def test_a_small_group_is_left_to_the_live_path(self):
        sets = {'all': {'a'}, group_scope('tiny'): {'a'}}
        assert built_scope_keys(sets, 1) == ['all']

    def test_current_names_every_built_scope(self, built, bucket):
        assert sorted(_current(bucket)['scopes']) == sorted(built_scope_keys_for_spec())


def built_scope_keys_for_spec() -> list[str]:
    with live_rows_budget(_BUDGET):
        return built_scope_keys(scope_keywords(keyword_items(_SPEC)), len(_PERSONAS))


class TestFold:
    def test_reads_every_keyword_latest_object_exactly_once(self, built, bucket):
        reads = [key for key in bucket.gets if key.startswith(KEYWORDS_PREFIX)]
        assert (len(reads), len(set(reads))) == (_SPEC.keywords, _SPEC.keywords)

    def test_a_scope_artifact_holds_every_member_keyword(self, built, bucket):
        stored = bucket.json_at(artifact_key(built['build_id'], scope_dir(group_scope(group_id(0))), 'keywords'))
        assert sorted(stored['keywords']) == sorted(keyword_text(index) for index in _members(group_scope(group_id(0))))

    def test_counts_the_keywords_analyzed_per_scope(self, built, bucket):
        entry = _current(bucket)['scopes']['all']
        assert (entry['keywords_total'], entry['keywords_analyzed']) == (_SPEC.keywords, _SPEC.keywords)

    def test_a_keyword_without_an_object_is_not_analyzed(self, bucket):
        bucket.delete_object(Key=next(key for key in bucket.objects if key.startswith(KEYWORDS_PREFIX)))
        _build(_sources(bucket))
        assert _current(bucket)['scopes']['all']['keywords_analyzed'] == _SPEC.keywords - 1


class _Accumulator:
    """A builder's accumulator that can be watched for release."""


@dataclass
class _ReleaseWatchingBuilder:
    """A builder that, at each finalize, counts the accumulators finalized before that are still alive."""

    name: str = 'watching'
    finalized: list[weakref.ref[_Accumulator]] = field(default_factory=list)
    alive_at_finalize: list[int] = field(default_factory=list)

    def fold(self, acc: _Accumulator | None, latest: Any, scope: Any) -> _Accumulator:
        del latest, scope
        return acc or _Accumulator()

    def finalize(self, acc: _Accumulator | None) -> dict[str, Any]:
        gc.collect()
        self.alive_at_finalize.append(sum(ref() is not None for ref in self.finalized))
        if acc is not None:
            self.finalized.append(weakref.ref(acc))
        return {}

    def serve(self, artifacts: Any, params: Any) -> None:
        """Serves nothing: the test reads only what the build released."""


class TestMemory:
    def test_a_scopes_accumulators_are_released_once_it_is_written(self, bucket):
        watching = _ReleaseWatchingBuilder()
        sources = _sources(bucket)
        _build(SnapshotSources(sources.keywords_table, bucket, SNAPSHOT_BUCKET, BRAND_CONFIG, _PERSONAS, builders={'watching': watching}))
        assert (len(watching.finalized), set(watching.alive_at_finalize)) == (len(built_scope_keys_for_spec()), {0})


class TestFoldPasses:
    def test_all_and_the_markets_come_before_the_groups(self):
        sets = {'all': {'a', 'b'}, 'group:g': {'a'}, 'market:m': {'a', 'b'}}
        assert fold_passes(sets, sets, 1) == [['all', 'market:m', 'group:g']]

    def test_a_pass_holds_at_most_the_pass_weight(self):
        sets = {'all': set('abcd'), 'market:m': set('abcd'), 'group:g': set('ab')}
        with patch.object(scope_snapshot_build, 'FOLD_PASS_WEIGHT', 8):
            assert fold_passes(sets, sets, 1) == [['all', 'market:m'], ['group:g']]

    def test_a_scope_heavier_than_a_pass_gets_one_alone(self):
        sets = {'all': set('abcd'), 'group:g': set('ab')}
        with patch.object(scope_snapshot_build, 'FOLD_PASS_WEIGHT', 3):
            assert fold_passes(sets, sets, 1) == [['all'], ['group:g']]

    def test_personas_weigh_each_keyword(self):
        sets = {'all': set('ab'), 'group:g': set('ab')}
        with patch.object(scope_snapshot_build, 'FOLD_PASS_WEIGHT', 4):
            assert fold_passes(sets, sets, 2) == [['all'], ['group:g']]

    def test_a_build_in_one_scope_per_pass_writes_the_same_artifacts(self, bucket):
        whole = _build(_sources(bucket))
        with patch.object(scope_snapshot_build, 'FOLD_PASS_WEIGHT', 1):
            split = _build(_sources(bucket), _START + timedelta(hours=1))
        key = group_scope(group_id(0))
        artifacts = [bucket.json_at(artifact_key(summary['build_id'], scope_dir(key), 'keywords')) for summary in (whole, split)]
        assert (artifacts[0] == artifacts[1], split['fold_passes'] > 1) == (True, True)

    def test_a_build_in_passes_counts_each_object_once(self, bucket):
        with patch.object(scope_snapshot_build, 'FOLD_PASS_WEIGHT', 1):
            summary = _build(_sources(bucket))
        assert (summary['keyword_latest_found'], summary['keywords']) == (_SPEC.keywords, _SPEC.keywords)


class TestUnimplementedBuilders:
    def test_an_unimplemented_builder_is_skipped_and_named(self, built):
        assert (built['status'], built['skipped_artifacts']) == ('built', ['pending'])

    def test_the_other_builders_artifacts_are_written(self, built, bucket):
        assert _current(bucket)['scopes']['all']['artifacts'] == ['keywords']


class TestSeries:
    def test_the_first_build_series_equals_a_rebuild_of_every_run(self, built, bucket):
        assert _series(bucket, 'all').agrees_with(_rebuilt('all', _members('all'), range(_SPEC.runs))) is True

    def test_without_history_the_series_holds_the_keyword_latest_runs(self, bucket):
        _build(_sources(bucket))
        doc, _ = read_keyword_latest(bucket, SNAPSHOT_BUCKET, keyword_text(0))
        assert doc is not None
        assert sorted(_series(bucket, 'all').rows) == [tally.timestamp for tally in latest_tallies(doc)]

    def test_a_member_leaving_a_group_is_subtracted(self, built, bucket):
        key = group_scope(group_id(0))
        leaver = min(_members(key))
        items = keyword_items(_SPEC)
        items[leaver]['group_ids'] = set(items[leaver]['group_ids']) - {group_id(0)}
        _build(_sources(bucket, items, GeneratedHistory(_SPEC, _SPEC.runs)), _START + timedelta(hours=1))
        assert _series(bucket, key).agrees_with(_rebuilt(key, _members(key) - {leaver}, range(_SPEC.runs))) is True

    def test_a_membership_change_reads_only_the_changed_keywords_history(self, built, bucket):
        items = keyword_items(_SPEC)
        leaver = min(_members(group_scope(group_id(0))))
        items[leaver]['group_ids'] = set(items[leaver]['group_ids']) - {group_id(0)}
        history = GeneratedHistory(_SPEC, _SPEC.runs)
        _build(_sources(bucket, items, history), _START + timedelta(hours=1))
        assert history.reads == [keyword_text(leaver)]

    def test_a_new_run_is_added_without_reading_history(self, built, bucket):
        newer = ScaleSpec(keywords=12, groups=3, largest_group=8, markets=2, personas=1, runs=4, long_tail=30)
        write_keyword_latests(bucket, newer, [3], _CONFIG)
        history = GeneratedHistory(_SPEC, _SPEC.runs)
        summary = _build(_sources(bucket, history=history), _START + timedelta(days=1))
        assert (summary['history_reads'], len(_series(bucket, 'all').rows)) == (0, 4)

    def test_every_seventh_build_rebuilds_and_agrees(self, built, bucket):
        summaries = [_build(_sources(bucket, history=GeneratedHistory(_SPEC, _SPEC.runs)), _START + timedelta(hours=hour)) for hour in range(1, 8)]
        assert [(summary['series_rebuilt'] > 0, summary['self_check_mismatches']) for summary in summaries][-1] == (True, [])

    def test_an_owned_domain_change_rebuilds_every_series(self, built, bucket):
        changed = {**BRAND_CONFIG, 'first_party_domains': ['another-owned.example']}
        sources = _sources(bucket, history=GeneratedHistory(_SPEC, _SPEC.runs))
        summary = _build(SnapshotSources(sources.keywords_table, bucket, SNAPSHOT_BUCKET, changed, _PERSONAS, sources.history, sources.builders), _START + timedelta(hours=1))
        assert summary['series_rebuilt'] == built['scopes']


@dataclass
class _SeriesDeadline:
    """A deadline that lets the series step finish ``families`` families of scopes and stops it at the next one; nothing else stops."""

    families: int
    checks: int = 0

    def stop_reading(self, label: str) -> bool:
        if label != 'the scope series':
            return False
        self.checks += 1
        return self.checks > self.families


def _cut_build(bucket: SnapshotBucket, families: int) -> SeriesBuildIncomplete:
    with patch('shared.scope_snapshot_build.current_deadline', return_value=_SeriesDeadline(families)), pytest.raises(SeriesBuildIncomplete) as raised:
        _build(_sources(bucket, history=GeneratedHistory(_SPEC, _SPEC.runs)))
    return raised.value


class TestResumableSeries:
    def test_the_scopes_are_updated_in_families_that_share_keywords(self):
        keys = ['all', 'group:a', 'group:a|market:m1', 'group:b|market:m1', 'market:m1']
        assert scope_families(keys) == [['all'], ['group:a', 'group:a|market:m1'], ['group:b|market:m1'], ['market:m1']]

    def test_a_series_step_out_of_time_says_how_many_scopes_it_saved(self, bucket):
        assert _cut_build(bucket, 1).scopes_saved == 1

    def test_a_series_step_out_of_time_never_publishes(self, bucket):
        _cut_build(bucket, 1)
        assert 'scope-snapshots/current.json' not in bucket.objects

    def test_the_next_build_resumes_the_saved_series_and_rebuilds_only_the_rest(self, bucket):
        _cut_build(bucket, 1)
        summary = _build(_sources(bucket, history=GeneratedHistory(_SPEC, _SPEC.runs)), _START + timedelta(minutes=20))
        assert (summary['series_resumed'], summary['series_rebuilt']) == (1, summary['scopes'] - 1)

    def test_a_resumed_series_equals_a_rebuild_of_every_run(self, bucket):
        _cut_build(bucket, 1)
        _build(_sources(bucket, history=GeneratedHistory(_SPEC, _SPEC.runs)), _START + timedelta(minutes=20))
        assert _series(bucket, 'all').agrees_with(_rebuilt('all', _members('all'), range(_SPEC.runs))) is True

    def test_publishing_forgets_the_saved_series(self, bucket):
        _cut_build(bucket, 1)
        _build(_sources(bucket, history=GeneratedHistory(_SPEC, _SPEC.runs)), _START + timedelta(minutes=20))
        assert PROGRESS_KEY not in bucket.objects


@dataclass
class _HistoryDeadline:
    """A deadline that lets the series history read apply ``keywords`` keywords and stops it at the next; nothing else stops."""

    keywords: int
    checks: int = 0

    def stop_reading(self, label: str) -> bool:
        if label != 'the scope series history':
            return False
        self.checks += 1
        return self.checks > self.keywords


class TestCutInsideAFamily:
    @pytest.fixture
    def cut(self, bucket) -> SeriesBuildIncomplete:
        with (
            patch('shared.scope_snapshot_build.current_deadline', return_value=_HistoryDeadline(5)),
            pytest.raises(SeriesBuildIncomplete) as raised,
        ):
            _build(_sources(bucket, history=GeneratedHistory(_SPEC, _SPEC.runs)))
        return raised.value

    def test_a_cut_inside_the_first_family_still_saves_its_partial_series(self, cut):
        assert cut.scopes_saved == 1

    def test_the_next_build_reads_only_the_members_the_cut_left(self, cut, bucket):
        history = GeneratedHistory(_SPEC, _SPEC.runs)
        _build(_sources(bucket, history=history), _START + timedelta(minutes=20))
        left = sorted(keyword_text(index) for index in _members('all'))[5:]
        assert set(history.reads[:len(left)]) == set(left)

    def test_a_resumed_series_cut_again_saves_what_it_added(self, cut, bucket):
        with (
            patch('shared.scope_snapshot_build.current_deadline', return_value=_HistoryDeadline(3)),
            pytest.raises(SeriesBuildIncomplete) as raised,
        ):
            _build(_sources(bucket, history=GeneratedHistory(_SPEC, _SPEC.runs)), _START + timedelta(minutes=20))
        assert raised.value.scopes_saved == 1

    def test_three_cut_builds_then_one_finish_equal_a_rebuild_of_every_run(self, cut, bucket):
        for minutes in (20, 40):
            with (
                patch('shared.scope_snapshot_build.current_deadline', return_value=_HistoryDeadline(3)),
                pytest.raises(SeriesBuildIncomplete),
            ):
                _build(_sources(bucket, history=GeneratedHistory(_SPEC, _SPEC.runs)), _START + timedelta(minutes=minutes))
        _build(_sources(bucket, history=GeneratedHistory(_SPEC, _SPEC.runs)), _START + timedelta(minutes=60))
        assert _series(bucket, 'all').agrees_with(_rebuilt('all', _members('all'), range(_SPEC.runs))) is True

    def test_the_finished_series_equals_a_rebuild_of_every_run(self, cut, bucket):
        _build(_sources(bucket, history=GeneratedHistory(_SPEC, _SPEC.runs)), _START + timedelta(minutes=20))
        assert _series(bucket, 'all').agrees_with(_rebuilt('all', _members('all'), range(_SPEC.runs))) is True


@dataclass
class _NewestRuns:
    """A ``NewestRun``: each keyword's newest generated run, one run newer for the keywords ``ahead``, none for ``never_run``."""

    ahead: frozenset[str] = frozenset()
    never_run: frozenset[str] = frozenset()

    def __call__(self, keyword: str) -> str | None:
        if keyword in self.never_run:
            return None
        return run_timestamp(_SPEC.runs if keyword in self.ahead else _SPEC.runs - 1)


@dataclass
class _BackfillRequests:
    """A ``request_backfill`` that records the keywords of each request."""

    requests: list[list[str]] = field(default_factory=list)

    def __call__(self, keywords: list[str]) -> bool:
        self.requests.append(keywords)
        return True


def _behind_build(bucket: SnapshotBucket, newest: _NewestRuns, backfill: _BackfillRequests | None = None) -> dict[str, Any]:
    return _build(replace(_sources(bucket), newest_run=newest, request_backfill=backfill))


class TestKeywordsLeftBehind:
    def test_a_keyword_with_runs_and_no_object_is_counted_behind_in_its_scopes(self, bucket):
        bucket.delete_object(Key=keyword_latest_key(keyword_text(0)))
        _behind_build(bucket, _NewestRuns())
        assert _current(bucket)['scopes']['all']['keywords_behind'] == 1

    def test_a_keyword_whose_object_lacks_its_newest_run_is_counted_behind(self, bucket):
        _behind_build(bucket, _NewestRuns(ahead=frozenset({keyword_text(3)})))
        assert (_current(bucket)['scopes']['all']['keywords_behind'], _current(bucket)['keywords_behind']) == (1, 1)

    def test_a_keyword_that_never_ran_and_has_no_object_is_not_behind(self, bucket):
        bucket.delete_object(Key=keyword_latest_key(keyword_text(0)))
        _behind_build(bucket, _NewestRuns(never_run=frozenset({keyword_text(0)})))
        assert _current(bucket)['scopes']['all']['keywords_behind'] == 0

    def test_the_keywords_behind_are_sent_to_the_latest_backfill(self, bucket):
        backfill = _BackfillRequests()
        bucket.delete_object(Key=keyword_latest_key(keyword_text(0)))
        summary = _behind_build(bucket, _NewestRuns(ahead=frozenset({keyword_text(3)})), backfill)
        assert (backfill.requests, summary['backfill_requested']) == ([sorted([keyword_text(0), keyword_text(3)])], True)

    def test_no_backfill_is_asked_when_every_object_is_current(self, bucket):
        backfill = _BackfillRequests()
        summary = _behind_build(bucket, _NewestRuns(), backfill)
        assert (backfill.requests, summary['keywords_behind']) == ([], 0)


class TestPublishing:
    def test_a_spent_deadline_never_switches_the_pointer(self, bucket):
        with patch('shared.scope_snapshot_build.current_deadline', return_value=spent_deadline()), pytest.raises(SnapshotBuildIncomplete):
            _build(_sources(bucket))
        assert 'scope-snapshots/current.json' not in bucket.objects

    def test_a_config_change_counts_the_stale_objects(self, built, bucket):
        changed = PartialConfig(brand_config=BRAND_CONFIG, personas=('persona-00', 'persona-07'))
        sources = _sources(bucket)
        summary = _build(SnapshotSources(sources.keywords_table, bucket, SNAPSHOT_BUCKET, BRAND_CONFIG, changed.personas, None, sources.builders), _START + timedelta(hours=1))
        assert summary['keywords_stale_config'] == _SPEC.keywords

    def test_series_of_builds_no_longer_kept_are_deleted(self, built, bucket):
        for hour in (1, 2):
            _build(_sources(bucket), _START + timedelta(hours=hour))
        ids = {key.rsplit('/', 1)[-1] for key in bucket.keys_under(f'{SERIES_PREFIX}{scope_dir("all")}/')}
        current = _current(bucket)
        assert ids == {f'{current["build_id"]}.json.gz', f'{current["previous_build_id"]}.json.gz'}
