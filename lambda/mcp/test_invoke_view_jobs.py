"""
2.45.0 view jobs through the MCP server: a ``202`` computing answer is a non-error "call again" result,
a failed job is a tool error, and an expired list cursor says how to restart the list.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from catalogue import find_operation
from invoke import CURSOR_EXPIRED_NOTE, is_computing_body, run_operation

from testing.mcp_result_fixtures import text_block

FIXTURES = Path(__file__).resolve().parents[2] / 'test-fixtures' / 'scope-snapshots'


def _case(route: str, case: str) -> dict:
    """``(status, body)`` of one example in ``test-fixtures/scope-snapshots/<route>.json``."""
    document = json.loads((FIXTURES / f'{route}.json').read_text(encoding='utf-8'))
    return document['cases'][case]


COMPUTING = _case('visibility', 'computing')
FAILED = _case('visibility', 'failed')
EXPIRED = _case('visibility', 'cursor_expired')


def _get_visibility(caller) -> dict:
    return run_operation('get_visibility', find_operation('get_visibility'), {'all': True}, caller)


class TestComputingAnswer:
    def test_is_not_a_tool_error(self, api, caller):
        api.answer(COMPUTING['status'], COMPUTING['body'])

        assert 'isError' not in _get_visibility(caller)

    def test_says_to_call_again_in_whole_seconds(self, api, caller):
        api.answer(202, {**COMPUTING['body'], 'retry_after_ms': 2500})

        assert text_block(_get_visibility(caller))[0] == (
            'get_visibility: computing the complete figures for this scope; call again with the same arguments in 3 s.'
        )

    def test_carries_the_job_and_the_wait_as_structured_content(self, api, caller):
        api.answer(COMPUTING['status'], COMPUTING['body'])

        assert _get_visibility(caller)['structuredContent'] == {
            'status': 'computing',
            'job': COMPUTING['body']['job'],
            'retry_after_ms': COMPUTING['body']['retry_after_ms'],
            'retry_after_seconds': COMPUTING['body']['retry_after_ms'] // 1000,
        }

    def test_waits_at_least_one_second(self, api, caller):
        api.answer(202, {**COMPUTING['body'], 'retry_after_ms': 1})

        assert _get_visibility(caller)['structuredContent']['retry_after_seconds'] == 1

    def test_is_audited_as_the_202_it_was(self, api, caller, audit):
        api.answer(COMPUTING['status'], COMPUTING['body'])

        _get_visibility(caller)

        assert [line['outcome'] for line in audit()] == ['http_202']


class TestOtherAnswers:
    @pytest.mark.parametrize(('status', 'body'), [
        pytest.param(200, COMPUTING['body'], id='computing-body-with-200'),
        pytest.param(202, {'status': 'queued', 'id': 'research-1'}, id='other-202-body'),
        pytest.param(202, {**COMPUTING['body'], 'retry_after_ms': 0}, id='no-wait'),
        pytest.param(202, {**COMPUTING['body'], 'retry_after_ms': True}, id='boolean-wait'),
        pytest.param(202, {**COMPUTING['body'], 'job': 'job-1'}, id='job-not-an-object'),
        pytest.param(202, [COMPUTING['body']], id='list-body'),
    ])
    def test_a_body_that_is_not_a_202_computing_answer_is_not_one(self, status, body):
        assert is_computing_body(status, body) is False

    def test_a_failed_view_job_is_a_tool_error_with_its_message(self, api, caller):
        api.answer(FAILED['status'], FAILED['body'])

        result = _get_visibility(caller)

        assert (result['isError'], result['structuredContent']) == (
            True, {'status': 'failed', 'error': 'view_job_failed', 'details': FAILED['body']['message']},
        )

    def test_an_expired_cursor_says_to_restart_the_list(self, api, caller):
        api.answer(EXPIRED['status'], EXPIRED['body'])

        assert text_block(_get_visibility(caller))[0].endswith(CURSOR_EXPIRED_NOTE)

    def test_an_expired_cursor_carries_its_code(self, api, caller):
        api.answer(EXPIRED['status'], EXPIRED['body'])

        assert _get_visibility(caller)['structuredContent']['code'] == 'cursor_expired'
