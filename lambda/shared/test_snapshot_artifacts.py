"""Tests for shared.snapshot_artifacts: the scoped-response contract and the snapshot / keyword cursors."""

from __future__ import annotations

import json

import pytest
from hypothesis import given
from hypothesis import strategies as st

from shared.cursors import CURSOR_ERROR_MESSAGE, encode_cursor
from shared.snapshot_artifacts import (
    DEFAULT_RETRY_AFTER_MS,
    KeywordCursor,
    SnapshotCursor,
    artifacts_envelope,
    computing_body,
    computing_response,
    coverage,
    cursor_expired_body,
    cursor_expired_response,
    decode_keyword_cursor,
    decode_snapshot_cursor,
    encode_keyword_cursor,
    encode_snapshot_cursor,
    failed_job_body,
    keyword_page_start,
    live_envelope,
    snapshot_envelope,
    snapshot_page_start,
    with_scope_contract,
)
from testing.snapshot_fakes import FakeSnapshotArtifacts

counts = st.integers(min_value=0, max_value=10**9)
labels = st.text(min_size=1, max_size=40)


# --- coverage ----------------------------------------------------------------

def test_coverage_is_complete_when_every_keyword_is_analyzed() -> None:
    assert coverage(5000, 5000) == {'keywords_total': 5000, 'keywords_analyzed': 5000, 'complete': True}


def test_coverage_is_incomplete_when_a_keyword_is_missing() -> None:
    assert coverage(928, 100) == {'keywords_total': 928, 'keywords_analyzed': 100, 'complete': False}


def test_coverage_of_an_empty_scope_is_complete() -> None:
    assert coverage(0, 0)['complete'] is True


@pytest.mark.parametrize(('total', 'analyzed'), [(-1, 0), (10, -1), (10, 11)])
def test_coverage_rejects_inconsistent_counts(total: int, analyzed: int) -> None:
    with pytest.raises(ValueError, match='coverage of'):
        coverage(total, analyzed)


# --- source envelope ---------------------------------------------------------

def test_live_envelope_has_no_as_of_and_is_never_stale() -> None:
    assert live_envelope() == {'source': 'live', 'as_of': None, 'stale': False, 'refreshing': False}


def test_snapshot_envelope_carries_the_build_time() -> None:
    assert snapshot_envelope('2026-10-05T07:12:00Z') == {
        'source': 'snapshot', 'as_of': '2026-10-05T07:12:00Z', 'stale': False, 'refreshing': False,
    }


def test_stale_snapshot_envelope_reports_the_rebuild() -> None:
    envelope = snapshot_envelope('2026-10-05T07:12:00Z', stale=True, refreshing=True)

    assert (envelope['stale'], envelope['refreshing']) == (True, True)


def test_snapshot_envelope_refuses_refreshing_a_fresh_build() -> None:
    with pytest.raises(ValueError, match='only a stale snapshot'):
        snapshot_envelope('2026-10-05T07:12:00Z', refreshing=True)


def test_artifacts_envelope_reads_the_stored_build() -> None:
    artifacts = FakeSnapshotArtifacts({}, keywords_total=3, built_at='2026-10-04T07:00:00Z', stale=True, refreshing=True)

    assert artifacts_envelope(artifacts) == {'source': 'snapshot', 'as_of': '2026-10-04T07:00:00Z', 'stale': True, 'refreshing': True}


def test_with_scope_contract_adds_coverage_and_envelope_over_the_body() -> None:
    body = with_scope_contract({'kpis': {'mentions': 3}, 'source': 'old'}, coverage(2, 2), live_envelope())

    assert body == {
        'kpis': {'mentions': 3},
        'coverage': {'keywords_total': 2, 'keywords_analyzed': 2, 'complete': True},
        'source': 'live', 'as_of': None, 'stale': False, 'refreshing': False,
    }


# --- 202 computing -----------------------------------------------------------

def test_computing_body_names_the_job_and_the_poll_interval() -> None:
    assert computing_body('job-1', '2026-10-05T07:13:00Z') == {
        'status': 'computing', 'job': {'id': 'job-1', 'started_at': '2026-10-05T07:13:00Z'}, 'retry_after_ms': DEFAULT_RETRY_AFTER_MS,
    }


@pytest.mark.parametrize(('job_id', 'retry'), [('', 2000), ('job-1', 0)])
def test_computing_body_rejects_a_missing_job_or_interval(job_id: str, retry: int) -> None:
    with pytest.raises(ValueError, match='computing body needs'):
        computing_body(job_id, '2026-10-05T07:13:00Z', retry)


def test_computing_response_answers_202_with_the_body() -> None:
    response = computing_response('job-1', '2026-10-05T07:13:00Z', retry_after_ms=5000)

    assert (response['statusCode'], json.loads(response['body'])['retry_after_ms']) == (202, 5000)


def test_failed_job_body_carries_the_message() -> None:
    assert failed_job_body('view job timed out') == {'status': 'failed', 'message': 'view job timed out'}


# --- snapshot cursor {o, b} --------------------------------------------------

@given(offset=counts, build=labels)
def test_snapshot_cursor_round_trips(offset: int, build: str) -> None:
    token = encode_snapshot_cursor(offset, offset + 1, build)

    assert token is not None
    assert decode_snapshot_cursor(token) == SnapshotCursor(offset=offset, build_id=build)


def test_snapshot_cursor_is_none_past_the_end() -> None:
    assert encode_snapshot_cursor(100, 100, 'build-1') is None


@pytest.mark.parametrize('payload', [
    {'o': -1, 'b': 'build-1'},
    {'o': True, 'b': 'build-1'},
    {'o': 1.5, 'b': 'build-1'},
    {'o': 1, 'b': ''},
    {'o': 1, 'b': 7},
    {'o': 1},
    {'offset': 1, 'b': 'build-1'},
])
def test_snapshot_cursor_rejects_malformed_payloads(payload: dict[str, object]) -> None:
    assert decode_snapshot_cursor(str(encode_cursor(payload))) is None


# --- keyword cursor {k, r, f} ------------------------------------------------

@given(keyword_index=counts, row_offset=counts, fingerprint=labels)
def test_keyword_cursor_round_trips(keyword_index: int, row_offset: int, fingerprint: str) -> None:
    cursor = KeywordCursor(keyword_index, row_offset, fingerprint)
    token = encode_keyword_cursor(cursor, keyword_index + 1)

    assert token is not None
    assert decode_keyword_cursor(token) == cursor


def test_keyword_cursor_is_none_once_every_keyword_is_read() -> None:
    assert encode_keyword_cursor(KeywordCursor(5, 0, 'fp'), 5) is None


@pytest.mark.parametrize('payload', [
    {'k': -1, 'r': 0, 'f': 'fp'},
    {'k': 0, 'r': False, 'f': 'fp'},
    {'k': 0, 'r': 0, 'f': ''},
    {'k': 0, 'r': 0},
    {'o': 0, 'b': 'build-1'},
])
def test_keyword_cursor_rejects_malformed_payloads(payload: dict[str, object]) -> None:
    assert decode_keyword_cursor(str(encode_cursor(payload))) is None


# --- cursor_expired ----------------------------------------------------------

def test_cursor_expired_body_has_the_code_the_web_restarts_on() -> None:
    assert cursor_expired_body() == {
        'error': 'The list changed since this page was read; start again from the first page',
        'code': 'cursor_expired',
        'field': 'next_token',
    }


def test_cursor_expired_response_answers_400() -> None:
    response = cursor_expired_response()

    assert (response['statusCode'], json.loads(response['body'])) == (400, cursor_expired_body())


# --- page starts -------------------------------------------------------------

def test_snapshot_page_starts_at_zero_of_the_current_build_without_a_token() -> None:
    assert snapshot_page_start(None, 'build-2', ()) == (SnapshotCursor(0, 'build-2'), None)


def test_snapshot_page_continues_a_kept_build() -> None:
    token = encode_snapshot_cursor(100, 500, 'build-1')

    assert snapshot_page_start(token, 'build-2', {'build-1'}) == (SnapshotCursor(100, 'build-1'), None)


def test_snapshot_page_of_a_collected_build_is_cursor_expired() -> None:
    cursor, rejected = snapshot_page_start(encode_snapshot_cursor(100, 500, 'build-0'), 'build-2', {'build-1'})

    assert cursor is None
    assert rejected is not None
    assert (rejected['statusCode'], json.loads(rejected['body'])['code']) == (400, 'cursor_expired')


def test_snapshot_page_of_a_malformed_token_is_the_usual_invalid_token() -> None:
    _cursor, rejected = snapshot_page_start('not-a-token', 'build-2', ())

    assert rejected is not None
    assert json.loads(rejected['body']) == {'error': CURSOR_ERROR_MESSAGE, 'field': 'next_token'}


def test_keyword_page_starts_at_the_first_keyword_without_a_token() -> None:
    assert keyword_page_start(None, 'fp-1') == (KeywordCursor(0, 0, 'fp-1'), None)


def test_keyword_page_continues_the_same_keyword_set() -> None:
    cursor = KeywordCursor(3, 40, 'fp-1')

    assert keyword_page_start(encode_keyword_cursor(cursor, 10), 'fp-1') == (cursor, None)


def test_keyword_page_of_a_changed_keyword_set_is_cursor_expired() -> None:
    _cursor, rejected = keyword_page_start(encode_keyword_cursor(KeywordCursor(3, 40, 'fp-1'), 10), 'fp-2')

    assert rejected is not None
    assert json.loads(rejected['body']) == cursor_expired_body()


def test_keyword_page_of_a_snapshot_token_is_the_usual_invalid_token() -> None:
    _cursor, rejected = keyword_page_start(encode_snapshot_cursor(0, 1, 'build-1'), 'fp-1')

    assert rejected is not None
    assert json.loads(rejected['body'])['error'] == CURSOR_ERROR_MESSAGE
