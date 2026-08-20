"""
REGRESSION (AUDIT-2026-08-19 §2.9): keyword research jobs must reach a terminal
state, and a failed dispatch must not run the LLM work on the client's request.

Two defects, same root: the async job lifecycle had no path to `failed` except
through a Python `except` block.

1. Dispatch failure ran the job inline. `shared/self_invoke.py` caught every
   exception from `invoke` and called the fallback — which here is
   `_process_expand_sync` / `_process_competitor_sync`, multi-provider web-search
   LLM calls. The client got a 504 at API Gateway's 29s ceiling while the
   function ran on toward its 120s timeout.

2. Nothing ever swept stale rows. `_mark_research_failed` only runs from an
   `except`, and a Lambda timeout is a SIGKILL that raises nothing — so a
   background run killed at 120s left `status='processing'` permanently.
   `_get_history` returned rows verbatim with no elapsed-time check, so the UI
   polled a spinner forever. Content Studio had this sweep; this module did not.
   Compounding it, async invocations are retried twice by default, so one
   timing-out job rewrote `processing` up to three times and still never
   resolved.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
from unittest.mock import MagicMock, patch

os.environ.setdefault('KEYWORD_RESEARCH_TABLE', 'test-keyword-research')

_HERE = os.path.dirname(os.path.abspath(__file__))
_LAMBDA_DIR = os.path.dirname(_HERE)
for _path in (_LAMBDA_DIR, _HERE):
    if _path not in sys.path:
        sys.path.insert(0, _path)

from shared.self_invoke import SelfInvokeDispatchError
from shared.utils import get_timestamp

_spec = importlib.util.spec_from_file_location(
    'keyword_research_lifecycle_under_test', os.path.join(_HERE, 'keyword-research.py')
)
_mod = importlib.util.module_from_spec(_spec)
sys.modules['keyword_research_lifecycle_under_test'] = _mod
_spec.loader.exec_module(_mod)


def _expand_event() -> dict:
    return {
        'httpMethod': 'POST',
        'path': '/api/keyword-research/expand',
        'body': json.dumps({'seed_keyword': 'best hotels malaga', 'industry': 'hotels'}),
    }


def _competitor_event() -> dict:
    return {
        'httpMethod': 'POST',
        'path': '/api/keyword-research/competitor',
        'body': json.dumps({'url': 'https://example.com/rooms'}),
    }


def _dispatch_fails() -> MagicMock:
    return MagicMock(side_effect=SelfInvokeDispatchError('boom'))


class TestExpandDispatchFailure:
    def test_returns_503_when_expansion_cannot_be_dispatched(self):
        with (
            patch.object(_mod, 'research_table', MagicMock()),
            patch.object(_mod, 'get_web_search_clients', MagicMock(return_value={'openai': object()})),
            patch.object(_mod, 'invoke_self_async', _dispatch_fails()),
        ):
            response = _mod._expand_keywords(_expand_event(), None)

        assert response['statusCode'] == 503

    def test_does_not_run_the_expansion_on_the_request(self):
        process = MagicMock()

        with (
            patch.object(_mod, 'research_table', MagicMock()),
            patch.object(_mod, 'get_web_search_clients', MagicMock(return_value={'openai': object()})),
            patch.object(_mod, '_process_expand_sync', process),
            patch.object(_mod, 'invoke_self_async', _dispatch_fails()),
        ):
            _mod._expand_keywords(_expand_event(), None)

        process.assert_not_called()

    def test_marks_the_row_failed_rather_than_leaving_it_pending(self):
        """A row left `pending` has nothing that will ever advance it."""
        table = MagicMock()

        with (
            patch.object(_mod, 'research_table', table),
            patch.object(_mod, 'get_web_search_clients', MagicMock(return_value={'openai': object()})),
            patch.object(_mod, 'invoke_self_async', _dispatch_fails()),
        ):
            _mod._expand_keywords(_expand_event(), None)

        statuses = [
            call.kwargs.get('ExpressionAttributeValues', {}).get(':s')
            for call in table.update_item.call_args_list
        ]
        assert 'failed' in statuses

    def test_returns_202_when_dispatch_succeeds(self):
        """Control: the happy path is unchanged."""
        with (
            patch.object(_mod, 'research_table', MagicMock()),
            patch.object(_mod, 'get_web_search_clients', MagicMock(return_value={'openai': object()})),
            patch.object(_mod, 'invoke_self_async', MagicMock()),
        ):
            response = _mod._expand_keywords(_expand_event(), None)

        assert response['statusCode'] == 202


class TestCompetitorDispatchFailure:
    def test_returns_503_when_competitor_analysis_cannot_be_dispatched(self):
        with (
            patch.object(_mod, 'research_table', MagicMock()),
            patch.object(_mod, 'validate_url_safe', MagicMock(return_value=(True, None))),
            patch.object(_mod, 'get_web_search_clients', MagicMock(return_value={'openai': object()})),
            patch.object(_mod, 'invoke_self_async', _dispatch_fails()),
        ):
            response = _mod._analyze_competitor(_competitor_event(), None)

        assert response['statusCode'] == 503

    def test_does_not_run_the_competitor_analysis_on_the_request(self):
        process = MagicMock()

        with (
            patch.object(_mod, 'research_table', MagicMock()),
            patch.object(_mod, 'validate_url_safe', MagicMock(return_value=(True, None))),
            patch.object(_mod, 'get_web_search_clients', MagicMock(return_value={'openai': object()})),
            patch.object(_mod, '_process_competitor_sync', process),
            patch.object(_mod, 'invoke_self_async', _dispatch_fails()),
        ):
            _mod._analyze_competitor(_competitor_event(), None)

        process.assert_not_called()

    def test_no_longer_advertises_a_status_route_that_does_not_exist(self):
        """
        The 202 body pointed clients at `/status/{id}`, but the CDK registers
        only /expand, /competitor, /history and /{id} for keyword research —
        following that instruction produced a 404.
        """
        with (
            patch.object(_mod, 'research_table', MagicMock()),
            patch.object(_mod, 'validate_url_safe', MagicMock(return_value=(True, None))),
            patch.object(_mod, 'get_web_search_clients', MagicMock(return_value={'openai': object()})),
            patch.object(_mod, 'invoke_self_async', MagicMock()),
        ):
            response = _mod._analyze_competitor(_competitor_event(), None)

        assert '/status/' not in json.loads(response['body'])['message']


class TestStaleResearchSweep:
    def test_sweep_threshold_exceeds_the_lambda_timeout(self):
        """
        The KeywordMgmt function's timeout is 120s. A threshold at or below it
        would mark still-running jobs as failed, which then complete and
        overwrite themselves — the inversion this sweep exists to avoid.
        """
        assert _mod.RESEARCH_TIMEOUT_SECONDS > 120

    def test_marks_a_stranded_processing_row_failed(self):
        """The audit case: killed at the Lambda timeout, stuck at `processing`."""
        row = {'id': 'abc', 'status': 'processing', 'created_at': '2020-01-01T00:00:00Z'}

        with patch.object(_mod, 'research_table', MagicMock()):
            _mod._fail_if_research_timed_out(row)

        assert row['status'] == 'failed'

    def test_marks_a_stranded_pending_row_failed(self):
        """A job killed before `_set_research_status` landed never left `pending`."""
        row = {'id': 'abc', 'status': 'pending', 'created_at': '2020-01-01T00:00:00Z'}

        with patch.object(_mod, 'research_table', MagicMock()):
            _mod._fail_if_research_timed_out(row)

        assert row['status'] == 'failed'

    def test_records_an_error_message_the_ui_can_show(self):
        row = {'id': 'abc', 'status': 'processing', 'created_at': '2020-01-01T00:00:00Z'}

        with patch.object(_mod, 'research_table', MagicMock()):
            _mod._fail_if_research_timed_out(row)

        assert 'timed out' in row['error_message']

    def test_leaves_a_recent_row_untouched(self):
        table = MagicMock()
        row = {'id': 'abc', 'status': 'processing', 'created_at': get_timestamp()}

        with patch.object(_mod, 'research_table', table):
            _mod._fail_if_research_timed_out(row)

        assert row['status'] == 'processing'
        table.update_item.assert_not_called()

    def test_leaves_a_completed_row_untouched(self):
        table = MagicMock()
        row = {'id': 'abc', 'status': 'completed', 'created_at': '2020-01-01T00:00:00Z'}

        with patch.object(_mod, 'research_table', table):
            _mod._fail_if_research_timed_out(row)

        assert row['status'] == 'completed'
        table.update_item.assert_not_called()

    def test_history_reports_the_swept_status_instead_of_a_stuck_spinner(self):
        """
        End to end through the route the UI actually polls: a stranded row must
        come back `failed`, not `processing`.
        """
        table = MagicMock()
        table.scan.return_value = {
            'Items': [{'id': 'abc', 'status': 'processing', 'created_at': '2020-01-01T00:00:00Z'}]
        }
        event = {'httpMethod': 'GET', 'path': '/api/keyword-research/history'}

        with patch.object(_mod, 'research_table', table):
            response = _mod._get_history(event, None)

        assert json.loads(response['body'])['items'][0]['status'] == 'failed'
