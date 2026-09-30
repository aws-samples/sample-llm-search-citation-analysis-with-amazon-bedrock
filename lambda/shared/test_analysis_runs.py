"""
Tests for shared.analysis_runs — how the trigger endpoints start an analysis run.

- the enabled personas are read from EnabledIndex and shaped for the state machine
- a DynamoDB failure reading them is logged and the run proceeds without prompts
- a scope run input names the scope, never the keyword texts
- an explicit keyword list is stamped with one run timestamp
- one execution is started with the run input as given, and refused when it is too large
- the response fields every trigger endpoint reports come back from the start call
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError, EndpointConnectionError

from shared.analysis_runs import (
    MAX_QUERY_PROMPTS_PER_RUN,
    MAX_RUN_INPUT_BYTES,
    RunInputTooLargeError,
    fetch_enabled_query_prompts,
    keyword_list_run_input,
    scope_run_input,
    start_analysis_run,
)
from testing.dynamodb_stubs import fake_table

_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:analysis'
_PROMPTS = [{'id': 'p1', 'name': 'Traveller', 'template': 'best {keyword}'}]


def _stepfunctions() -> MagicMock:
    client = MagicMock()
    client.start_execution.return_value = {
        'executionArn': f'{_STATE_MACHINE_ARN}:run-1',
        'startDate': datetime(2026, 9, 18, 10, 0, tzinfo=UTC),
    }
    return client


def _execution_input(client: MagicMock) -> dict:
    return json.loads(client.start_execution.call_args.kwargs['input'])


class TestFetchEnabledQueryPrompts:
    def test_shapes_each_enabled_prompt_as_id_name_and_template(self):
        table = fake_table(query={'Items': [
            {'id': 'p1', 'name': 'Traveller', 'template': 'best {keyword}', 'enabled': 'true'},
            {'id': 'p2'},
        ]})

        assert fetch_enabled_query_prompts(table) == [
            {'id': 'p1', 'name': 'Traveller', 'template': 'best {keyword}'},
            {'id': 'p2', 'name': '', 'template': ''},
        ]

    def test_queries_the_enabled_index_capped_at_the_per_run_ceiling(self):
        table = fake_table(query={'Items': []})

        fetch_enabled_query_prompts(table)

        table.query.assert_called_once_with(
            IndexName='EnabledIndex', KeyConditionExpression=Key('enabled').eq('true'), Limit=MAX_QUERY_PROMPTS_PER_RUN
        )

    @pytest.mark.parametrize('error', [
        pytest.param(
            ClientError({'Error': {'Code': 'ResourceNotFoundException', 'Message': 'no index'}}, 'Query'),
            id='missing table or index',
        ),
        pytest.param(EndpointConnectionError(endpoint_url='https://dynamodb.local'), id='endpoint unreachable'),
    ])
    def test_proceeds_without_prompts_when_dynamodb_fails(self, error, caplog: pytest.LogCaptureFixture):
        table = MagicMock()
        table.query.side_effect = error

        with caplog.at_level(logging.WARNING, logger='shared.analysis_runs'):
            prompts = fetch_enabled_query_prompts(table)

        assert prompts == []
        assert 'Could not fetch query prompts, proceeding without them' in caplog.text


class TestRunInputs:
    def test_scope_input_carries_the_scope_and_prompts_only(self):
        scope = {'mode': 'groups', 'group_ids': ['coruna']}

        assert scope_run_input(scope, _PROMPTS) == {'scope': scope, 'query_prompts': _PROMPTS}

    def test_keyword_list_input_stamps_every_keyword_with_the_same_run_timestamp(self):
        keywords = keyword_list_run_input(['alpha', 'beta'], [])['keywords']

        assert [entry['keyword'] for entry in keywords] == ['alpha', 'beta']
        assert len({entry['timestamp'] for entry in keywords}) == 1


class TestStartAnalysisRun:
    def test_sends_the_run_input_unchanged(self):
        client = _stepfunctions()
        run_input = scope_run_input({'mode': 'all'}, _PROMPTS)

        start_analysis_run(client, _STATE_MACHINE_ARN, 'analysis', run_input, 3)

        assert _execution_input(client) == {'scope': {'mode': 'all'}, 'query_prompts': _PROMPTS}

    def test_starts_the_state_machine_under_a_prefixed_execution_name(self):
        client = _stepfunctions()

        started = start_analysis_run(client, _STATE_MACHINE_ARN, 'keyword-analysis', scope_run_input({'mode': 'all'}, []), 1)

        call = client.start_execution.call_args.kwargs
        assert call['stateMachineArn'] == _STATE_MACHINE_ARN
        assert call['name'].startswith('keyword-analysis-')
        assert call['name'] == started['execution_name']

    def test_refuses_an_input_over_the_budget_without_starting_a_run(self):
        client = _stepfunctions()
        run_input = keyword_list_run_input(['k' * 500] * 400, [])

        with pytest.raises(RunInputTooLargeError, match=f'the limit is {MAX_RUN_INPUT_BYTES}'):
            start_analysis_run(client, _STATE_MACHINE_ARN, 'keyword-analysis', run_input, 400)

        client.start_execution.assert_not_called()

    def test_describes_the_execution_for_the_api_response(self):
        client = _stepfunctions()

        started = start_analysis_run(client, _STATE_MACHINE_ARN, 'analysis', scope_run_input({'mode': 'all'}, _PROMPTS), 3)

        assert started == {
            'execution_arn': f'{_STATE_MACHINE_ARN}:run-1',
            'execution_name': started['execution_name'],
            'start_date': '2026-09-18T10:00:00+00:00',
            'keywords_count': 3,
            'query_prompts_count': 1,
        }
