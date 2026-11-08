"""Tests for serving scoped views from the snapshot (``shared.scope_snapshot_serve``) and the view jobs behind it (``shared.view_jobs``)."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from shared import scope_snapshot_serve
from shared.partial_contract import PartialConfig
from shared.scope_params import ReportScope
from shared.scope_snapshot import JOBS_PREFIX, artifact_key
from shared.scope_snapshot_build import SnapshotSources, build_snapshots
from shared.scope_snapshot_serve import (
    SnapshotReader,
    StoredArtifacts,
    open_snapshot,
    request_snapshot_rebuild,
    snapshot_page,
    view_job_response,
)
from shared.snapshot_artifacts import artifacts_coverage, encode_snapshot_cursor
from shared.snapshot_store import scope_dir
from shared.view_jobs import JOB_STALE_SECONDS, builder_jobs, run_view_job
from testing.scale_data import BRAND_CONFIG, ScaleSpec, group_id, keyword_items, persona_ids
from testing.scope_snapshot_fixtures import (
    SNAPSHOT_BUCKET,
    PendingBuilder,
    RecordingLambda,
    SnapshotBucket,
    bucket_with_keyword_latests,
    keywords_table,
    live_rows_budget,
    write_keyword_latests,
)
from testing.snapshot_fakes import KeywordListBuilder

_SPEC = ScaleSpec(keywords=10, groups=2, largest_group=6, markets=2, personas=1, runs=2, long_tail=20)
_PERSONAS = persona_ids(_SPEC)
_BUILDERS = {'keyword-list': KeywordListBuilder(), 'pending': PendingBuilder()}
_BUILT_AT = datetime(2026, 10, 5, 7, 0, tzinfo=UTC)
_KEYWORDS = tuple(sorted(item['keyword'] for item in keyword_items(_SPEC)))
_ALL = ReportScope(kind='all', keywords=_KEYWORDS, scope={'mode': 'all'}, label='All keywords')
_FUNCTION = 'citation-analysis-generate-summary'


def _build(bucket: SnapshotBucket, at: datetime = _BUILT_AT, items: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    sources = SnapshotSources(keywords_table(keyword_items(_SPEC) if items is None else items), bucket, SNAPSHOT_BUCKET, BRAND_CONFIG, _PERSONAS, builders=_BUILDERS)
    with live_rows_budget(40):
        return build_snapshots(sources, now=lambda: at)


@pytest.fixture
def bucket() -> SnapshotBucket:
    return bucket_with_keyword_latests(_SPEC, PartialConfig(brand_config=BRAND_CONFIG, personas=_PERSONAS))


@pytest.fixture
def built(bucket) -> dict[str, Any]:
    return _build(bucket)


@pytest.fixture
def invoked() -> RecordingLambda:
    return RecordingLambda()


@pytest.fixture
def clock() -> dict[str, float]:
    return {'now': 1_000.0}


def _reader(bucket: SnapshotBucket, invoked: RecordingLambda, clock: dict[str, float], *, function: str | None = _FUNCTION, personas: tuple[str, ...] = _PERSONAS, now: datetime = _BUILT_AT) -> SnapshotReader:
    return SnapshotReader(
        bucket, SNAPSHOT_BUCKET, invoked, function, lambda: personas,
        clock=lambda: clock['now'], wall_clock=lambda: clock['now'], now=lambda: now,
    )


def _opened(reader: SnapshotReader, scope: ReportScope, updated_at: str | None) -> StoredArtifacts:
    """The build ``reader`` serves ``scope`` from (the test fails when there is none)."""
    artifacts = reader.open(scope, updated_at)
    assert artifacts is not None
    return artifacts


def _opened_after_builds(bucket: SnapshotBucket, invoked: RecordingLambda, clock: dict[str, float], builds: int) -> StoredArtifacts:
    """The ``all`` build served once ``builds`` more builds (an hour apart) were published and the pointer cache expired."""
    for hour in range(1, builds + 1):
        _build(bucket, _BUILT_AT + timedelta(hours=hour))
    clock['now'] += 60
    return _opened(_reader(bucket, invoked, clock), _ALL, BRAND_CONFIG['updated_at'])


def _run_first_job(reader: SnapshotReader, invoked: RecordingLambda, bucket: SnapshotBucket, route: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Ask ``reader`` for ``route`` (starting its job) and run that job; the job's summary."""
    reader.view_job(route, params or {}, _ALL, None)
    return run_view_job(bucket, SNAPSHOT_BUCKET, invoked.invocations[0]['job_id'], computers=builder_jobs(_BUILDERS))


def _body(response: dict[str, Any]) -> dict[str, Any]:
    return json.loads(response['body'])


class TestOpen:
    def test_a_matching_build_is_fresh(self, built, bucket, invoked, clock):
        artifacts = _opened(_reader(bucket, invoked, clock), _ALL, BRAND_CONFIG['updated_at'])
        assert (artifacts.build_id, artifacts.stale, artifacts.refreshing) == (built['build_id'], False, False)

    def test_serves_the_stored_artifact(self, built, bucket, invoked, clock):
        artifacts = _opened(_reader(bucket, invoked, clock), _ALL, BRAND_CONFIG['updated_at'])
        served = KeywordListBuilder().serve(artifacts, {})
        assert served is not None
        assert sorted(served['keywords']) == list(_KEYWORDS)

    def test_reads_an_artifact_once_however_often_it_is_loaded(self, built, bucket, invoked, clock):
        artifacts = _opened(_reader(bucket, invoked, clock), _ALL, BRAND_CONFIG['updated_at'])
        bucket.gets.clear()
        artifacts.load('keywords')
        artifacts.load('keywords')
        assert len(bucket.gets) == 1

    def test_the_series_loads_from_outside_the_build(self, built, bucket, invoked, clock):
        artifacts = _opened(_reader(bucket, invoked, clock), _ALL, BRAND_CONFIG['updated_at'])
        series = artifacts.load('series')
        assert series is not None
        assert sorted(series['current']) == list(_KEYWORDS)

    def test_one_keyword_or_an_id_list_has_no_snapshot(self, built, bucket, invoked, clock):
        scope = ReportScope(kind='keywords', keywords=_KEYWORDS[:2], scope={'keyword_ids': ['a', 'b']}, label='2 keywords')
        opened = _reader(bucket, invoked, clock).open(scope, None)
        assert (opened, invoked.invocations) == (None, [])

    def test_without_a_bucket_nothing_is_served(self, monkeypatch):
        monkeypatch.delenv('SCOPE_SNAPSHOT_BUCKET', raising=False)
        assert open_snapshot(_ALL, None) is None


class TestStaleness:
    def test_a_keyword_change_serves_the_previous_build_as_stale_and_refreshing(self, built, bucket, invoked, clock):
        scope = ReportScope(kind='all', keywords=(*_KEYWORDS, 'a new keyword'), scope={'mode': 'all'}, label='All keywords')
        artifacts = _opened(_reader(bucket, invoked, clock), scope, BRAND_CONFIG['updated_at'])
        assert (artifacts.build_id, artifacts.stale, artifacts.refreshing) == (built['build_id'], True, True)

    def test_a_keyword_change_requests_one_rebuild_however_many_readers_ask(self, built, bucket, invoked, clock):
        scope = ReportScope(kind='all', keywords=(*_KEYWORDS, 'a new keyword'), scope={'mode': 'all'}, label='All keywords')
        for _ in range(3):
            _reader(bucket, invoked, clock).open(scope, BRAND_CONFIG['updated_at'])
        assert invoked.invocations == [{'action': 'build_scope_snapshots', 'reason': 'all stale: keywords'}]

    def test_a_brand_config_change_is_stale(self, built, bucket, invoked, clock):
        artifacts = _opened(_reader(bucket, invoked, clock), _ALL, '2026-10-05T09:00:00Z')
        assert (artifacts.stale, [call['reason'] for call in invoked.invocations]) == (True, ['all stale: brand_config'])

    def test_a_persona_change_is_stale(self, built, bucket, invoked, clock):
        artifacts = _opened(_reader(bucket, invoked, clock, personas=('persona-00', 'persona-01')), _ALL, BRAND_CONFIG['updated_at'])
        assert artifacts.stale is True

    def test_objects_of_another_config_are_stale_without_a_rebuild_request(self, bucket, invoked, clock):
        stale_bucket = SnapshotBucket()
        write_keyword_latests(stale_bucket, _SPEC, range(_SPEC.runs), PartialConfig(brand_config=BRAND_CONFIG, personas=('persona-09',)))
        _build(stale_bucket)
        artifacts = _opened(_reader(stale_bucket, invoked, clock), _ALL, BRAND_CONFIG['updated_at'])
        assert (artifacts.stale, invoked.invocations) == (True, [])

    def test_no_build_answers_none_and_requests_one(self, bucket, invoked, clock):
        opened = _reader(bucket, invoked, clock).open(_ALL, None)
        assert (opened, len(invoked.invocations)) == (None, 1)

    def test_a_group_that_grew_past_the_budget_since_the_build_requests_one(self, built, bucket, invoked, clock):
        scope = ReportScope(kind='group', keywords=_KEYWORDS[:1], scope={'group_ids': ['group-not-built']}, label='Grown')
        opened = _reader(bucket, invoked, clock).open(scope, None)
        assert (opened, [call['reason'] for call in invoked.invocations]) == (None, ['no build of group:group-not-built'])

    def test_without_a_builder_lambda_a_stale_build_is_not_refreshing(self, built, bucket, invoked, clock):
        artifacts = _opened(_reader(bucket, invoked, clock, function=None), _ALL, '2026-10-05T09:00:00Z')
        assert (artifacts.stale, artifacts.refreshing) == (True, False)


class TestViewJobs:
    def test_the_first_get_answers_202_and_starts_one_job(self, built, bucket, invoked, clock):
        response = _reader(bucket, invoked, clock).view_job('keyword-list', {'days': 45}, _ALL, None)
        assert (response['statusCode'], _body(response)['status'], [call['action'] for call in invoked.invocations]) == (202, 'computing', ['view_job'])

    def test_a_repeated_get_shares_the_running_job(self, built, bucket, invoked, clock):
        reader = _reader(bucket, invoked, clock)
        first, second = (_body(reader.view_job('keyword-list', {'days': 45}, _ALL, None)) for _ in range(2))
        assert (first['job']['id'] == second['job']['id'], len(invoked.invocations)) == (True, 1)

    def test_a_finished_job_answers_200_with_the_view(self, built, bucket, invoked, clock):
        reader = _reader(bucket, invoked, clock)
        _run_first_job(reader, invoked, bucket, 'keyword-list', {'days': 45})
        response = reader.view_job('keyword-list', {'days': 45}, _ALL, None)
        assert (response['statusCode'], sorted(_body(response)['keywords']), _body(response)['params']) == (200, list(_KEYWORDS), {'days': 45})

    def test_a_job_answer_equals_the_snapshot_answer(self, built, bucket, invoked, clock):
        reader = _reader(bucket, invoked, clock)
        _run_first_job(reader, invoked, bucket, 'keyword-list')
        stored = _opened(reader, _ALL, BRAND_CONFIG['updated_at'])
        served = KeywordListBuilder().serve(stored, {})
        assert served is not None
        assert sorted(_body(reader.view_job('keyword-list', {}, _ALL, None))['keywords']) == sorted(served['keywords'])

    def test_an_unimplemented_builder_fails_the_job_once(self, built, bucket, invoked, clock):
        reader = _reader(bucket, invoked, clock)
        summary = _run_first_job(reader, invoked, bucket, 'pending')
        response = reader.view_job('pending', {}, _ALL, None)
        assert (summary['status'], response['statusCode'], _body(response)['status']) == ('failed', 200, 'failed')

    def test_the_get_after_a_failure_starts_the_job_again(self, built, bucket, invoked, clock):
        reader = _reader(bucket, invoked, clock)
        _run_first_job(reader, invoked, bucket, 'pending')
        reader.view_job('pending', {}, _ALL, None)
        assert (reader.view_job('pending', {}, _ALL, None)['statusCode'], len(invoked.invocations)) == (202, 2)

    def test_a_job_that_died_is_started_again(self, built, bucket, invoked, clock):
        _reader(bucket, invoked, clock).view_job('keyword-list', {}, _ALL, None)
        later = _reader(bucket, invoked, clock, now=_BUILT_AT + timedelta(seconds=JOB_STALE_SECONDS + 1))
        assert (later.view_job('keyword-list', {}, _ALL, None)['statusCode'], len(invoked.invocations)) == (202, 2)

    def test_a_new_build_asks_a_new_question(self, built, bucket, invoked, clock):
        first = _body(_reader(bucket, invoked, clock).view_job('keyword-list', {}, _ALL, None))['job']['id']
        _build(bucket, _BUILT_AT + timedelta(hours=1))
        clock['now'] += 60
        second = _body(_reader(bucket, invoked, clock).view_job('keyword-list', {}, _ALL, None))['job']['id']
        assert first != second

    def test_without_a_builder_lambda_the_job_fails(self, built, bucket, invoked, clock):
        response = _reader(bucket, invoked, clock, function=None).view_job('keyword-list', {}, _ALL, None)
        assert (response['statusCode'], _body(response)['status'], bucket.keys_under(JOBS_PREFIX)) == (200, 'failed', [])

    def test_without_a_bucket_the_job_fails(self, monkeypatch):
        monkeypatch.delenv('SCOPE_SNAPSHOT_BUCKET', raising=False)
        assert _body(view_job_response('keyword-list', {}, _ALL, None))['status'] == 'failed'

    def test_a_job_without_a_status_is_skipped(self, bucket):
        assert run_view_job(bucket, SNAPSHOT_BUCKET, 'missing', computers=builder_jobs(_BUILDERS))['status'] == 'skipped'


class TestKeywordsBehind:
    @pytest.fixture
    def behind(self, bucket, invoked, clock) -> StoredArtifacts:
        sources = SnapshotSources(
            keywords_table(keyword_items(_SPEC)), bucket, SNAPSHOT_BUCKET, BRAND_CONFIG, _PERSONAS, builders=_BUILDERS,
            newest_run=lambda keyword: '2099-01-01T00:00:00.000000Z' if keyword == _KEYWORDS[0] else None,
        )
        with live_rows_budget(40):
            build_snapshots(sources, now=lambda: _BUILT_AT)
        return _opened(_reader(bucket, invoked, clock), _ALL, BRAND_CONFIG['updated_at'])

    def test_a_build_with_a_keyword_behind_is_served_stale(self, behind):
        assert (behind.stale, behind.keywords_behind) == (True, 1)

    def test_a_keyword_behind_requests_no_rebuild(self, behind, invoked):
        assert invoked.invocations == []

    def test_the_coverage_leaves_the_keyword_behind_out(self, behind):
        assert artifacts_coverage(behind) == {'keywords_total': len(_KEYWORDS), 'keywords_analyzed': len(_KEYWORDS) - 1, 'complete': False}


class TestCursors:
    def test_a_cursor_of_the_previous_build_reads_that_builds_metadata(self, built, bucket, invoked, clock):
        _build(bucket, _BUILT_AT + timedelta(hours=1), items=keyword_items(_SPEC)[1:])
        clock['now'] += 60
        current = _opened(_reader(bucket, invoked, clock), ReportScope(kind='all', keywords=_KEYWORDS[1:], scope={'mode': 'all'}, label='All'), BRAND_CONFIG['updated_at'])
        previous = current.at_build(built['build_id'])
        assert (current.keywords_total, previous.keywords_total, previous.series_id, previous.stale) == (len(_KEYWORDS) - 1, len(_KEYWORDS), built['build_id'], True)

    def test_a_cursor_of_the_previous_build_answers_as_of_that_build(self, built, bucket, invoked, clock):
        artifacts = _opened_after_builds(bucket, invoked, clock, 1)
        assert artifacts.at_build(built['build_id']).built_at == '2026-10-05T07:00:00Z'

    def test_a_cursor_of_the_previous_build_reads_that_build(self, built, bucket, invoked, clock):
        token = encode_snapshot_cursor(5, 10, built['build_id'])
        artifacts = _opened_after_builds(bucket, invoked, clock, 1)
        cursor, page_artifacts, error = snapshot_page(token, artifacts)
        assert (cursor is not None and cursor.offset, page_artifacts.build_id, error) == (5, built['build_id'], None)

    def test_a_cursor_of_a_deleted_build_has_expired(self, built, bucket, invoked, clock):
        token = encode_snapshot_cursor(5, 10, built['build_id'])
        artifacts = _opened_after_builds(bucket, invoked, clock, 2)
        _, _, error = snapshot_page(token, artifacts)
        assert error is not None
        assert (error['statusCode'], _body(error)['code']) == (400, 'cursor_expired')

    def test_no_token_starts_the_current_build(self, built, bucket, invoked, clock):
        artifacts = _opened(_reader(bucket, invoked, clock), _ALL, BRAND_CONFIG['updated_at'])
        cursor, page_artifacts, _ = snapshot_page(None, artifacts)
        assert (cursor is not None and cursor.offset, page_artifacts.build_id) == (0, built['build_id'])


def test_the_reader_follows_the_environment(monkeypatch):
    made: list[tuple[str, str | None]] = []
    monkeypatch.setenv('SCOPE_SNAPSHOT_BUCKET', SNAPSHOT_BUCKET)
    monkeypatch.setenv('SCOPE_SNAPSHOT_FUNCTION_NAME', _FUNCTION)
    monkeypatch.setattr(scope_snapshot_serve, '_reader', lambda bucket, function: made.append((bucket, function)) or 'reader')
    assert (scope_snapshot_serve.reader(), made) == ('reader', [(SNAPSHOT_BUCKET, _FUNCTION)])


def test_two_requests_for_one_artifact_of_a_build_read_it_once(built, bucket, invoked, clock):
    for _ in range(2):
        _opened(_reader(bucket, invoked, clock), _ALL, BRAND_CONFIG['updated_at']).load('keywords')
    key = artifact_key(built['build_id'], scope_dir('all'), 'keywords')
    assert bucket.gets.count(key) == 1


def test_a_group_scope_is_served_from_its_build(built, bucket, invoked, clock):
    members = tuple(sorted(item['keyword'] for item in keyword_items(_SPEC) if group_id(0) in item.get('group_ids', set())))
    scope = ReportScope(kind='group', keywords=members, scope={'group_ids': [group_id(0)]}, label='Group 0')
    artifacts = _opened(_reader(bucket, invoked, clock), scope, BRAND_CONFIG['updated_at'])
    stored = artifacts.load('keywords')
    assert stored is not None
    assert sorted(stored['keywords']) == list(members)


def test_a_writer_rebuild_request_is_debounced_with_the_readers(bucket, invoked, clock, monkeypatch):
    monkeypatch.setattr(scope_snapshot_serve, 'reader', lambda: _reader(bucket, invoked, clock))
    started = [request_snapshot_rebuild('keywords added'), request_snapshot_rebuild('group changed')]
    assert (started, [call['reason'] for call in invoked.invocations]) == ([True, False], ['keywords added'])


def test_a_writer_rebuild_request_without_a_bucket_starts_nothing(monkeypatch):
    monkeypatch.delenv('SCOPE_SNAPSHOT_BUCKET', raising=False)
    assert request_snapshot_rebuild('keywords added') is False

