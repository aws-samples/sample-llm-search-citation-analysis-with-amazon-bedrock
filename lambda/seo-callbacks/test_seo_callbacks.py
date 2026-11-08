"""The public DataForSEO pingback endpoint (``seo-callbacks.py``)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError

from shared.dataforseo_callbacks import Arrival
from testing.module_loader import load_handler_module

GATE = 'g' * 43
TASK = '11291016-1535-0066-0000-2d7e2f9dbc59'


@pytest.fixture(scope='module')
def callbacks():
    return load_handler_module(str(Path(__file__).resolve().parent), 'seo-callbacks.py', 'seo_callbacks_under_test')


@pytest.fixture
def gate(callbacks, monkeypatch):
    """``arrive`` answering ``gate.arrival``; ``release_if_due`` recorded."""
    stub = MagicMock()
    stub.arrival = Arrival(remaining=1, task_token='token', output='{"next": "collect"}')
    monkeypatch.setattr(callbacks, 'arrive', MagicMock(side_effect=lambda _gate, _task: stub.arrival))
    monkeypatch.setattr(callbacks, 'release_if_due', stub.release_if_due)
    return stub


def _ping(callbacks, query, method='GET'):
    event = {'requestContext': {'http': {'method': method}}, 'queryStringParameters': query}
    return callbacks.handler(event, None)


def test_counts_a_pingback_and_keeps_waiting_while_tasks_remain(callbacks, gate):
    answer = _ping(callbacks, {'gate': GATE, 'id': TASK})

    assert (answer['statusCode'], gate.release_if_due.call_count) == (200, 0)


def test_resumes_the_state_machine_on_the_last_pingback(callbacks, gate):
    gate.arrival = Arrival(remaining=0, task_token='token', output='{"next": "collect"}')

    _ping(callbacks, {'gate': GATE, 'id': TASK})

    gate.release_if_due.assert_called_once_with(GATE)


def test_a_repeated_pingback_tries_the_release_again_in_case_the_first_send_failed(callbacks, gate):
    gate.arrival = None
    gate.release_if_due.return_value = False

    assert (_ping(callbacks, {'gate': GATE, 'id': TASK})['statusCode'], gate.release_if_due.call_args.args) == (200, (GATE,))


@pytest.mark.parametrize('query', [{}, {'gate': 'short', 'id': TASK}, {'gate': GATE, 'id': 'a&b'}, None])
def test_refuses_a_malformed_pingback_without_reading_any_gate(callbacks, gate, query):
    assert _ping(callbacks, query)['statusCode'] == 400
    callbacks.arrive.assert_not_called()


def test_refuses_other_methods(callbacks, gate):
    assert _ping(callbacks, {'gate': GATE, 'id': TASK}, method='DELETE')['statusCode'] == 405


def test_answers_500_when_the_resume_fails_so_dataforseo_retries(callbacks, gate):
    gate.arrival = Arrival(remaining=0, task_token='token', output='{}')
    gate.release_if_due.side_effect = ClientError({'Error': {'Code': 'ThrottlingException', 'Message': 'slow'}}, 'SendTaskSuccess')

    assert _ping(callbacks, {'gate': GATE, 'id': TASK})['statusCode'] == 500
