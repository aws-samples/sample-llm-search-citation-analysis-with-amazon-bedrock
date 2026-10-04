"""
Tests for trigger-keyword-analysis.py (scope-aware subset runs) and the
cap-free active-keyword read in trigger-analysis.py.

Scope runs start with the scope as their execution input, never the keyword
texts; only a legacy explicit list travels inline, and it is refused when it
would not fit the execution input.
"""

import json
import os
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from testing.admin_authz_fixtures import caller_event, invoke
from testing.dynamodb_stubs import fake_dynamodb_resource
from testing.module_loader import load_handler_module

mock_keywords_table = MagicMock()
mock_prompts_table = MagicMock()
mock_stepfunctions = MagicMock()
mock_dynamodb = fake_dynamodb_resource(mock_keywords_table, by_name={'test-prompts': mock_prompts_table})

_ENV = {
    'STATE_MACHINE_ARN': 'arn:aws:states:us-east-1:123456789012:stateMachine:test',
    'DYNAMODB_TABLE_KEYWORDS': 'test-keywords',
    'DYNAMODB_TABLE_QUERY_PROMPTS': 'test-prompts',
    'CORS_ORIGIN_PARAM': '',
}


def _load(filename, module_name):
    with patch('boto3.resource', return_value=mock_dynamodb), patch('boto3.client', return_value=mock_stepfunctions), \
            patch.dict(os.environ, _ENV):
        return load_handler_module(os.path.dirname(__file__), filename, module_name)


_subset = _load('trigger-keyword-analysis.py', 'trigger_keyword_analysis_under_test')
_all = _load('trigger-analysis.py', 'trigger_analysis_under_test')


def make_event(body=None, groups: str | None = 'Admin'):
    return caller_event('POST', '/api/trigger-keyword-analysis', body=body, groups=groups)


def _trigger(body, groups: str | None = 'Admin'):
    """``(status, body)`` of a subset run requested with ``body``."""
    return invoke(_subset, make_event(body, groups))


CORUNA_SCOPE = {'mode': 'groups', 'group_ids': ['coruna']}


def _keyword_row(keyword_id: str, keyword: str, *group_ids: str) -> dict[str, Any]:
    """An active Keywords-table item; `group_ids` become its DynamoDB string set."""
    row: dict[str, Any] = {'id': keyword_id, 'keyword': keyword}
    if group_ids:
        row['group_ids'] = set(group_ids)
    return row


def _stage_active_keywords(*rows: dict[str, Any]) -> None:
    """What the StatusIndex query answers for the next request."""
    mock_keywords_table.query.return_value = {'Items': list(rows)}


def _started_input():
    return json.loads(mock_stepfunctions.start_execution.call_args.kwargs['input'])


@pytest.fixture(autouse=True)
def _reset_mocks():
    mock_keywords_table.reset_mock(side_effect=True, return_value=True)
    mock_prompts_table.reset_mock(side_effect=True, return_value=True)
    mock_stepfunctions.reset_mock(side_effect=True, return_value=True)
    mock_prompts_table.query.return_value = {'Items': []}
    mock_keywords_table.query.return_value = {'Items': []}
    mock_stepfunctions.start_execution.return_value = {
        'executionArn': 'arn:aws:states:us-east-1:123456789012:execution:test:run',
        'startDate': MagicMock(isoformat=lambda: '2026-09-18T00:00:00+00:00'),
    }


class TestSubsetTriggerWithScope:
    def test_runs_the_active_keywords_of_the_requested_groups(self):
        _stage_active_keywords(
            _keyword_row('k1', 'hotel coruna spa', 'coruna'),
            _keyword_row('k2', 'hotel marino beach', 'marino'),
        )

        status, body = _trigger({'scope': CORUNA_SCOPE})

        assert status == 200
        assert body['keywords'] == ['hotel coruna spa']
        assert body['keywords_count'] == 1
        assert body['scope'] == CORUNA_SCOPE

    def test_starts_the_run_with_the_scope_instead_of_the_keyword_texts(self):
        _stage_active_keywords(_keyword_row('k1', 'hotel coruna spa', 'coruna'))

        _subset.handler(make_event({'scope': CORUNA_SCOPE}), None)

        assert _started_input() == {'scope': CORUNA_SCOPE, 'query_prompts': []}

    def test_runs_only_the_requested_keyword_ids(self):
        _stage_active_keywords(_keyword_row('k1', 'alpha'), _keyword_row('k2', 'beta'))

        status, body = _trigger({'scope': {'mode': 'keywords', 'keyword_ids': ['k2']}})

        assert status == 200
        assert body['keywords'] == ['beta']

    def test_rejects_a_scope_that_matches_no_active_keyword_without_starting_a_run(self):
        _stage_active_keywords(_keyword_row('k1', 'alpha', 'other'))

        status, body = _trigger({'scope': CORUNA_SCOPE})

        assert status == 400
        assert body['error'] == 'No active keywords match the selected scope (1 group(s)).'
        mock_stepfunctions.start_execution.assert_not_called()

    def test_rejects_an_invalid_scope(self):
        status, body = _trigger({'scope': {'mode': 'nope'}})

        assert status == 400
        assert body['error'] == 'scope.mode must be one of all, groups, keywords'


class TestSubsetTriggerLegacyKeywords:
    def test_accepts_more_than_100_explicit_keywords(self):
        keywords = [f'keyword {index:03d}' for index in range(150)]

        status, body = _trigger({'keywords': keywords})

        assert status == 200
        assert body['keywords_count'] == 150
        assert len(_started_input()['keywords']) == 150

    def test_stamps_every_keyword_of_a_run_with_the_same_timestamp(self):
        _subset.handler(make_event({'keywords': ['a', 'b', 'c']}), None)

        timestamps = {kw['timestamp'] for kw in _started_input()['keywords']}
        assert len(timestamps) == 1

    def test_refuses_an_explicit_list_too_large_for_the_execution_input(self):
        keywords = [f'{index:03d} ' + 'k' * 490 for index in range(400)]

        status, body = _trigger({'keywords': keywords})

        assert status == 400
        assert 'Run a keyword group or all keywords with a "scope" instead.' in body['error']
        mock_stepfunctions.start_execution.assert_not_called()

    @pytest.mark.parametrize(('request_body', 'error'), [
        pytest.param({}, 'Provide a "keywords" array or a "scope" object in the request body.', id='neither-keywords-nor-scope'),
        pytest.param({'keywords': ['', None]}, 'No valid keywords provided.', id='every-keyword-empty'),
    ])
    def test_rejects_a_body_without_a_usable_keyword_list(self, request_body, error):
        status, body = _trigger(request_body)

        assert (status, body['error']) == (400, error)

    def test_refuses_non_admin_callers_before_reading_the_body(self):
        status, _ = _trigger({'keywords': ['a']}, groups=None)

        assert status == 403
        mock_stepfunctions.start_execution.assert_not_called()


class TestFullTriggerReadsEveryPage:
    def test_includes_active_keywords_from_every_status_index_page(self):
        first = {'Items': [{'id': f'k{i}', 'keyword': f'kw {i:03d}'} for i in range(100)], 'LastEvaluatedKey': {'id': 'k99'}}
        second = {'Items': [{'id': f'k{i}', 'keyword': f'kw {i:03d}'} for i in range(100, 130)]}
        mock_keywords_table.query.side_effect = [first, second]

        status, body = invoke(_all, make_event())

        assert status == 200
        assert body['keywords_count'] == 130

    def test_starts_the_run_with_the_all_keywords_scope(self):
        _stage_active_keywords(_keyword_row('k1', 'alpha'), _keyword_row('k2', 'beta'))

        _all.handler(make_event(), None)

        assert _started_input() == {'scope': {'mode': 'all'}, 'query_prompts': []}

    def test_scans_for_status_active_when_the_status_index_is_unavailable(self):
        mock_keywords_table.query.side_effect = ClientError(
            {'Error': {'Code': 'ValidationException', 'Message': 'no StatusIndex'}}, 'Query',
        )
        mock_keywords_table.scan.return_value = {'Items': [_keyword_row('k1', 'alpha')]}

        _all.handler(make_event(), None)

        assert mock_keywords_table.scan.call_args.kwargs == {
            'FilterExpression': '#status = :status',
            'ExpressionAttributeNames': {'#status': 'status'},
            'ExpressionAttributeValues': {':status': 'active'},
        }

    def test_rejects_when_no_keyword_is_active(self):
        status, body = invoke(_all, make_event())

        assert status == 400
        assert body['error'] == 'No active keywords found. Please add keywords first.'
