"""Tests for the DataForSEO callback gates (``shared.dataforseo_callbacks``)."""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError

from shared import dataforseo_callbacks as callbacks

GATE = 'g' * 43


def _client_error(code: str) -> ClientError:
    return ClientError({'Error': {'Code': code, 'Message': code}}, 'Operation')


def test_names_a_random_43_character_gate_id_each_time():
    first, second = callbacks.new_gate_id(), callbacks.new_gate_id()

    assert (callbacks.is_gate_id(first), first != second) == (True, True)


@pytest.mark.parametrize('value', ['short', 'g' * 44, 'g' * 42 + '/', None, 7])
def test_refuses_anything_but_a_gate_id(value):
    assert callbacks.is_gate_id(value) is False


@pytest.mark.parametrize(('value', 'valid'), [('11291016-1535-0066-0000-2d7e2f9dbc59', True), ('a&b', False), ('', False)])
def test_accepts_only_task_id_characters(value, valid):
    assert callbacks.is_task_id(value) is valid


def test_points_the_pingback_at_the_gate_with_dataforseos_task_id_placeholder(monkeypatch):
    monkeypatch.setenv('DATAFORSEO_CALLBACK_URL', 'https://abc.lambda-url.us-east-1.on.aws/')

    assert callbacks.pingback_url(GATE) == f'https://abc.lambda-url.us-east-1.on.aws/?gate={GATE}&id=$id'


def test_opens_a_gate_with_its_count_token_and_output_expiring_with_the_table_ttl():
    table = MagicMock()

    callbacks.open_gate(GATE, 3, 'token', {'next': 'collect'}, table)

    item = table.put_item.call_args.kwargs['Item']
    assert (item['cache_key'], item['remaining'], item['task_token'], json.loads(item['output']), 'ttl' in item) == (
        f'callback#{GATE}', 3, 'token', {'next': 'collect'}, True)


def test_counts_an_arrival_once_per_task_and_answers_what_is_left():
    table = MagicMock()
    table.update_item.return_value = {'Attributes': {'remaining': 0, 'task_token': 'token', 'output': '{}'}}

    arrival = callbacks.arrive(GATE, 'task-1', table)

    call = table.update_item.call_args.kwargs
    assert (arrival, 'NOT contains(seen, :task_id)' in call['ConditionExpression'], call['ExpressionAttributeValues'][':task']) == (
        callbacks.Arrival(remaining=0, task_token='token', output='{}'), True, {'task-1'})


def test_ignores_an_unknown_gate_or_a_repeated_task():
    table = MagicMock()
    table.update_item.side_effect = _client_error('ConditionalCheckFailedException')

    assert callbacks.arrive(GATE, 'task-1', table) is None


def test_raises_any_other_table_failure():
    table = MagicMock()
    table.update_item.side_effect = _client_error('ProvisionedThroughputExceededException')

    with pytest.raises(ClientError):
        callbacks.arrive(GATE, 'task-1', table)


def test_settles_the_tasks_that_will_never_call_back():
    table = MagicMock()
    table.update_item.return_value = {'Attributes': {'remaining': 1, 'task_token': 'token', 'output': '{}'}}

    assert callbacks.settle(GATE, 2, table).remaining == 1
    assert table.update_item.call_args.kwargs['ExpressionAttributeValues'] == {':minus': -2}


def test_resumes_the_state_machine_with_the_gates_output():
    states = MagicMock()

    assert callbacks.release('token', '{"next": "collect"}', states) is True
    states.send_task_success.assert_called_once_with(taskToken='token', output='{"next": "collect"}')


@pytest.mark.parametrize('code', ['TaskTimedOut', 'TaskDoesNotExist', 'InvalidToken'])
def test_a_wait_that_already_ended_is_not_an_error(code):
    states = MagicMock()
    states.send_task_success.side_effect = _client_error(code)

    assert callbacks.release('token', '{}', states) is False
