"""
Keyword research job lifecycle through the API Lambda.

Since 2.2.0 the research work runs in the ``CitationAnalysis-KeywordResearch``
state machine; this Lambda creates the row, starts the execution and reads the
job back. These tests pin the contract the frontend and the worker rely on:

- a start that cannot be dispatched answers 503 and leaves the row terminal
  (``failed``), never ``pending`` forever, and never runs the work inline
- a successful start answers 202 with the job id and ``retry: false`` input
- ``GET /{id}`` exposes merged partial results while the job is running
- ``POST /{id}/retry`` accepts only failed/partial jobs and starts a uniquely
  named execution with ``retry: true``
- ``/history`` reads the ``TypeCreatedIndex`` GSI, newest first
- the reader-side stale sweep only fires past the state machine's budget and
  measures from the current attempt (``retried_at``), not the original start
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

os.environ.setdefault('KEYWORD_RESEARCH_TABLE', 'test-keyword-research')
os.environ.setdefault('RESEARCH_STATE_MACHINE_ARN', 'arn:aws:states:us-west-2:123456789012:stateMachine:research')
os.environ.setdefault('DYNAMODB_TABLE_RESEARCH_TEMPLATES', 'test-research-templates')
os.environ.setdefault('DYNAMODB_TABLE_KEYWORD_GROUPS', 'test-keyword-groups')

_HERE = os.path.dirname(os.path.abspath(__file__))
_LAMBDA_DIR = os.path.dirname(_HERE)
for _path in (_LAMBDA_DIR, _HERE):
    if _path not in sys.path:
        sys.path.insert(0, _path)
# Third-party runtime deps (requests, bs4) live in the built layer, not the
# dev venv. Appended, so `shared` still resolves from source first.
_LAYER_PY = os.path.join(_LAMBDA_DIR, 'layer', 'python')
if os.path.isdir(_LAYER_PY) and _LAYER_PY not in sys.path:
    sys.path.append(_LAYER_PY)

from shared.utils import get_timestamp

with patch('boto3.resource', MagicMock()), patch('boto3.client', MagicMock()):
    _spec = importlib.util.spec_from_file_location(
        'keyword_research_lifecycle_under_test', os.path.join(_HERE, 'keyword-research.py')
    )
    _mod = importlib.util.module_from_spec(_spec)
    sys.modules['keyword_research_lifecycle_under_test'] = _mod
    _spec.loader.exec_module(_mod)

# Well above the 30-minute state machine timeout.
STATE_MACHINE_TIMEOUT_SECONDS = 30 * 60
STALE_TIMESTAMP = '2020-01-01T00:00:00Z'


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


def _id_event(method: str, job_id: str, suffix: str = '') -> dict:
    return {
        'httpMethod': method,
        'path': f'/api/keyword-research/{job_id}{suffix}',
        'pathParameters': {'id': job_id},
    }


def _start_fails() -> MagicMock:
    stepfunctions = MagicMock()
    stepfunctions.start_execution.side_effect = ClientError(
        {'Error': {'Code': 'ExecutionLimitExceeded', 'Message': 'boom'}}, 'StartExecution'
    )
    return stepfunctions


def _start_succeeds() -> MagicMock:
    stepfunctions = MagicMock()
    stepfunctions.start_execution.return_value = {
        'executionArn': 'arn:aws:states:us-west-2:123456789012:execution:research:abc'
    }
    return stepfunctions


def _configured():
    return MagicMock(return_value=[('perplexity', object())])


def _table_with(item: dict | None) -> MagicMock:
    table = MagicMock()
    table.get_item.return_value = {'Item': item} if item is not None else {}
    return table


def _statuses_written(table: MagicMock) -> list[str]:
    return [
        call.kwargs.get('ExpressionAttributeValues', {}).get(':s')
        for call in table.update_item.call_args_list
    ]


class TestStartDispatchFailure:
    @pytest.mark.parametrize('event', [_expand_event(), _competitor_event()])
    def test_returns_503_when_the_execution_cannot_be_started(self, event):
        with (
            patch.object(_mod, 'research_table', MagicMock()),
            patch.object(_mod, 'get_web_search_clients', _configured()),
            patch.object(_mod, 'stepfunctions', _start_fails()),
        ):
            response = _mod.handler(event, None)

        assert response['statusCode'] == 503

    def test_marks_the_row_failed_rather_than_leaving_it_pending(self):
        """A row left `pending` has nothing that will ever advance it."""
        table = MagicMock()

        with (
            patch.object(_mod, 'research_table', table),
            patch.object(_mod, 'get_web_search_clients', _configured()),
            patch.object(_mod, 'stepfunctions', _start_fails()),
        ):
            _mod.handler(_expand_event(), None)

        assert 'failed' in _statuses_written(table)

    def test_returns_400_when_no_provider_is_configured(self):
        with (
            patch.object(_mod, 'research_table', MagicMock()),
            patch.object(_mod, 'get_web_search_clients', MagicMock(return_value=[])),
            patch.object(_mod, 'stepfunctions', _start_succeeds()),
        ):
            response = _mod.handler(_expand_event(), None)

        assert response['statusCode'] == 400


class TestStartSuccess:
    def test_returns_202_with_a_pending_job(self):
        with (
            patch.object(_mod, 'research_table', MagicMock()),
            patch.object(_mod, 'get_web_search_clients', _configured()),
            patch.object(_mod, 'stepfunctions', _start_succeeds()),
        ):
            response = _mod.handler(_expand_event(), None)

        body = json.loads(response['body'])
        assert response['statusCode'] == 202
        assert body['status'] == 'pending'
        assert body['type'] == 'expansion'

    def test_persists_the_pending_row_with_the_request_fields(self):
        table = MagicMock()

        with (
            patch.object(_mod, 'research_table', table),
            patch.object(_mod, 'get_web_search_clients', _configured()),
            patch.object(_mod, 'stepfunctions', _start_succeeds()),
        ):
            response = _mod.handler(_expand_event(), None)

        item = table.put_item.call_args.kwargs['Item']
        assert item['id'] == json.loads(response['body'])['id']
        assert (item['seed_keyword'], item['industry'], item['count'], item['status']) == (
            'best hotels malaga', 'hotels', 20, 'pending',
        )
        assert item['steps'] == {}

    def test_starts_the_execution_named_after_the_job_with_retry_false(self):
        stepfunctions = _start_succeeds()

        with (
            patch.object(_mod, 'research_table', MagicMock()),
            patch.object(_mod, 'get_web_search_clients', _configured()),
            patch.object(_mod, 'stepfunctions', stepfunctions),
        ):
            response = _mod.handler(_expand_event(), None)

        job_id = json.loads(response['body'])['id']
        call = stepfunctions.start_execution.call_args.kwargs
        assert call['name'] == job_id
        assert json.loads(call['input']) == {'job_id': job_id, 'retry': False}

    def test_competitor_job_records_the_normalised_url_and_domain(self):
        table = MagicMock()

        with (
            patch.object(_mod, 'research_table', table),
            patch.object(_mod, 'validate_url_safe', MagicMock(return_value=(True, None))),
            patch.object(_mod, 'get_web_search_clients', _configured()),
            patch.object(_mod, 'stepfunctions', _start_succeeds()),
        ):
            response = _mod.handler(_competitor_event(), None)

        item = table.put_item.call_args.kwargs['Item']
        assert response['statusCode'] == 202
        assert (item['type'], item['url'], item['domain']) == ('competitor', 'https://example.com/rooms', 'example.com')

    def test_points_clients_at_the_job_route_rather_than_a_status_route(self):
        with (
            patch.object(_mod, 'research_table', MagicMock()),
            patch.object(_mod, 'get_web_search_clients', _configured()),
            patch.object(_mod, 'stepfunctions', _start_succeeds()),
        ):
            response = _mod.handler(_expand_event(), None)

        body = json.loads(response['body'])
        assert f"/keyword-research/{body['id']}" in body['message']
        assert '/status/' not in body['message']


class TestGetResearch:
    def test_returns_404_for_an_unknown_job(self):
        with patch.object(_mod, 'research_table', _table_with(None)):
            response = _mod.handler(_id_event('GET', 'missing'), None)

        assert response['statusCode'] == 404

    def test_merges_completed_steps_while_the_job_is_still_running(self):
        job = {
            'id': 'job-1', 'type': 'expansion', 'status': 'running', 'created_at': get_timestamp(),
            'steps_total': 2,
            'steps': {
                'r1-perplexity': {'provider': 'perplexity', 'status': 'completed', 'keyword_count': 1,
                                  'keywords': [{'keyword': 'hotel malaga', 'relevance': 9}]},
                'r1-openai': {'provider': 'openai', 'status': 'running'},
            },
        }

        with patch.object(_mod, 'research_table', _table_with(job)):
            response = _mod.handler(_id_event('GET', 'job-1'), None)

        body = json.loads(response['body'])
        assert body['status'] == 'running'
        assert [entry['keyword'] for entry in body['keywords']] == ['hotel malaga']
        assert (body['steps_done'], body['steps_total']) == (1, 2)

    def test_lists_every_step_with_its_status(self):
        job = {
            'id': 'job-1', 'type': 'expansion', 'status': 'running', 'created_at': get_timestamp(),
            'steps': {
                'r1-perplexity': {'provider': 'perplexity', 'status': 'failed', 'error_message': '401'},
                'r1-openai': {'provider': 'openai', 'status': 'pending'},
            },
        }

        with patch.object(_mod, 'research_table', _table_with(job)):
            response = _mod.handler(_id_event('GET', 'job-1'), None)

        steps = json.loads(response['body'])['steps']
        assert [(step['provider'], step['status']) for step in steps] == [('openai', 'pending'), ('perplexity', 'failed')]
        assert steps[1]['error_message'] == '401'


class TestRetry:
    def _failed_job(self, status: str = 'partial') -> dict:
        return {
            'id': 'job-1', 'type': 'expansion', 'status': status, 'created_at': STALE_TIMESTAMP,
            'retry_count': 1,
            'steps': {
                'r1-perplexity': {'provider': 'perplexity', 'status': 'failed'},
                'r1-openai': {'provider': 'openai', 'status': 'completed', 'keywords': []},
            },
        }

    def test_returns_404_for_an_unknown_job(self):
        with (
            patch.object(_mod, 'research_table', _table_with(None)),
            patch.object(_mod, 'stepfunctions', _start_succeeds()),
        ):
            response = _mod.handler(_id_event('POST', 'missing', '/retry'), None)

        assert response['statusCode'] == 404

    @pytest.mark.parametrize('status', ['running', 'pending', 'completed'])
    def test_refuses_jobs_that_are_not_failed_or_partial(self, status):
        job = {**self._failed_job(status), 'created_at': get_timestamp()}
        stepfunctions = _start_succeeds()

        with (
            patch.object(_mod, 'research_table', _table_with(job)),
            patch.object(_mod, 'get_web_search_clients', _configured()),
            patch.object(_mod, 'stepfunctions', stepfunctions),
        ):
            response = _mod.handler(_id_event('POST', 'job-1', '/retry'), None)

        assert response['statusCode'] == 400
        stepfunctions.start_execution.assert_not_called()

    def test_starts_a_uniquely_named_execution_with_retry_true(self):
        stepfunctions = _start_succeeds()

        with (
            patch.object(_mod, 'research_table', _table_with(self._failed_job())),
            patch.object(_mod, 'get_web_search_clients', _configured()),
            patch.object(_mod, 'stepfunctions', stepfunctions),
        ):
            response = _mod.handler(_id_event('POST', 'job-1', '/retry'), None)

        call = stepfunctions.start_execution.call_args.kwargs
        assert response['statusCode'] == 202
        assert call['name'] == 'job-1-r2'
        assert json.loads(call['input']) == {'job_id': 'job-1', 'retry': True}

    def test_resets_the_job_to_pending_and_records_the_attempt(self):
        table = _table_with(self._failed_job())

        with (
            patch.object(_mod, 'research_table', table),
            patch.object(_mod, 'get_web_search_clients', _configured()),
            patch.object(_mod, 'stepfunctions', _start_succeeds()),
        ):
            response = _mod.handler(_id_event('POST', 'job-1', '/retry'), None)

        values = table.update_item.call_args.kwargs['ExpressionAttributeValues']
        assert (values[':s'], values[':n']) == ('pending', 2)
        assert 'retried_at' in table.update_item.call_args.kwargs['UpdateExpression']
        assert json.loads(response['body'])['retry_count'] == 2

    def test_allows_retrying_a_stale_running_job_the_sweep_just_failed(self):
        """A job whose execution died is retryable without waiting for another read."""
        job = {**self._failed_job('running'), 'retry_count': 0}
        stepfunctions = _start_succeeds()

        with (
            patch.object(_mod, 'research_table', _table_with(job)),
            patch.object(_mod, 'get_web_search_clients', _configured()),
            patch.object(_mod, 'stepfunctions', stepfunctions),
        ):
            response = _mod.handler(_id_event('POST', 'job-1', '/retry'), None)

        assert response['statusCode'] == 202
        assert stepfunctions.start_execution.call_args.kwargs['name'] == 'job-1-r1'

    def test_returns_503_and_marks_failed_when_the_retry_cannot_start(self):
        table = _table_with(self._failed_job())

        with (
            patch.object(_mod, 'research_table', table),
            patch.object(_mod, 'get_web_search_clients', _configured()),
            patch.object(_mod, 'stepfunctions', _start_fails()),
        ):
            response = _mod.handler(_id_event('POST', 'job-1', '/retry'), None)

        assert response['statusCode'] == 503
        assert _statuses_written(table)[-1] == 'failed'


class TestHistory:
    def _table_with_rows(self, rows_by_type: dict[str, list[dict]]) -> MagicMock:
        table = MagicMock()

        def query(**kwargs):
            job_type = kwargs['KeyConditionExpression'].get_expression()['values'][1]
            return {'Items': rows_by_type.get(job_type, [])}

        table.query.side_effect = query
        return table

    def test_queries_the_type_index_newest_first(self):
        table = self._table_with_rows({'expansion': []})
        event = {'httpMethod': 'GET', 'path': '/api/keyword-research/history', 'queryStringParameters': {'type': 'expansion'}}

        with patch.object(_mod, 'research_table', table):
            _mod.handler(event, None)

        call = table.query.call_args.kwargs
        assert call['IndexName'] == 'TypeCreatedIndex'
        assert call['ScanIndexForward'] is False
        table.scan.assert_not_called()

    def test_merges_both_types_sorted_by_creation_when_unfiltered(self):
        table = self._table_with_rows({
            'expansion': [{'id': 'e1', 'type': 'expansion', 'status': 'completed', 'created_at': '2026-09-18T10:00:00Z'}],
            'competitor': [{'id': 'c1', 'type': 'competitor', 'status': 'completed', 'created_at': '2026-09-18T11:00:00Z'}],
        })
        event = {'httpMethod': 'GET', 'path': '/api/keyword-research/history'}

        with patch.object(_mod, 'research_table', table):
            response = _mod.handler(event, None)

        assert [item['id'] for item in json.loads(response['body'])['items']] == ['c1', 'e1']

    def test_reports_the_swept_status_instead_of_a_stuck_spinner(self):
        """A stranded row must come back `failed`, not `running`."""
        table = self._table_with_rows({
            'expansion': [{'id': 'abc', 'type': 'expansion', 'status': 'running', 'created_at': STALE_TIMESTAMP}],
        })
        event = {'httpMethod': 'GET', 'path': '/api/keyword-research/history', 'queryStringParameters': {'type': 'expansion'}}

        with patch.object(_mod, 'research_table', table):
            response = _mod.handler(event, None)

        assert json.loads(response['body'])['items'][0]['status'] == 'failed'

    def test_strips_step_raw_responses_from_the_listing(self):
        table = self._table_with_rows({
            'expansion': [{
                'id': 'abc', 'type': 'expansion', 'status': 'completed', 'created_at': get_timestamp(),
                'raw_response': 'legacy blob',
                'steps': {'r1-openai': {'provider': 'openai', 'status': 'completed', 'raw_response': '[...]'}},
            }],
        })
        event = {'httpMethod': 'GET', 'path': '/api/keyword-research/history', 'queryStringParameters': {'type': 'expansion'}}

        with patch.object(_mod, 'research_table', table):
            response = _mod.handler(event, None)

        item = json.loads(response['body'])['items'][0]
        assert 'raw_response' not in item
        assert 'raw_response' not in item['steps'][0]


class TestStaleResearchSweep:
    def test_sweep_threshold_exceeds_the_state_machine_timeout(self):
        """
        A threshold at or below the execution timeout would mark still-running
        jobs as failed, which then complete and overwrite themselves — the
        inversion this sweep exists to avoid.
        """
        assert _mod.RESEARCH_STALE_AFTER_SECONDS > STATE_MACHINE_TIMEOUT_SECONDS

    @pytest.mark.parametrize('status', ['pending', 'running'])
    def test_marks_a_stranded_active_row_failed(self, status):
        row = {'id': 'abc', 'status': status, 'created_at': STALE_TIMESTAMP}

        with patch.object(_mod, 'research_table', MagicMock()):
            _mod._fail_if_research_timed_out(row)

        assert row['status'] == 'failed'

    def test_records_an_error_message_the_ui_can_show(self):
        row = {'id': 'abc', 'status': 'running', 'created_at': STALE_TIMESTAMP}

        with patch.object(_mod, 'research_table', MagicMock()):
            _mod._fail_if_research_timed_out(row)

        assert 'timed out' in row['error_message']

    def test_measures_from_the_current_attempt_not_the_original_start(self):
        """A retry of an old job must not be swept the moment it starts."""
        table = MagicMock()
        row = {'id': 'abc', 'status': 'running', 'created_at': STALE_TIMESTAMP, 'retried_at': get_timestamp()}

        with patch.object(_mod, 'research_table', table):
            _mod._fail_if_research_timed_out(row)

        assert row['status'] == 'running'
        table.update_item.assert_not_called()

    def test_leaves_a_recent_row_untouched(self):
        table = MagicMock()
        row = {'id': 'abc', 'status': 'running', 'created_at': get_timestamp()}

        with patch.object(_mod, 'research_table', table):
            _mod._fail_if_research_timed_out(row)

        assert row['status'] == 'running'
        table.update_item.assert_not_called()

    @pytest.mark.parametrize('status', ['completed', 'partial', 'failed'])
    def test_leaves_a_terminal_row_untouched(self, status):
        table = MagicMock()
        row = {'id': 'abc', 'status': status, 'created_at': STALE_TIMESTAMP}

        with patch.object(_mod, 'research_table', table):
            _mod._fail_if_research_timed_out(row)

        assert row['status'] == status
        table.update_item.assert_not_called()
