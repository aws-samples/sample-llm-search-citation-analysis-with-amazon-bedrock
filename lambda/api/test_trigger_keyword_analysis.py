"""
Tests for trigger-keyword-analysis.py (scope-aware subset runs) and the
cap-free active-keyword read in trigger-analysis.py.
"""

import importlib.util
import json
import os
import sys
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))  # lambda/

mock_keywords_table = MagicMock()
mock_prompts_table = MagicMock()
mock_stepfunctions = MagicMock()


def _table_for(name):
    return mock_prompts_table if name == 'test-prompts' else mock_keywords_table


mock_dynamodb = MagicMock()
mock_dynamodb.Table.side_effect = _table_for

_ENV = {
    'STATE_MACHINE_ARN': 'arn:aws:states:us-east-1:123456789012:stateMachine:test',
    'DYNAMODB_TABLE_KEYWORDS': 'test-keywords',
    'DYNAMODB_TABLE_QUERY_PROMPTS': 'test-prompts',
    'QUERY_PROMPTS_TABLE': 'test-prompts',
    'CORS_ORIGIN_PARAM': '',
}


def _load(filename, module_name):
    spec = importlib.util.spec_from_file_location(module_name, os.path.join(os.path.dirname(__file__), filename))
    module = importlib.util.module_from_spec(spec)
    with patch('boto3.resource', return_value=mock_dynamodb), patch('boto3.client', return_value=mock_stepfunctions), \
            patch.dict(os.environ, _ENV):
        spec.loader.exec_module(module)
    return module


_subset = _load('trigger-keyword-analysis.py', 'trigger_keyword_analysis_under_test')
_all = _load('trigger-analysis.py', 'trigger_analysis_under_test')


def make_event(body=None, groups='Admin'):
    claims = {'cognito:username': 'admin@example.com'}
    if groups is not None:
        claims['cognito:groups'] = groups
    return {
        'httpMethod': 'POST',
        'path': '/api/trigger-keyword-analysis',
        'headers': {'origin': 'http://localhost:3000'},
        'body': json.dumps(body) if body is not None else None,
        'requestContext': {'authorizer': {'claims': claims}},
    }


def parse_response(result):
    return result['statusCode'], json.loads(result['body'])


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
        mock_keywords_table.query.return_value = {'Items': [
            {'id': 'k1', 'keyword': 'hotel coruna spa', 'group_ids': {'coruna'}},
            {'id': 'k2', 'keyword': 'hotel marino beach', 'group_ids': {'marino'}},
        ]}

        status, body = parse_response(_subset.handler(make_event({'scope': {'mode': 'groups', 'group_ids': ['coruna']}}), None))

        assert status == 200
        assert body['keywords'] == ['hotel coruna spa']
        assert body['keywords_count'] == 1
        assert body['scope'] == {'mode': 'groups', 'group_ids': ['coruna']}
        started = _started_input()
        assert [kw['keyword'] for kw in started['keywords']] == ['hotel coruna spa']
        assert started['requested_scope'] == {'mode': 'groups', 'group_ids': ['coruna']}

    def test_runs_only_the_requested_keyword_ids(self):
        mock_keywords_table.query.return_value = {'Items': [
            {'id': 'k1', 'keyword': 'alpha'},
            {'id': 'k2', 'keyword': 'beta'},
        ]}

        status, body = parse_response(_subset.handler(make_event({'scope': {'mode': 'keywords', 'keyword_ids': ['k2']}}), None))

        assert status == 200
        assert body['keywords'] == ['beta']

    def test_rejects_a_scope_that_matches_no_active_keyword_without_starting_a_run(self):
        mock_keywords_table.query.return_value = {'Items': [{'id': 'k1', 'keyword': 'alpha', 'group_ids': {'other'}}]}

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
