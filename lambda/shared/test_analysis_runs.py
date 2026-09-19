"""
Tests for shared.analysis_runs — how the trigger endpoints start an analysis run.

- the enabled personas are read from EnabledIndex and shaped for the state machine
- a DynamoDB failure reading them is logged and the run proceeds without prompts
- one execution is started with every keyword stamped by the same run timestamp
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

from shared.analysis_runs import MAX_QUERY_PROMPTS_PER_RUN, fetch_enabled_query_prompts, start_analysis_run
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


class TestStartAnalysisRun:
    def test_stamps_every_keyword_with_the_same_run_timestamp(self):
        client = _stepfunctions()

        start_analysis_run(client, _STATE_MACHINE_ARN, 'analysis', ['alpha', 'beta'], [])

        keywords = _execution_input(client)['keywords']
        assert [entry['keyword'] for entry in keywords] == ['alpha', 'beta']
        assert len({entry['timestamp'] for entry in keywords}) == 1

    def test_starts_the_state_machine_under_a_prefixed_execution_name(self):
        client = _stepfunctions()

        started = start_analysis_run(client, _STATE_MACHINE_ARN, 'keyword-analysis', ['alpha'], [])

        call = client.start_execution.call_args.kwargs
        assert call['stateMachineArn'] == _STATE_MACHINE_ARN
        assert call['name'].startswith('keyword-analysis-')
        assert call['name'] == started['execution_name']

    def test_passes_the_prompts_and_extra_input_to_the_execution(self):
        client = _stepfunctions()
        scope = {'mode': 'groups', 'group_ids': ['coruna']}

        start_analysis_run(client, _STATE_MACHINE_ARN, 'keyword-analysis', ['alpha'], _PROMPTS, {'requested_scope': scope})

        execution_input = _execution_input(client)
        assert execution_input['query_prompts'] == _PROMPTS
        assert execution_input['requested_scope'] == scope

    def test_leaves_the_execution_input_to_keywords_and_prompts_without_extra_input(self):
        client = _stepfunctions()

        start_analysis_run(client, _STATE_MACHINE_ARN, 'analysis', ['alpha'], [])

        assert sorted(_execution_input(client)) == ['keywords', 'query_prompts']

    def test_describes_the_execution_for_the_api_response(self):
        client = _stepfunctions()

        started = start_analysis_run(client, _STATE_MACHINE_ARN, 'analysis', ['alpha', 'beta', 'gamma'], _PROMPTS)

        assert started == {
            'execution_arn': f'{_STATE_MACHINE_ARN}:run-1',
            'execution_name': started['execution_name'],
            'start_date': '2026-09-18T10:00:00+00:00',
            'keywords_count': 3,
            'query_prompts_count': 1,
        }
