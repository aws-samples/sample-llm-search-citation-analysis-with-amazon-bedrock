"""
Tests for trigger-keyword-analysis.py (scope-aware subset runs) and the
cap-free active-keyword read in trigger-analysis.py.
"""

import json
import os
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from testing.dynamodb_stubs import fake_dynamodb_resource
from testing.events import api_gateway_event, parse_response
from testing.module_loader import load_handler_module

mock_keywords_table = MagicMock()
mock_prompts_table = MagicMock()
mock_stepfunctions = MagicMock()
mock_dynamodb = fake_dynamodb_resource(mock_keywords_table, by_name={'test-prompts': mock_prompts_table})

_ENV = {
    'STATE_MACHINE_ARN': 'arn:aws:states:us-east-1:123456789012:stateMachine:test',
    'DYNAMODB_TABLE_KEYWORDS': 'test-keywords',
    'DYNAMODB_TABLE_QUERY_PROMPTS': 'test-prompts',
    'QUERY_PROMPTS_TABLE': 'test-prompts',
    'CORS_ORIGIN_PARAM': '',
}


def _load(filename, module_name):
    with patch('boto3.resource', return_value=mock_dynamodb), patch('boto3.client', return_value=mock_stepfunctions), \
            patch.dict(os.environ, _ENV):
        return load_handler_module(os.path.dirname(__file__), filename, module_name)


_subset = _load('trigger-keyword-analysis.py', 'trigger_keyword_analysis_under_test')
_all = _load('trigger-analysis.py', 'trigger_analysis_under_test')


def make_event(body=None, groups: str | None = 'Admin'):
    claims = {'cognito:username': 'admin@example.com'}
    if groups is not None:
        claims['cognito:groups'] = groups
    return api_gateway_event('POST', '/api/trigger-keyword-analysis', body=body, claims=claims)


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

        status, body = parse_response(_subset.handler(make_event({'scope': {'mode': 'groups', 'group_ids': ['coruna']}}), None))

        assert status == 200
        assert body['keywords'] == ['hotel coruna spa']
        assert body['keywords_count'] == 1
        assert body['scope'] == {'mode': 'groups', 'group_ids': ['coruna']}
        started = _started_input()
        assert [kw['keyword'] for kw in started['keywords']] == ['hotel coruna spa']
        assert started['requested_scope'] == {'mode': 'groups', 'group_ids': ['coruna']}

    def test_runs_only_the_requested_keyword_ids(self):
        _stage_active_keywords(_keyword_row('k1', 'alpha'), _keyword_row('k2', 'beta'))

        status, body = parse_response(_subset.handler(make_event({'scope': {'mode': 'keywords', 'keyword_ids': ['k2']}}), None))

        assert status == 200
        assert body['keywords'] == ['beta']

    def test_rejects_a_scope_that_matches_no_active_keyword_without_starting_a_run(self):
        _stage_active_keywords(_keyword_row('k1', 'alpha', 'other'))

        status, body = parse_response(_subset.handler(make_event({'scope': {'mode': 'groups', 'group_ids': ['coruna']}}), None))

        assert status == 400
        assert body['error'] == 'No active keywords match the selected scope (1 group(s)).'
        mock_stepfunctions.start_execution.assert_not_called()

    def test_rejects_an_invalid_scope(self):
        status, body = parse_response(_subset.handler(make_event({'scope': {'mode': 'nope'}}), None))

        assert status == 400
        assert body['error'] == 'scope.mode must be one of all, groups, keywords'


class TestSubsetTriggerLegacyKeywords:
    def test_accepts_more_than_100_explicit_keywords(self):
        keywords = [f'keyword {index:03d}' for index in range(150)]

        status, body = parse_response(_subset.handler(make_event({'keywords': keywords}), None))

        assert status == 200
        assert body['keywords_count'] == 150
        assert len(_started_input()['keywords']) == 150

    def test_stamps_every_keyword_of_a_run_with_the_same_timestamp(self):
        _subset.handler(make_event({'keywords': ['a', 'b', 'c']}), None)

        timestamps = {kw['timestamp'] for kw in _started_input()['keywords']}
        assert len(timestamps) == 1

    def test_rejects_a_body_with_neither_keywords_nor_scope(self):
        status, body = parse_response(_subset.handler(make_event({}), None))

        assert status == 400
        assert body['error'] == 'Provide a "keywords" array or a "scope" object in the request body.'

    def test_rejects_when_every_keyword_is_empty(self):
        status, body = parse_response(_subset.handler(make_event({'keywords': ['', None]}), None))

        assert status == 400
        assert body['error'] == 'No valid keywords provided.'

    def test_refuses_non_admin_callers_before_reading_the_body(self):
        status, _ = parse_response(_subset.handler(make_event({'keywords': ['a']}, groups=None), None))

        assert status == 403
        mock_stepfunctions.start_execution.assert_not_called()


class TestFullTriggerReadsEveryPage:
    def test_includes_active_keywords_from_every_status_index_page(self):
        first = {'Items': [{'id': f'k{i}', 'keyword': f'kw {i:03d}'} for i in range(100)], 'LastEvaluatedKey': {'id': 'k99'}}
        second = {'Items': [{'id': f'k{i}', 'keyword': f'kw {i:03d}'} for i in range(100, 130)]}
        mock_keywords_table.query.side_effect = [first, second]

        status, body = parse_response(_all.handler(make_event(), None))

        assert status == 200
        assert body['keywords_count'] == 130
        assert len(_started_input()['keywords']) == 130

    def test_rejects_when_no_keyword_is_active(self):
        status, body = parse_response(_all.handler(make_event(), None))

        assert status == 400
        assert body['error'] == 'No active keywords found. Please add keywords first.'
