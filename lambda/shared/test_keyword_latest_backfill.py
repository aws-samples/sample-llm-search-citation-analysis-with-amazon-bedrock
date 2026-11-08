"""Tests for the backfill's ``latest`` mode (``KeywordLatestBackfill``): rebuilding every keyword's KeywordLatest object."""

from __future__ import annotations

from typing import Any
from unittest.mock import patch

import pytest

from shared.keyword_latest import read_keyword_latest, record_keyword_latest
from shared.keyword_run_kpis import run_tally_pair
from shared.keyword_run_kpis_backfill import Cursor, KeywordLatestBackfill, keyword_pages, run_backfill
from shared.kpi_engine import answers_from_rows
from shared.partial_contract import PartialConfig
from shared.request_deadline import Deadline
from testing.client_errors import throttled
from testing.deadlines import deadline_after_checks
from testing.keyword_run_kpis_fixtures import rollup_table
from testing.scale_data import (
    BRAND_CONFIG,
    ScaleSpec,
    keyword_run_kpis_item,
    keyword_text,
    run_timestamp,
    search_result_rows,
)
from testing.scope_snapshot_fixtures import SNAPSHOT_BUCKET, SnapshotBucket
from testing.window_rows_fixtures import paged_search_results_table

_SPEC = ScaleSpec(keywords=2, personas=1, runs=4, long_tail=40)
_KEYWORDS = [keyword_text(index) for index in range(_SPEC.keywords)]
_CONFIG = PartialConfig(brand_config=BRAND_CONFIG, personas=('persona-00',))


def _search_rows(runs: int = _SPEC.runs) -> dict[str, list[dict[str, Any]]]:
    return {keyword_text(k): [row for run in range(runs) for row in search_result_rows(_SPEC, k, run)] for k in range(_SPEC.keywords)}


def _rollups(runs: int = _SPEC.runs) -> dict[str, list[dict[str, Any]]]:
    return {keyword_text(k): [keyword_run_kpis_item(_SPEC, k, run) for run in range(runs)] for k in range(_SPEC.keywords)}


def _job(bucket: SnapshotBucket, *, config: PartialConfig = _CONFIG, deadline: Deadline | None = None, rebuild: bool = False) -> KeywordLatestBackfill:
    return KeywordLatestBackfill(
        paged_search_results_table(_search_rows()), rollup_table(_rollups()), bucket, SNAPSHOT_BUCKET, config,
        deadline or Deadline(60), rebuild=rebuild, keyword_ids={keyword: f'id-{keyword}' for keyword in _KEYWORDS},
    )


def _run(job: KeywordLatestBackfill, cursor: Cursor | None = None) -> dict[str, Any]:
    return run_backfill(job, keyword_pages(None, _KEYWORDS, None), cursor or Cursor())


def _stored(bucket: SnapshotBucket, keyword: str = _KEYWORDS[0]) -> dict[str, Any]:
    doc, _ = read_keyword_latest(bucket, SNAPSHOT_BUCKET, keyword)
    assert doc is not None
    return dict(doc)


def _written_run_by_run(runs: range) -> dict[str, Any]:
    """The object the workflow leaves after writing ``runs`` of the first keyword one by one."""
    bucket = SnapshotBucket()
    for run in runs:
        rows = sorted(search_result_rows(_SPEC, 0, run), key=lambda row: row['timestamp_provider'])
        full = run_tally_pair(_KEYWORDS[0], run_timestamp(run), answers_from_rows(rows), BRAND_CONFIG).full
        record_keyword_latest(bucket, SNAPSHOT_BUCKET, rows, full, _CONFIG, keyword_id=f'id-{_KEYWORDS[0]}')
    return _stored(bucket)


def _pass_cut_in_the_first_history_read(bucket: SnapshotBucket) -> dict[str, Any]:
    """A pass whose deadline runs out after the first page of the first keyword's KeywordRunKpis history."""
    job = _job(bucket, deadline=deadline_after_checks(1))
    job.rollups = rollup_table(_rollups(), page_size=1)
    return _run(job)


@pytest.fixture
def bucket() -> SnapshotBucket:
    return SnapshotBucket()


@pytest.fixture
def backfilled(bucket) -> dict[str, Any]:
    return _run(_job(bucket))


class TestRebuild:
    def test_reports_the_latest_mode_done(self, backfilled):
        assert (backfilled['mode'], backfilled['done'], backfilled['keywords_done']) == ('latest', True, 2)

    def test_holds_the_two_newest_runs(self, backfilled, bucket):
        doc = _stored(bucket)
        assert [doc['latest']['timestamp'], doc['previous']['timestamp']] == [run_timestamp(3), run_timestamp(2)]

    def test_tallies_equal_the_ones_the_workflow_writes(self, backfilled, bucket):
        assert _stored(bucket)['tallies'] == _written_run_by_run(range(_SPEC.runs))['tallies']

    def test_series_comes_from_the_whole_stored_history(self, backfilled, bucket):
        assert _stored(bucket)['series'] == _written_run_by_run(range(_SPEC.runs))['series']

    def test_recent_runs_come_from_the_stored_history(self, backfilled, bucket):
        recent = [entry['run_timestamp'] for entry in _stored(bucket)['recent']]
        assert recent == [run_timestamp(run) for run in range(_SPEC.runs)]

    def test_keeps_the_keyword_id(self, backfilled, bucket):
        assert _stored(bucket)['keyword_id'] == f'id-{_KEYWORDS[0]}'


class TestSkips:
    def test_a_second_pass_writes_nothing(self, backfilled, bucket):
        puts = len(bucket.puts)
        response = _run(_job(bucket))
        assert (response['runs_skipped'], len(bucket.puts)) == (4, puts)

    def test_rebuild_rewrites_current_objects(self, backfilled, bucket):
        assert _run(_job(bucket, rebuild=True))['runs_written'] == 4

    def test_a_persona_change_rewrites_every_object(self, backfilled, bucket):
        changed = PartialConfig(brand_config=BRAND_CONFIG, personas=('persona-00', 'persona-01'))
        assert _run(_job(bucket, config=changed))['runs_written'] == 4

    def test_a_keyword_never_analysed_is_done_without_a_write(self, bucket):
        job = _job(bucket)
        response = run_backfill(job, keyword_pages(None, ['never analysed'], None), Cursor())
        assert (response['keywords_done'], bucket.puts) == (1, [])


class TestConcurrency:
    def test_a_newer_run_written_meanwhile_is_kept(self, bucket):
        newer = ScaleSpec(keywords=2, personas=1, runs=5, long_tail=40)
        rows = sorted(search_result_rows(newer, 0, 4), key=lambda row: row['timestamp_provider'])
        full = run_tally_pair(_KEYWORDS[0], run_timestamp(4), answers_from_rows(rows), BRAND_CONFIG).full
        record_keyword_latest(bucket, SNAPSHOT_BUCKET, rows, full, _CONFIG)
        _run(_job(bucket))
        doc = _stored(bucket)
        assert [doc['latest']['timestamp'], doc['previous']['timestamp']] == [run_timestamp(4), run_timestamp(3)]


class TestBudgetAndFailures:
    def test_resumes_at_the_keyword_whose_history_read_the_deadline_cut(self, bucket):
        response = _pass_cut_in_the_first_history_read(bucket)
        assert (response['done'], response['cursor']) == (False, {'scan_key': None, 'keyword': _KEYWORDS[0], 'after': None})

    def test_a_resumed_pass_finishes_every_keyword(self, bucket):
        first = _pass_cut_in_the_first_history_read(bucket)
        resumed = _run(_job(bucket), Cursor.from_event(first['cursor']))
        assert (resumed['done'], resumed['keywords_done']) == (True, 2)

    def test_a_failed_write_is_counted_and_the_pass_goes_on(self, bucket):
        with patch.object(bucket, 'put_object', side_effect=throttled('PutObject')):
            response = _run(_job(bucket))
        assert (response['done'], response['write_failures']) == (True, 2)
