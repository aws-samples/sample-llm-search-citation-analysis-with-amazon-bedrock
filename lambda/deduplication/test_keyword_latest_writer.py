"""Tests for the KeywordLatest object and KeywordRunBrands row the Deduplication Lambda writes when a keyword's run is done."""

from __future__ import annotations

import os
from contextlib import nullcontext
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from shared.keyword_latest import KeywordLatestDoc, latest_tallies, read_keyword_latest
from shared.kpi_tally import RunTally
from testing.citation_rollup_fixtures import lambda_context
from testing.client_errors import throttled
from testing.deadlines import spent_deadline
from testing.env import cleared_env
from testing.keyword_run_kpis_fixtures import ROLLUP_ENV, ROLLUP_TABLE_NAME, rollup_table
from testing.provider_summary_fixtures import provider_row
from testing.scale_data import BRAND_CONFIG, ScaleSpec, keyword_text, run_timestamp, search_result_rows
from testing.scope_snapshot_fixtures import (
    SNAPSHOT_BUCKET,
    RecordingLambda,
    SnapshotBucket,
    deduplication_under_test,
    full_tally,
)
from testing.window_rows_fixtures import paged_search_results_table

_HANDLER_DIR = os.path.dirname(os.path.abspath(__file__))
_SPEC = ScaleSpec(keywords=1, personas=10, long_tail=5_000)
_KEYWORD = keyword_text(0)
_ROWS = {_KEYWORD: [row for run in range(2) for row in search_result_rows(_SPEC, 0, run)]}
_BRANDS_TABLE = 'test-keyword-run-brands'
_ENV = {
    'DYNAMODB_TABLE_CITATIONS': 'test-citations',
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-search-results',
    'DYNAMODB_TABLE_KEYWORDS': 'test-keywords',
    'DYNAMODB_TABLE_KEYWORD_RUN_BRANDS': _BRANDS_TABLE,
    'SCOPE_SNAPSHOT_BUCKET': SNAPSHOT_BUCKET,
    **ROLLUP_ENV,
}


def _event(run: int = 1) -> dict[str, Any]:
    return {'keyword': _KEYWORD, 'timestamp': run_timestamp(run), 'results': [provider_row('openai', ['https://a.example'])]}


@pytest.fixture
def tables() -> dict[str, dict[str, list[dict[str, Any]]]]:
    return {'kpis': {}, 'brands': {}}


@pytest.fixture
def bucket() -> SnapshotBucket:
    return SnapshotBucket()


@pytest.fixture
def dedup(tables, bucket):
    module, resource = deduplication_under_test(_HANDLER_DIR, _ENV, {
        'test-search-results': paged_search_results_table(_ROWS),
        ROLLUP_TABLE_NAME: rollup_table(tables['kpis']),
        _BRANDS_TABLE: rollup_table(tables['brands']),
    })
    with (
        patch.dict(os.environ, _ENV),
        cleared_env('DYNAMODB_TABLE_CRAWLED_CONTENT'),
        patch.object(module.run_kpis_action, 'dynamodb', resource),
        patch.object(module.run_kpis_action, 's3', bucket),
        patch.object(module, 'citations_table', MagicMock()),
        patch.object(module.run_kpis_action, 'get_brand_config', return_value=BRAND_CONFIG),
        patch.object(module.run_kpis_action.personas, 'ids', return_value=('persona-00',)),
    ):
        yield module


def _expected_full(run: int) -> RunTally:
    return full_tally(_SPEC, 0, run)


def _object_after_runs(dedup: Any, bucket: SnapshotBucket, *runs: int) -> KeywordLatestDoc:
    """The keyword's KeywordLatest object once the Deduplication step finished ``runs`` in order."""
    for run in runs:
        dedup.handler(_event(run), None)
    doc, _ = read_keyword_latest(bucket, SNAPSHOT_BUCKET, _KEYWORD)
    assert doc is not None
    return doc


class TestKeywordLatestWrite:
    def test_writes_the_runs_full_tally_into_the_keywords_object(self, dedup, bucket):
        assert latest_tallies(_object_after_runs(dedup, bucket, 1)) == [_expected_full(1)]

    def test_two_runs_fill_the_latest_and_previous(self, dedup, bucket):
        doc = _object_after_runs(dedup, bucket, 0, 1)
        assert [run['timestamp'] for run in (doc['latest'], doc['previous']) if run] == [run_timestamp(1), run_timestamp(0)]

    def test_every_registered_partial_is_built_from_the_runs_rows(self, dedup, bucket):
        doc = _object_after_runs(dedup, bucket, 1)
        assert [sorted(run['parts']) for run in (doc['latest'],) if run] == [['actions', 'insights', 'kpi', 'mentions']]

    def test_no_counts_block_is_written_without_the_citation_and_crawl_tables(self, dedup, bucket):
        assert 'counts' not in _object_after_runs(dedup, bucket, 1)

    def test_a_failed_object_write_still_answers_the_keyword(self, dedup, bucket):
        with patch.object(bucket, 'put_object', side_effect=throttled('PutObject')):
            assert dedup.handler(_event(1), None)['keyword'] == _KEYWORD

    def test_nothing_is_written_without_a_bucket(self, dedup, bucket, monkeypatch):
        monkeypatch.delenv('SCOPE_SNAPSHOT_BUCKET')
        dedup.handler(_event(1), None)
        assert bucket.puts == []


class TestBrandRowWrite:
    def test_a_capped_run_gets_its_complete_brand_row(self, dedup, tables):
        dedup.handler(_event(1), None)
        assert [item['brands_total'] for item in tables['brands'][_KEYWORD]] == [_expected_full(1).brands_total]

    def test_the_kpi_row_stays_capped(self, dedup, tables):
        dedup.handler(_event(1), None)
        assert [item['brands_total'] for item in tables['kpis'][_KEYWORD]] == [_expected_full(1).brands_total]

    def test_a_failed_brand_write_still_writes_the_keywords_object(self, dedup, bucket):
        dedup.run_kpis_action.dynamodb.Table(_BRANDS_TABLE).put_item.side_effect = throttled('PutItem')
        dedup.handler(_event(1), None)
        assert read_keyword_latest(bucket, SNAPSHOT_BUCKET, _KEYWORD)[0] is not None


class TestLatestBackfillAction:
    def test_rebuilds_the_objects_of_the_keywords_asked_for(self, dedup, bucket):
        response = dedup.handler({'action': 'backfill_keyword_run_kpis', 'latest': True, 'keywords': [_KEYWORD]}, lambda_context(60_000))
        assert (response['mode'], response['keywords_done'], read_keyword_latest(bucket, SNAPSHOT_BUCKET, _KEYWORD)[0] is not None) == ('latest', 1, True)

    def test_a_chained_pass_that_finishes_starts_a_snapshot_build(self, dedup):
        invoked = RecordingLambda()
        with patch.object(dedup.run_kpis_action, 'lambda_client', invoked), patch.dict(os.environ, {'SCOPE_SNAPSHOT_FUNCTION_NAME': 'summary-fn'}):
            dedup.handler({'action': 'backfill_keyword_run_kpis', 'latest': True, 'chain': True, 'keywords': [_KEYWORD]}, lambda_context(60_000))
        assert invoked.invocations == [{'action': 'build_scope_snapshots', 'reason': 'keyword_latest_backfill'}]

    def test_a_chained_pass_cut_by_the_deadline_invokes_itself_with_the_cursor(self, dedup):
        invoked = RecordingLambda()
        context = lambda_context(60_000)
        context.invoked_function_arn = 'arn:aws:lambda:eu-west-1:123456789012:function:dedup'
        event = {'action': 'backfill_keyword_run_kpis', 'latest': True, 'chain': True, 'keywords': [_KEYWORD]}
        with (
            patch.object(dedup.run_kpis_action, 'lambda_client', invoked),
            patch.object(dedup.run_kpis_action, 'request_deadline_scope', return_value=nullcontext(spent_deadline())),
        ):
            dedup.handler(event, context)
        assert invoked.invocations == [{**event, 'cursor': {'scan_key': None, 'keyword': _KEYWORD, 'after': None}}]

    def test_refuses_the_latest_mode_without_a_bucket(self, dedup, monkeypatch):
        monkeypatch.delenv('SCOPE_SNAPSHOT_BUCKET')
        with pytest.raises(dedup.run_kpis_action.KeywordLatestNotDeployedError, match='SCOPE_SNAPSHOT_BUCKET'):
            dedup.handler({'action': 'backfill_keyword_run_kpis', 'latest': True, 'keywords': [_KEYWORD]}, lambda_context(60_000))
