"""
REGRESSION (AUDIT-2026-08-19 §2.9): a failed async dispatch must not run the
generation on the client's request.

`POST /content-studio/generate` is async by design — it writes a `pending` row,
fires a self-invocation, and returns immediately so the client can poll. But
`shared/self_invoke.py` used to catch every exception from `invoke` and call the
fallback, and the fallback here IS `_process_generation_async`. So when dispatch
failed, the full Bedrock generation ran inline on an API-Gateway request:

- the client got a 504 at the gateway's hard 29s ceiling and lost the response
- the function kept running toward its 300s timeout, billed the model call, and
  wrote the result nobody would see

Worse, the row was left `pending` while the idempotency key (a 5-minute bucket)
meant an immediate user retry returned that same dead row *without* re-invoking
— so the obvious recovery action did nothing.

These tests pin the fail-fast contract: mark the row terminal, return 503, and
never execute the generation here.
"""

from __future__ import annotations

import json
import os
from unittest.mock import MagicMock, patch

from shared.self_invoke import SelfInvokeDispatchError
from shared.utils import get_timestamp
from testing.dynamodb_stubs import fake_dynamodb_resource, fake_table
from testing.env import setdefault_env
from testing.module_loader import load_handler_module

setdefault_env({
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-search',
    'DYNAMODB_TABLE_CITATIONS': 'test-citations',
    'DYNAMODB_TABLE_CRAWLED_CONTENT': 'test-crawled',
    'DYNAMODB_TABLE_CONTENT_STUDIO': 'test-content-studio',
})
_mod = load_handler_module(os.path.dirname(__file__), 'content-studio.py', 'content_studio_dispatch_under_test')


IDEA = {'id': 'idea-1', 'keyword': 'best hotels malaga', 'content_angle': 'comprehensive_guide'}


def _generate_event() -> dict:
    return {
        'httpMethod': 'POST',
        'path': '/content-studio/generate',
        'body': json.dumps({'idea': IDEA}),
    }


def _failing_dispatch() -> MagicMock:
    """An `invoke_self_async` whose dispatch fails outright."""
    return MagicMock(side_effect=SelfInvokeDispatchError('boom'))


def _generate(dispatch: MagicMock, update_content_status: MagicMock | None = None) -> dict:
    """Run `_generate_content` over a fresh pending row with `dispatch` as `invoke_self_async`."""
    # A resource whose table accepts the pending write as a fresh row.
    dynamodb = fake_dynamodb_resource(fake_table(get_item={}))
    with (
        patch.object(_mod, 'dynamodb', dynamodb),
        patch.object(_mod, 'update_content_status', update_content_status or MagicMock()),
        patch.object(_mod, 'invoke_self_async', dispatch),
    ):
        return _mod._generate_content(_generate_event(), None)


class TestDispatchFailureReturns503:
    def test_returns_503_when_the_generation_cannot_be_dispatched(self):
        response = _generate(_failing_dispatch())

        assert response['statusCode'] == 503

    def test_does_not_run_the_generation_on_the_request(self):
        """
        The whole point: `_process_generation_async` must not execute here.
        It is the callable handed to `invoke_self_async` as the fallback, so a
        helper that resumed falling back would trip this.
        """
        process = MagicMock()

        with patch.object(_mod, '_process_generation_async', process):
            _generate(_failing_dispatch())

        process.assert_not_called()

    def test_marks_the_row_failed_so_a_retry_is_not_blocked_by_idempotency(self):
        """
        The row must not stay `pending`: within the 5-minute idempotency window
        a retry returns the existing row without re-invoking, so a non-terminal
        row would make the failure permanent and invisible.
        """
        update = MagicMock()

        _generate(_failing_dispatch(), update_content_status=update)

        assert update.call_args.args[1] == 'failed'

    def test_reports_the_failed_status_in_the_response_body(self):
        response = _generate(_failing_dispatch())

        body = json.loads(response['body'])
        assert body['status'] == 'failed'

    def test_returns_pending_and_202_style_success_when_dispatch_works(self):
        """Control: the happy path must be untouched by the new guard."""
        response = _generate(MagicMock())

        body = json.loads(response['body'])
        assert body['status'] == 'pending'


class TestGenerationTimeoutSweep:
    """
    A Lambda timeout is a SIGKILL, so `_process_generation_async`'s `except`
    never runs. The reader-side sweep is the only thing that makes such a death
    observable — and its threshold must sit ABOVE the function's own timeout,
    or it marks live jobs failed and they flip back to `generated` on finish.
    """

    def test_sweep_threshold_exceeds_the_lambda_timeout(self):
        """
        Guards the 240s-vs-300s inversion: the default must leave room for a
        generation that legitimately runs to the 300s ceiling.
        """
        assert _mod.GENERATION_TIMEOUT_SECONDS > 300

    def test_marks_a_row_failed_once_past_the_threshold(self):
        row = {'id': 'abc', 'status': 'generating', 'created_at': '2020-01-01T00:00:00Z'}

        with patch.object(_mod, 'update_content_status', MagicMock()):
            _mod._fail_if_generation_timed_out(row)

        assert row['status'] == 'failed'

    def test_leaves_a_recent_row_untouched(self):
        row = {'id': 'abc', 'status': 'generating', 'created_at': get_timestamp()}
        update = MagicMock()

        with patch.object(_mod, 'update_content_status', update):
            _mod._fail_if_generation_timed_out(row)

        assert row['status'] == 'generating'
        update.assert_not_called()

    def test_leaves_an_already_terminal_row_untouched(self):
        """A completed row must never be rewritten to failed by the sweep."""
        row = {'id': 'abc', 'status': 'generated', 'created_at': '2020-01-01T00:00:00Z'}
        update = MagicMock()

        with patch.object(_mod, 'update_content_status', update):
            _mod._fail_if_generation_timed_out(row)

        assert row['status'] == 'generated'
        update.assert_not_called()
