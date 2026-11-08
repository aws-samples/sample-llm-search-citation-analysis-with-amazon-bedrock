"""Tests for shared.snapshot_triggers: a successful write starts a rebuild or the KeywordLatest backfill, and a trigger never fails the write."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from shared import snapshot_triggers
from shared.keyword_run_kpis_backfill import BACKFILL_ACTION
from shared.snapshot_triggers import (
    BACKFILL_FUNCTION_ENV,
    BACKFILL_KEYWORDS_MAX,
    rebuilds_keyword_latest,
    rebuilds_snapshot,
    start_keyword_latest_backfill,
)

_THROTTLED = ClientError({'Error': {'Code': 'TooManyRequestsException', 'Message': 'slow down'}}, 'Invoke')


def _event(method: str) -> dict[str, Any]:
    return {'httpMethod': method, 'path': '/api/keywords'}


def _answering(status: int) -> MagicMock:
    return MagicMock(return_value={'statusCode': status, 'body': '{}'})


@pytest.fixture
def rebuild() -> Any:
    with patch.object(snapshot_triggers, 'request_snapshot_rebuild', return_value=True) as requested:
        yield requested


class TestRebuildsSnapshot:
    @pytest.mark.parametrize('method', ['POST', 'PUT', 'PATCH', 'DELETE'])
    def test_a_successful_write_requests_one_rebuild(self, rebuild, method):
        rebuilds_snapshot('keywords changed')(_answering(200))(_event(method), None)

        rebuild.assert_called_once_with('keywords changed')

    def test_a_read_requests_no_rebuild(self, rebuild):
        rebuilds_snapshot('keywords changed')(_answering(200))(_event('GET'), None)

        assert rebuild.call_count == 0

    def test_a_refused_write_requests_no_rebuild(self, rebuild):
        rebuilds_snapshot('keywords changed')(_answering(400))(_event('POST'), None)

        assert rebuild.call_count == 0

    def test_the_writes_response_is_returned_unchanged(self, rebuild):
        response = rebuilds_snapshot('keywords changed')(_answering(201))(_event('POST'), None)

        assert response == {'statusCode': 201, 'body': '{}'}

    def test_a_rebuild_that_cannot_start_never_fails_the_write(self):
        with patch.object(snapshot_triggers, 'request_snapshot_rebuild', side_effect=_THROTTLED):
            response = rebuilds_snapshot('keywords changed')(_answering(200))(_event('PUT'), None)

        assert response['statusCode'] == 200


class TestKeywordLatestBackfill:
    def test_starts_the_chained_latest_backfill_on_the_deduplication_lambda(self, monkeypatch):
        monkeypatch.setenv(BACKFILL_FUNCTION_ENV, 'CitationAnalysis-Deduplication')
        client = MagicMock()

        start_keyword_latest_backfill('brand config saved', client)

        call = client.invoke.call_args.kwargs
        assert (call['FunctionName'], call['InvocationType'], json.loads(call['Payload'])) == (
            'CitationAnalysis-Deduplication', 'Event',
            {'action': BACKFILL_ACTION, 'latest': True, 'chain': True, 'reason': 'brand config saved'},
        )

    def test_does_nothing_where_the_function_is_not_configured(self, monkeypatch):
        monkeypatch.delenv(BACKFILL_FUNCTION_ENV, raising=False)
        client = MagicMock()

        assert (start_keyword_latest_backfill('brand config saved', client), client.invoke.call_count) == (False, 0)

    def test_names_the_keywords_to_backfill_when_given(self, monkeypatch):
        monkeypatch.setenv(BACKFILL_FUNCTION_ENV, 'CitationAnalysis-Deduplication')
        client = MagicMock()

        start_keyword_latest_backfill('keywords behind', client, keywords=['hotel a', 'hotel b'])

        assert json.loads(client.invoke.call_args.kwargs['Payload'])['keywords'] == ['hotel a', 'hotel b']

    def test_backfills_every_keyword_when_too_many_are_named(self, monkeypatch):
        monkeypatch.setenv(BACKFILL_FUNCTION_ENV, 'CitationAnalysis-Deduplication')
        client = MagicMock()

        start_keyword_latest_backfill('keywords behind', client, keywords=[f'hotel {index}' for index in range(BACKFILL_KEYWORDS_MAX + 1)])

        assert 'keywords' not in json.loads(client.invoke.call_args.kwargs['Payload'])

    def test_an_invoke_failure_is_reported_as_not_started(self, monkeypatch):
        monkeypatch.setenv(BACKFILL_FUNCTION_ENV, 'CitationAnalysis-Deduplication')
        client = MagicMock()
        client.invoke.side_effect = _THROTTLED

        assert start_keyword_latest_backfill('brand config saved', client) is False

    def test_a_successful_save_starts_the_backfill(self):
        with patch.object(snapshot_triggers, 'start_keyword_latest_backfill', return_value=True) as started:
            rebuilds_keyword_latest('brand config saved')(_answering(200))(_event('PUT'), None)

        started.assert_called_once_with('brand config saved')

    def test_a_backfill_that_cannot_start_never_fails_the_save(self, monkeypatch):
        monkeypatch.setenv(BACKFILL_FUNCTION_ENV, 'CitationAnalysis-Deduplication')
        with patch.object(snapshot_triggers, '_lambda_client', return_value=MagicMock(invoke=MagicMock(side_effect=_THROTTLED))):
            response = rebuilds_keyword_latest('brand config saved')(_answering(200))(_event('PUT'), None)

        assert response['statusCode'] == 200
