"""POST /self-reflection runs the model call asynchronously; GET reports the job (B4).

The Bedrock call took 15-60 s inside API Gateway's 29 s. POST now answers at
once: 200 when no model call is needed, otherwise 202 after claiming a job
marker and invoking the same Lambda asynchronously. The asynchronous run
asks the model under the Lambda's own budget, stores the reflection and
removes the marker, or records why it failed; GET reports the marker.
"""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

from botocore.exceptions import ClientError

from shared.models import BedrockDeadlineError
from shared.self_invoke import SelfInvokeDispatchError
from testing.dynamodb_stubs import fake_dynamodb_resource, fake_table
from testing.env import SELF_REFLECTION_ENV
from testing.events import api_gateway_event, parse_response
from testing.handler_fixtures import handler_fixture
from testing.module_loader import API_DIR

_NOW = datetime(2026, 11, 5, 12, 0, tzinfo=UTC)
_REQUEST = {'keyword': 'hotel con spa', 'brand': 'Hotel Sol', 'query_prompt_id': 'familia'}
_MARKER_KEY = {'keyword_brand': 'hotel con spa#hotel sol', 'persona_timestamp': 'familia#~job'}
_REFLECTION = {'explanation': 'Sol is cited for its pool.', 'recommendations': []}

reflection = handler_fixture(
    API_DIR, 'self-reflection.py', 'self_reflection_jobs_under_test', env=SELF_REFLECTION_ENV,
)


def _prompt(module: Any) -> Any:
    return module._ReflectionPrompt('the prompt', 'Familia', {'industry': 'hotels'}, 2)


def _conditional_check_failed() -> ClientError:
    return ClientError({'Error': {'Code': 'ConditionalCheckFailedException', 'Message': 'exists'}}, 'PutItem')


class Post:
    """One POST /self-reflection through the handler, with what it read, wrote and invoked recorded."""

    def __init__(self, module: Any, *, prepared: Any = None, cached: dict | None = None,
                 put_item: Any = None, invoke: Any = None) -> None:
        self.table = fake_table()
        self.table.put_item.side_effect = put_item
        self.lambda_client = MagicMock()
        self.invoke = MagicMock(side_effect=invoke)
        self.bedrock = MagicMock(return_value='{}')
        event = api_gateway_event('POST', '/api/self-reflection', body=_REQUEST)
        with (
            patch.dict(os.environ, {'AWS_LAMBDA_FUNCTION_NAME': 'CitationAnalysis-API-SelfReflection'}),
            patch.multiple(
                module, dynamodb=fake_dynamodb_resource(self.table), check_cache=MagicMock(return_value=cached),
                _prepare_reflection=MagicMock(return_value=prepared or _prompt(module)),
                invoke_self_async=self.invoke, invoke_bedrock=self.bedrock, utc_now=MagicMock(return_value=_NOW),
            ),
        ):
            self.status, self.body = parse_response(module.handler(event, None))


class TestPostStartsAJob:
    def test_answers_202_pending_with_the_request(self, reflection):
        call = Post(reflection)

        assert (call.status, call.body) == (202, {'status': 'pending', **_REQUEST})

    def test_never_calls_the_model_inside_the_request(self, reflection):
        assert Post(reflection).bedrock.call_count == 0

    def test_invokes_its_own_lambda_asynchronously_with_the_job(self, reflection):
        name, payload = Post(reflection).invoke.call_args.args

        assert (name, json.loads(payload)) == ('CitationAnalysis-API-SelfReflection', {'self_reflection_job': _REQUEST})

    def test_claims_the_personas_marker_unless_a_fresh_pending_one_exists(self, reflection):
        put = Post(reflection).table.put_item.call_args.kwargs

        assert ({key: put['Item'][key] for key in _MARKER_KEY}, put['Item']['job_status'], put['ExpressionAttributeValues']) == (
            _MARKER_KEY, 'pending', {':pending': 'pending', ':stale': '2026-11-05T11:55:00.000000Z'},
        )

    def test_starts_nothing_while_the_same_job_is_pending(self, reflection):
        call = Post(reflection, put_item=_conditional_check_failed())

        assert (call.status, call.invoke.call_count) == (202, 0)

    def test_answers_503_and_marks_the_job_failed_when_the_invocation_is_refused(self, reflection):
        call = Post(reflection, invoke=SelfInvokeDispatchError('refused'))

        assert (call.status, call.table.update_item.call_args.kwargs['ExpressionAttributeValues'][':failed']) == (503, 'failed')


class TestPostAnswersAtOnceWithoutTheModel:
    def test_returns_a_cached_reflection_without_starting_a_job(self, reflection):
        call = Post(reflection, cached={**_REQUEST, 'explanation': 'cached', 'keyword_brand': 'k', 'persona_timestamp': 'p'})

        assert (call.status, call.body['explanation'], call.invoke.call_count) == (200, 'cached', 0)

    def test_returns_an_answer_that_needs_no_model_without_starting_a_job(self, reflection):
        answered = reflection._Answered({'explanation': 'absent'}, stored=True)

        call = Post(reflection, prepared=answered)

        assert (call.status, call.body, call.invoke.call_count) == (200, {'explanation': 'absent'}, 0)


class Job:
    """One asynchronous run of the handler, with the marker writes and the stored reflection recorded."""

    def __init__(self, module: Any, job: object = None, *, prepared: Any = None, bedrock: Any = None,
                 remaining_ms: int = 60_000) -> None:
        self.table = fake_table()
        self.bedrock = MagicMock(side_effect=bedrock, return_value=json.dumps(_REFLECTION))
        self.store = MagicMock()
        context = SimpleNamespace(get_remaining_time_in_millis=lambda: remaining_ms)
        with patch.multiple(
            module, dynamodb=fake_dynamodb_resource(self.table), invoke_bedrock=self.bedrock, store_reflection=self.store,
            _prepare_reflection=MagicMock(return_value=prepared or _prompt(module)),
        ):
            self.result = module.handler({'self_reflection_job': _REQUEST if job is None else job}, context)

    @property
    def failure(self) -> str:
        return self.table.update_item.call_args.kwargs['ExpressionAttributeValues'][':message']


class TestJobRun:
    def test_stores_the_models_reflection(self, reflection):
        stored = Job(reflection).store.call_args.args

        assert stored == ('hotel con spa', 'Hotel Sol', 'familia', 'Familia', _REFLECTION, {'industry': 'hotels'}, 2)

    def test_removes_the_marker_once_the_reflection_is_stored(self, reflection):
        job = Job(reflection)

        assert (job.result, job.table.delete_item.call_args.kwargs) == ({'status': 'done'}, {'Key': _MARKER_KEY})

    def test_bounds_the_model_call_by_the_lambdas_own_budget(self, reflection):
        deadline = Job(reflection, remaining_ms=60_000).bedrock.call_args.kwargs['deadline']

        assert 50 < deadline.remaining() <= 56

    def test_records_try_again_when_the_model_runs_out_of_time(self, reflection):
        job = Job(reflection, bedrock=BedrockDeadlineError('no answer within 55 s'))

        assert (job.result, job.failure, job.store.call_count) == (
            {'status': 'failed'}, 'The AI model did not answer in time; try again', 0,
        )

    def test_records_the_failure_instead_of_raising_when_the_job_breaks(self, reflection):
        job = Job(reflection, bedrock=ValueError('boom'))

        assert (job.result, job.failure) == ({'status': 'failed'}, 'The analysis failed; try again')

    def test_records_why_when_the_data_is_gone_by_the_time_the_job_runs(self, reflection):
        gone = reflection._Answered({'explanation': 'No search results found.'}, stored=False)

        assert Job(reflection, prepared=gone).failure == 'No search results found.'

    def test_ignores_a_malformed_job_without_touching_the_table(self, reflection):
        job = Job(reflection, {'keyword': 'k'})

        assert (job.result, job.table.method_calls) == ({'status': 'ignored'}, [])


class Get:
    """One GET /self-reflection for the request's keyword, brand and persona."""

    def __init__(self, module: Any, *, rows: list[dict], marker: dict | None) -> None:
        self.table = fake_table(query={'Items': rows}, get_item={'Item': marker} if marker else {})
        event = api_gateway_event('GET', '/api/self-reflection', query=_REQUEST)
        with patch.multiple(module, dynamodb=fake_dynamodb_resource(self.table), utc_now=MagicMock(return_value=_NOW)):
            self.status, self.body = parse_response(module.handler(event, None))


_STORED_ROW = {**_REQUEST, 'persona_timestamp': 'familia#2026-11-05T11:59:00.000000Z', 'explanation': 'done'}


class TestGetReportsTheJob:
    def test_reports_a_pending_job(self, reflection):
        marker = {**_MARKER_KEY, 'job_status': 'pending', 'started_at': '2026-11-05T11:59:30.000000Z'}

        assert Get(reflection, rows=[marker], marker=marker).body['job'] == {
            'status': 'pending', 'started_at': '2026-11-05T11:59:30.000000Z',
        }

    def test_reports_a_pending_job_past_its_time_as_failed(self, reflection):
        marker = {**_MARKER_KEY, 'job_status': 'pending', 'started_at': '2026-11-05T11:50:00.000000Z'}

        assert Get(reflection, rows=[], marker=marker).body['job'] == {
            'status': 'failed', 'started_at': '2026-11-05T11:50:00.000000Z', 'error': 'The analysis did not finish; try again',
        }

    def test_reports_no_job_and_the_reflection_once_it_finished(self, reflection):
        body = Get(reflection, rows=[_STORED_ROW], marker=None).body

        assert (body['job'], [row['explanation'] for row in body['results']]) == (None, ['done'])

    def test_leaves_the_marker_out_of_the_results(self, reflection):
        marker = {**_MARKER_KEY, 'job_status': 'failed', 'started_at': '2026-11-05T11:59:30.000000Z', 'error': 'x'}

        assert Get(reflection, rows=[marker, _STORED_ROW], marker=marker).body['count'] == 1


class TestCacheSkipsTheMarker:
    def test_serves_the_newest_reflection_behind_the_marker(self, reflection):
        marker = {**_MARKER_KEY, 'job_status': 'pending'}
        row = {**_STORED_ROW, 'created_at': '2026-11-05T11:59:00.000000Z'}
        table = fake_table(query={'Items': [marker, row]})
        with patch.multiple(reflection, dynamodb=fake_dynamodb_resource(table), utc_now=MagicMock(return_value=_NOW)):
            cached = reflection.check_cache('hotel con spa', 'Hotel Sol', 'familia')

        assert (cached, table.query.call_args.kwargs['Limit']) == (row, 2)
