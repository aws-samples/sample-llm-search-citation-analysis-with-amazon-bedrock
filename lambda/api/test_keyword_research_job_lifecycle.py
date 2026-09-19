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

import json
import os
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from shared.utils import get_timestamp
from testing.dynamodb_stubs import conditional_check_failure
from testing.env import KEYWORD_RESEARCH_ENV, setdefault_env
from testing.module_loader import load_handler_module_offline

setdefault_env(KEYWORD_RESEARCH_ENV)
_mod = load_handler_module_offline(os.path.dirname(__file__), 'keyword-research.py', 'keyword_research_lifecycle_under_test')

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


def _collaborators(**overrides: MagicMock):
    """Stub the handler's collaborators for a start that succeeds; ``overrides`` swap single ones.

    ``_collaborators(stepfunctions=_start_fails())`` keeps the configured
    provider and the inert table but makes the dispatch fail.
    """
    return patch.multiple(_mod, **{
        'research_table': MagicMock(),
        'get_web_search_clients': _configured(),
        'stepfunctions': _start_succeeds(),
        **overrides,
    })


class TestStartDispatchFailure:
    @pytest.mark.parametrize('event', [_expand_event(), _competitor_event()])
    def test_returns_503_when_the_execution_cannot_be_started(self, event):
        with _collaborators(stepfunctions=_start_fails()):
            response = _mod.handler(event, None)

        assert response['statusCode'] == 503

    def test_marks_the_row_failed_rather_than_leaving_it_pending(self):
        """A row left `pending` has nothing that will ever advance it."""
        table = MagicMock()

        with _collaborators(research_table=table, stepfunctions=_start_fails()):
            _mod.handler(_expand_event(), None)

        assert 'failed' in _statuses_written(table)

    def test_returns_400_when_no_provider_is_configured(self):
        with _collaborators(get_web_search_clients=MagicMock(return_value=[])):
            response = _mod.handler(_expand_event(), None)

        assert response['statusCode'] == 400


class TestStartSuccess:
    def test_returns_202_with_a_pending_job(self):
        with _collaborators():
            response = _mod.handler(_expand_event(), None)

        body = json.loads(response['body'])
        assert response['statusCode'] == 202
        assert body['status'] == 'pending'
        assert body['type'] == 'expansion'

    def test_persists_the_pending_row_with_the_request_fields(self):
        table = MagicMock()

        with _collaborators(research_table=table):
            response = _mod.handler(_expand_event(), None)

        item = table.put_item.call_args.kwargs['Item']
        assert item['id'] == json.loads(response['body'])['id']
        assert (item['seed_keyword'], item['industry'], item['count'], item['status']) == (
            'best hotels malaga', 'hotels', 20, 'pending',
        )
        assert item['steps'] == {}

    def test_starts_the_execution_named_after_the_job_with_retry_false(self):
        stepfunctions = _start_succeeds()

        with _collaborators(stepfunctions=stepfunctions):
            response = _mod.handler(_expand_event(), None)

        job_id = json.loads(response['body'])['id']
        call = stepfunctions.start_execution.call_args.kwargs
        assert call['name'] == job_id
        assert json.loads(call['input']) == {
            'job_id': job_id, 'retry': False, 'attempt': 1, 'expected_round': 1,
        }

    def test_competitor_job_records_the_normalised_url_and_domain(self):
        table = MagicMock()

        with _collaborators(research_table=table, validate_url_safe=MagicMock(return_value=(True, None))):
            response = _mod.handler(_competitor_event(), None)

        item = table.put_item.call_args.kwargs['Item']
        assert response['statusCode'] == 202
        assert (item['type'], item['url'], item['domain']) == ('competitor', 'https://example.com/rooms', 'example.com')

    def test_points_clients_at_the_job_route_rather_than_a_status_route(self):
        with _collaborators():
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
                'r1-openai': {'provider': 'openai', 'status': 'completed', 'keywords': [{'keyword': 'kept'}]},
            },
        }

    def _retry(self, job: dict, stepfunctions: MagicMock | None = None) -> tuple[dict, MagicMock, MagicMock]:
        """``POST /job-1/retry`` against a table holding ``job``; returns ``(response, table, stepfunctions)``."""
        table = _table_with(job)
        stepfunctions = stepfunctions or _start_succeeds()
        with _collaborators(research_table=table, stepfunctions=stepfunctions):
            response = _mod.handler(_id_event('POST', 'job-1', '/retry'), None)
        return response, table, stepfunctions

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

        response, _table, stepfunctions = self._retry(job)

        assert response['statusCode'] == 400
        stepfunctions.start_execution.assert_not_called()

    def test_starts_a_uniquely_named_execution_with_retry_true(self):
        response, _table, stepfunctions = self._retry(self._failed_job())

        call = stepfunctions.start_execution.call_args.kwargs
        assert response['statusCode'] == 202
        assert call['name'] == 'job-1-r2'
        assert json.loads(call['input']) == {
            'job_id': 'job-1', 'retry': True, 'attempt': 3, 'expected_round': 1,
        }

    def test_claims_the_next_attempt_and_retry_count_atomically(self):
        response, table, _stepfunctions = self._retry(self._failed_job())

        claim = table.update_item.call_args_list[0].kwargs
        values = claim['ExpressionAttributeValues']
        body = json.loads(response['body'])
        assert (values[':pending'], values[':next_attempt'], values[':next_retry_count']) == ('pending', 3, 2)
        assert 'attempt_started_at = :ts' in claim['UpdateExpression']
        assert (body['attempt'], body['retry_count']) == (3, 2)

    def test_allows_retrying_a_stale_running_job_the_sweep_just_failed(self):
        """A job whose execution died is retryable without waiting for another read."""
        job = {**self._failed_job('running'), 'retry_count': 0}

        response, _table, stepfunctions = self._retry(job)

        assert response['statusCode'] == 202
        assert stepfunctions.start_execution.call_args.kwargs['name'] == 'job-1-r1'

    def test_returns_503_and_preserves_checkpointed_results_when_retry_dispatch_fails(self):
        response, table, _stepfunctions = self._retry(self._failed_job(), stepfunctions=_start_fails())

        assert response['statusCode'] == 503
        assert _statuses_written(table)[-1] == 'partial'
        terminal_values = table.update_item.call_args.kwargs['ExpressionAttributeValues']
        assert any(
            value == [{'keyword': 'kept', 'providers': ['openai']}]
            for key, value in terminal_values.items() if key.startswith(':result')
        )


class TestHistory:
    def _table_with_rows(self, rows_by_type: dict[str, list[dict]]) -> MagicMock:
        table = MagicMock()

        def query(**kwargs):
            job_type = kwargs['KeyConditionExpression'].get_expression()['values'][1]
            return {'Items': rows_by_type.get(job_type, [])}

        table.query.side_effect = query
        return table

    def _history(self, table: MagicMock, job_type: str | None = None) -> list[dict]:
        """``GET /history`` (filtered to ``job_type`` when given) against ``table``; returns the listed items."""
        event: dict = {'httpMethod': 'GET', 'path': '/api/keyword-research/history'}
        if job_type is not None:
            event['queryStringParameters'] = {'type': job_type}

        with patch.object(_mod, 'research_table', table):
            response = _mod.handler(event, None)

        return json.loads(response['body'])['items']

    def test_queries_the_type_index_newest_first(self):
        table = self._table_with_rows({'expansion': []})

        self._history(table, 'expansion')

        call = table.query.call_args.kwargs
        assert call['IndexName'] == 'TypeCreatedIndex'
        assert call['ScanIndexForward'] is False
        table.scan.assert_not_called()

    def test_merges_both_types_sorted_by_creation_when_unfiltered(self):
        table = self._table_with_rows({
            'expansion': [{'id': 'e1', 'type': 'expansion', 'status': 'completed', 'created_at': '2026-09-18T10:00:00Z'}],
            'competitor': [{'id': 'c1', 'type': 'competitor', 'status': 'completed', 'created_at': '2026-09-18T11:00:00Z'}],
        })

        items = self._history(table)

        assert [item['id'] for item in items] == ['c1', 'e1']

    def test_reports_the_swept_status_instead_of_a_stuck_spinner(self):
        """A stranded row must come back `failed`, not `running`."""
        table = self._table_with_rows({
            'expansion': [{'id': 'abc', 'type': 'expansion', 'status': 'running', 'created_at': STALE_TIMESTAMP}],
        })

        items = self._history(table, 'expansion')

        assert items[0]['status'] == 'failed'

    def test_strips_step_raw_responses_from_the_listing(self):
        table = self._table_with_rows({
            'expansion': [{
                'id': 'abc', 'type': 'expansion', 'status': 'completed', 'created_at': get_timestamp(),
                'raw_response': 'legacy blob',
                'steps': {'r1-openai': {'provider': 'openai', 'status': 'completed', 'raw_response': '[...]'}},
            }],
        })

        item = self._history(table, 'expansion')[0]

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



class TestRetryClaimRaces:
    def test_lost_retry_claim_does_not_start_or_fail_the_live_attempt(self):
        job = {
            'id': 'job-race', 'type': 'expansion', 'status': 'partial', 'attempt': 2,
            'retry_count': 1, 'created_at': STALE_TIMESTAMP, 'steps': {},
        }
        table = _table_with(job)
        table.update_item.side_effect = conditional_check_failure(message='lost race')
        stepfunctions = _start_succeeds()

        with _collaborators(research_table=table, stepfunctions=stepfunctions):
            response = _mod.handler(_id_event('POST', 'job-race', '/retry'), None)

        assert response['statusCode'] == 400
        stepfunctions.start_execution.assert_not_called()
        assert table.update_item.call_count == 1
        assert 'attempt = :observed_attempt' in table.update_item.call_args.kwargs['ConditionExpression']

    def test_retry_claim_reads_the_job_strongly_consistently(self):
        job = {
            'id': 'job-consistent', 'type': 'expansion', 'status': 'failed', 'attempt': 1,
            'retry_count': 0, 'created_at': STALE_TIMESTAMP, 'steps': {},
        }
        table = _table_with(job)

        with _collaborators(research_table=table):
            response = _mod.handler(_id_event('POST', 'job-consistent', '/retry'), None)

        assert response['statusCode'] == 202
        table.get_item.assert_called_with(Key={'id': 'job-consistent'}, ConsistentRead=True)


class TestStaleAttemptVisibility:
    def test_timeout_persists_checkpointed_keywords_as_a_partial_result(self):
        row = {
            'id': 'job-timeout', 'type': 'expansion', 'status': 'running', 'attempt': 1,
            'attempt_started_at': STALE_TIMESTAMP, 'created_at': STALE_TIMESTAMP,
            'steps': {
                'r1-openai': {
                    'provider': 'openai', 'status': 'completed',
                    'keywords': [{'keyword': 'visible keyword', 'relevance': 9}],
                },
                'r1-gemini': {'provider': 'gemini', 'status': 'running'},
            },
        }
        table = _table_with(row)

        with patch.object(_mod, 'research_table', table):
            _mod._fail_if_research_timed_out(row)

        assert row['status'] == 'partial'
        assert row['keywords'] == [{'keyword': 'visible keyword', 'relevance': 9, 'providers': ['openai']}]
        assert 'attempt = :attempt' in table.update_item.call_args.kwargs['ConditionExpression']

    def test_timeout_losing_to_retry_leaves_the_new_attempt_unchanged(self):
        stale = {
            'id': 'job-timeout', 'type': 'expansion', 'status': 'running', 'attempt': 1,
            'attempt_started_at': STALE_TIMESTAMP, 'created_at': STALE_TIMESTAMP, 'steps': {},
        }
        current = {
            **stale,
            'status': 'pending',
            'attempt': 2,
            'attempt_started_at': get_timestamp(),
        }
        table = _table_with(current)
        table.update_item.side_effect = conditional_check_failure(message='retry won')

        with patch.object(_mod, 'research_table', table):
            _mod._fail_if_research_timed_out(stale)

        assert (stale['attempt'], stale['status']) == (2, 'pending')
        assert 'error_message' not in stale
