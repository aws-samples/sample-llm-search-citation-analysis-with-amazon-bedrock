"""
Characterization tests for get-execution-status.py — ``GET /api/executions/{id}``.

The handler turns a Step Functions execution and its event history into the
timeline the dashboard polls (``useExecutionPolling``). These tests pin that
contract branch by branch — execution lookup (``latest`` vs. an ARN), the
summary block, how each history event type is rendered, how a task event is
attributed to the state that entered it, timeline filtering, and the error
mapping the decorators apply — so the handler can be restructured without
moving any of it.

The client is a ``MagicMock`` swapped onto the module for each test. History
events reach the handler exactly as listed; Step Functions itself delivers
them newest-first (``reverseOrder=True``), which is why the timeline keeps the
*first* of two identical messages and the first fifty entries.
"""

from __future__ import annotations

import json
import os
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch
from urllib.parse import quote

import pytest
from botocore.exceptions import ClientError, ParamValidationError

from testing.events import api_gateway_event, parse_response
from testing.module_loader import load_handler_module_offline

_mod = load_handler_module_offline(os.path.dirname(__file__), 'get-execution-status.py')

_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:CitationAnalysis-Workflow'
_EXECUTION_ARN = 'arn:aws:states:us-east-1:123456789012:execution:CitationAnalysis-Workflow:run-1'
_STARTED_AT = datetime(2026, 9, 18, 10, 0, tzinfo=UTC)


def _execution_event(execution_id: str | None = _EXECUTION_ARN, **query: str) -> dict:
    """``GET /api/executions/{id}`` as API Gateway delivers it; ``query`` becomes the query string."""
    path_params = None if execution_id is None else {'id': execution_id}
    return api_gateway_event('GET', f'/api/executions/{execution_id or ""}', path_params=path_params, query=query or None)


def _timestamp(event_id: int) -> datetime:
    """History events are one second apart, so their ids double as offsets."""
    return _STARTED_AT + timedelta(seconds=event_id)


def _history_event(event_id: int, event_type: str, previous_event_id: int | None = 0, **details: object) -> dict:
    """One ``GetExecutionHistory`` event; ``details`` are its type-specific detail blocks."""
    return {
        'id': event_id,
        'type': event_type,
        'timestamp': _timestamp(event_id),
        'previousEventId': previous_event_id,
        **details,
    }


def _entered(event_id: int, state_name: str) -> dict:
    return _history_event(event_id, 'TaskStateEntered', stateEnteredEventDetails={'name': state_name})


def _started_task(state_name: str, first_id: int = 1) -> list[dict]:
    """``TaskStateEntered → TaskScheduled → TaskStarted`` linked the way Step Functions links them."""
    return [
        _entered(first_id, state_name),
        _history_event(first_id + 1, 'TaskScheduled', first_id),
        _history_event(first_id + 2, 'TaskStarted', first_id + 1),
    ]


def _distant_task(hops: int) -> list[dict]:
    """A ``GenerateSummary`` state entered ``hops`` pass-through events before its ``TaskStarted``."""
    relays = [_history_event(i, 'TaskSubmitted', i - 1) for i in range(2, hops + 2)]
    return [_entered(1, 'GenerateSummary'), *relays, _history_event(hops + 2, 'TaskStarted', hops + 1)]


def _task_outcome(state_name: str, outcome: str, **details: object) -> list[dict]:
    """A ``TaskStateEntered`` for ``state_name`` followed by its ``outcome`` event carrying ``details``."""
    return [_entered(1, state_name), _history_event(2, outcome, 1, **details)]


def _unattributed(event_type: str, **details: object) -> list[dict]:
    """An event whose chain leads back to ``ExecutionStarted`` without passing a ``TaskStateEntered``."""
    return [_history_event(1, 'ExecutionStarted'), _history_event(2, event_type, 1, **details)]


def _shown(event_id: int, event_type: str, **fields: object) -> dict:
    """The timeline entry the handler renders for history event ``event_id``."""
    return {'id': event_id, 'type': event_type, 'timestamp': _timestamp(event_id).isoformat(), **fields}


def _timeline(stepfunctions: MagicMock, *events: dict) -> list[dict]:
    """Serve ``events`` as the execution history and return the timeline the handler renders."""
    stepfunctions.get_execution_history.return_value = {'events': list(events)}
    _, body = parse_response(_mod.handler(_execution_event(), None))
    return body['events']


@pytest.fixture
def stepfunctions() -> Iterator[MagicMock]:
    """A Step Functions client serving one finished execution with an empty history."""
    client = MagicMock(name='stepfunctions')
    client.describe_execution.return_value = {
        'executionArn': _EXECUTION_ARN,
        'name': 'run-1',
        'status': 'SUCCEEDED',
        'startDate': _STARTED_AT,
        'stopDate': _STARTED_AT + timedelta(minutes=5),
    }
    client.get_execution_history.return_value = {'events': []}
    with patch.object(_mod, 'stepfunctions', client):
        yield client


class TestExecutionLookup:
    """Which execution the handler describes, and how it asks Step Functions for it."""

    def test_returns_400_when_latest_is_requested_without_a_state_machine_arn(self, stepfunctions):
        status, body = parse_response(_mod.handler(_execution_event('latest'), None))

        assert (status, body) == (400, {'error': 'stateMachineArn query parameter required', 'field': 'stateMachineArn'})
        stepfunctions.list_executions.assert_not_called()

    def test_returns_404_when_the_state_machine_has_no_executions(self, stepfunctions):
        stepfunctions.list_executions.return_value = {'executions': []}

        status, body = parse_response(_mod.handler(_execution_event('latest', stateMachineArn=_STATE_MACHINE_ARN), None))

        assert (status, body) == (404, {'error': 'Executions not found'})
        stepfunctions.describe_execution.assert_not_called()

    def test_asks_for_the_single_newest_execution_of_the_state_machine_when_latest_is_requested(self, stepfunctions):
        stepfunctions.list_executions.return_value = {'executions': [{'executionArn': _EXECUTION_ARN}]}

        _mod.handler(_execution_event('latest', stateMachineArn=_STATE_MACHINE_ARN), None)

        stepfunctions.list_executions.assert_called_once_with(stateMachineArn=_STATE_MACHINE_ARN, maxResults=1)

    def test_describes_the_execution_listed_for_latest(self, stepfunctions):
        latest_arn = f'{_EXECUTION_ARN[:-1]}9'
        stepfunctions.list_executions.return_value = {'executions': [{'executionArn': latest_arn}]}

        _mod.handler(_execution_event('latest', stateMachineArn=_STATE_MACHINE_ARN), None)

        stepfunctions.describe_execution.assert_called_once_with(executionArn=latest_arn)

    def test_describes_the_percent_decoded_arn_when_the_path_parameter_is_encoded(self, stepfunctions):
        _mod.handler(_execution_event(quote(_EXECUTION_ARN, safe='')), None)

        stepfunctions.describe_execution.assert_called_once_with(executionArn=_EXECUTION_ARN)

    def test_reads_the_hundred_newest_history_events_of_the_described_execution(self, stepfunctions):
        _mod.handler(_execution_event(), None)

        stepfunctions.get_execution_history.assert_called_once_with(
            executionArn=_EXECUTION_ARN, maxResults=100, reverseOrder=True
        )

    def test_answers_400_on_the_id_field_when_the_path_parameter_is_absent(self, stepfunctions):
        status, body = parse_response(_mod.handler(_execution_event(None), None))

        assert (status, body) == (400, {'error': 'id path parameter required', 'field': 'id'})
        stepfunctions.describe_execution.assert_not_called()

    def test_accepts_an_execution_id_of_exactly_2048_characters(self, stepfunctions):
        _mod.handler(_execution_event('x' * 2048), None)

        stepfunctions.describe_execution.assert_called_once_with(executionArn='x' * 2048)

    @pytest.mark.parametrize(('event', 'expected'), [
        (_execution_event('x' * 2049), {'error': 'id too long (max 2048 characters)', 'field': 'id'}),
        (
            _execution_event('latest', stateMachineArn='x' * 257),
            {'error': 'stateMachineArn too long (max 256 characters)', 'field': 'stateMachineArn'},
        ),
    ], ids=['execution-id', 'state-machine-arn'])
    def test_rejects_an_over_long_identifier_naming_the_offending_field(self, stepfunctions, event, expected):
        status, body = parse_response(_mod.handler(event, None))

        assert (status, body) == (400, expected)
        stepfunctions.describe_execution.assert_not_called()


class TestExecutionSummary:
    """The ``execution`` block of the response."""

    def test_returns_the_execution_summary_with_iso_dates_when_the_execution_has_stopped(self, stepfunctions):
        status, body = parse_response(_mod.handler(_execution_event(), None))

        assert status == 200
        assert body['execution'] == {
            'arn': _EXECUTION_ARN,
            'name': 'run-1',
            'status': 'SUCCEEDED',
            'start_date': '2026-09-18T10:00:00+00:00',
            'stop_date': '2026-09-18T10:05:00+00:00',
        }

    def test_reports_a_null_stop_date_while_the_execution_is_running(self, stepfunctions):
        stepfunctions.describe_execution.return_value.pop('stopDate')
        stepfunctions.describe_execution.return_value['status'] = 'RUNNING'

        _, body = parse_response(_mod.handler(_execution_event(), None))

        assert (body['execution']['status'], body['execution']['stop_date']) == ('RUNNING', None)

    def test_returns_an_empty_timeline_when_the_history_has_no_events(self, stepfunctions):
        assert _timeline(stepfunctions) == []


class TestTaskStarted:
    """``TaskStarted`` events are attributed to the state whose ``TaskStateEntered`` precedes them."""

    @pytest.mark.parametrize(('state_name', 'message'), [
        ('ParseKeywords', 'Parsing keywords from S3'),
        ('SearchAllProviders', 'Searching all providers'),
        ('DeduplicateCitations', 'Deduplicating citations'),
        ('CrawlSingleCitation', 'Crawling citation'),
        ('GenerateSummary', 'Generating summary'),
        ('CustomStep', 'Running CustomStep'),
    ])
    def test_describes_a_started_task_by_the_state_that_scheduled_it(self, stepfunctions, state_name, message):
        events = _timeline(stepfunctions, *_started_task(state_name))

        assert events == [_shown(3, 'TaskStarted', state_name=state_name, message=message)]

    def test_reports_task_started_without_a_state_when_no_state_entered_event_precedes_it(self, stepfunctions):
        events = _timeline(stepfunctions, *_unattributed('TaskStarted'))

        assert events == [_shown(2, 'TaskStarted', message='Task started')]

    @pytest.mark.parametrize('previous_event_id', [6, None], ids=['event-outside-the-page', 'no-predecessor'])
    def test_reports_task_started_without_a_state_when_its_predecessor_cannot_be_followed(
        self, stepfunctions, previous_event_id
    ):
        events = _timeline(stepfunctions, _history_event(7, 'TaskStarted', previous_event_id))

        assert events == [_shown(7, 'TaskStarted', message='Task started')]

    def test_attributes_the_task_to_a_state_entered_ten_events_earlier(self, stepfunctions):
        events = _timeline(stepfunctions, *_distant_task(10))

        assert events == [_shown(12, 'TaskStarted', state_name='GenerateSummary', message='Generating summary')]

    def test_stops_following_the_chain_when_the_state_was_entered_eleven_events_earlier(self, stepfunctions):
        events = _timeline(stepfunctions, *_distant_task(11))

        assert events == [_shown(13, 'TaskStarted', message='Task started')]


class TestTaskSucceeded:
    """``TaskSucceeded`` events carry a state message plus a count parsed from the task output."""

    @pytest.mark.parametrize(('state_name', 'message'), [
        ('ParseKeywords', 'Keywords parsed'),
        ('SearchAllProviders', 'Search completed'),
        ('DeduplicateCitations', 'Deduplication completed'),
        ('CrawlSingleCitation', 'Citation crawled'),
        ('GenerateSummary', 'Summary generated'),
        ('CustomStep', 'Completed CustomStep'),
    ])
    def test_describes_a_succeeded_task_by_its_state(self, stepfunctions, state_name, message):
        events = _timeline(stepfunctions, *_task_outcome(state_name, 'TaskSucceeded'))

        assert events == [_shown(2, 'TaskSucceeded', state_name=state_name, message=message)]

    def test_reports_task_completed_without_a_state_when_no_state_entered_event_precedes_it(self, stepfunctions):
        events = _timeline(stepfunctions, *_unattributed('TaskSucceeded'))

        assert events == [_shown(2, 'TaskSucceeded', message='Task completed')]

    @pytest.mark.parametrize(('output', 'details'), [
        ({'keywords': ['a', 'b', 'c']}, '3 keywords'),
        ({'deduplicated_citations': [{'url': 'https://a.example'}, {'url': 'https://b.example'}]}, '2 citations'),
        ({'results': [{'citation_count': 3}, {'citation_count': 2}, {'provider': 'gemini'}]}, '3 providers, 5 citations'),
        ({'keywords': ['a'], 'deduplicated_citations': [], 'results': []}, '1 keywords'),
        ({'results': [1, 'gemini', {'citation_count': 2}]}, '3 providers, 2 citations'),
        ({'results': [{'citation_count': 'many'}, {'citation_count': 4}]}, '2 providers, 4 citations'),
        ({'keywords': 5, 'results': [{'citation_count': 1}]}, '1 providers, 1 citations'),
    ], ids=[
        'keywords', 'deduplicated-citations', 'search-results', 'keywords-win-over-other-collections',
        'non-object-result-entries-count-as-providers', 'non-numeric-citation-count-is-skipped',
        'uncountable-keywords-fall-through-to-results',
    ])
    def test_summarises_the_countable_collection_in_the_task_output(self, stepfunctions, output, details):
        succeeded = _task_outcome('ParseKeywords', 'TaskSucceeded', taskSucceededEventDetails={'output': json.dumps(output)})

        events = _timeline(stepfunctions, *succeeded)

        assert events[0]['details'] == details

    @pytest.mark.parametrize('details_block', [
        {},
        {'taskSucceededEventDetails': {}},
        {'taskSucceededEventDetails': {'output': 'not json'}},
        {'taskSucceededEventDetails': {'output': '{"status": "ok"}'}},
        {'taskSucceededEventDetails': {'output': '42'}},
        {'taskSucceededEventDetails': {'output': '"keywords"'}},
        {'taskSucceededEventDetails': {'output': '{"keywords": 5}'}},
        {'taskSucceededEventDetails': {'output': '{"keywords": "abc"}'}},
        {'taskSucceededEventDetails': {'output': '{"results": "oops"}'}},
        {'taskSucceededEventDetails': {'output': '{"deduplicated_citations": {"a": 1}}'}},
    ], ids=[
        'no-details', 'no-output', 'malformed-json', 'nothing-countable', 'scalar-output', 'string-output',
        'uncountable-keywords', 'string-keywords', 'string-results', 'object-citations',
    ])
    def test_omits_details_when_the_output_carries_nothing_countable(self, stepfunctions, details_block):
        events = _timeline(stepfunctions, *_task_outcome('ParseKeywords', 'TaskSucceeded', **details_block))

        assert events == [_shown(2, 'TaskSucceeded', state_name='ParseKeywords', message='Keywords parsed')]


class TestTaskFailed:
    """``TaskFailed`` events surface the error code and a bounded cause."""

    def test_reports_the_error_and_cause_of_a_failed_task_with_its_state(self, stepfunctions):
        failure = {'error': 'States.Timeout', 'cause': 'Provider timed out'}

        events = _timeline(stepfunctions, *_task_outcome('SearchAllProviders', 'TaskFailed', taskFailedEventDetails=failure))

        assert events == [_shown(
            2, 'TaskFailed',
            state_name='SearchAllProviders', message='Task failed', error='States.Timeout', cause='Provider timed out',
        )]

    def test_reports_unknown_error_without_a_cause_when_the_failure_has_no_details(self, stepfunctions):
        events = _timeline(stepfunctions, *_unattributed('TaskFailed'))

        assert events == [_shown(2, 'TaskFailed', message='Task failed', error='Unknown error')]

    def test_omits_the_cause_when_it_is_empty(self, stepfunctions):
        failure = {'error': 'States.TaskFailed', 'cause': ''}

        events = _timeline(stepfunctions, *_task_outcome('ParseKeywords', 'TaskFailed', taskFailedEventDetails=failure))

        assert events == [_shown(2, 'TaskFailed', state_name='ParseKeywords', message='Task failed', error='States.TaskFailed')]

    @pytest.mark.parametrize(('cause', 'shown'), [
        ('x' * 201, 'x' * 200 + '...'),
        ('x' * 200, 'x' * 200),
    ], ids=['201-chars-truncated', '200-chars-intact'])
    def test_truncates_the_cause_only_beyond_200_characters(self, stepfunctions, cause, shown):
        events = _timeline(stepfunctions, *_task_outcome('ParseKeywords', 'TaskFailed', taskFailedEventDetails={'cause': cause}))

        assert events[0]['cause'] == shown


class TestStateTransitions:
    """State-exit, Map and execution-level events."""

    @pytest.mark.parametrize(('state_name', 'message'), [
        ('ParseKeywords', 'Keywords parsed successfully'),
        ('SearchAllProviders', 'Search completed'),
        ('DeduplicateCitations', 'Deduplication completed'),
        ('CrawlSingleCitation', 'Citation crawled'),
        ('GenerateSummary', 'Summary generated'),
    ])
    def test_describes_a_known_state_exit_by_its_completion_message(self, stepfunctions, state_name, message):
        events = _timeline(stepfunctions, _history_event(1, 'TaskStateExited', stateExitedEventDetails={'name': state_name}))

        assert events == [_shown(1, 'TaskStateExited', state_name=state_name, message=message)]

    def test_omits_the_exit_of_a_state_that_has_no_completion_message(self, stepfunctions):
        events = _timeline(stepfunctions, _history_event(1, 'TaskStateExited', stateExitedEventDetails={'name': 'CustomStep'}))

        assert events == []

    def test_announces_parallel_keyword_processing_when_the_map_state_starts(self, stepfunctions):
        events = _timeline(stepfunctions, _history_event(1, 'MapStateStarted'))

        assert events == [_shown(1, 'MapStateStarted', message='Processing keywords in parallel', state_name='ProcessKeywords')]

    @pytest.mark.parametrize(('state_name', 'message'), [
        ('ProcessKeywords', 'All keywords processed'),
        ('CrawlCitations', 'All citations crawled'),
        ('CustomMap', 'Completed: CustomMap'),
    ])
    def test_describes_a_finished_map_state_by_its_name(self, stepfunctions, state_name, message):
        events = _timeline(stepfunctions, _history_event(1, 'MapStateExited', stateExitedEventDetails={'name': state_name}))

        assert events == [_shown(1, 'MapStateExited', state_name=state_name, message=message)]

    def test_reports_only_the_error_code_when_the_execution_fails(self, stepfunctions):
        failure = {'error': 'States.Runtime', 'cause': 'not surfaced'}

        events = _timeline(stepfunctions, _history_event(1, 'ExecutionFailed', executionFailedEventDetails=failure))

        assert events == [_shown(1, 'ExecutionFailed', message='Execution failed', error='States.Runtime')]

    def test_reports_unknown_error_when_the_execution_failure_has_no_details(self, stepfunctions):
        events = _timeline(stepfunctions, _history_event(1, 'ExecutionFailed'))

        assert events == [_shown(1, 'ExecutionFailed', message='Execution failed', error='Unknown error')]

    def test_announces_completion_when_the_execution_succeeds(self, stepfunctions):
        events = _timeline(stepfunctions, _history_event(1, 'ExecutionSucceeded'))

        assert events == [_shown(1, 'ExecutionSucceeded', message='Execution completed successfully')]


class TestTimelineFiltering:
    """What is dropped, what is deduplicated, and how many entries survive."""

    @pytest.mark.parametrize('event_type', [
        'TaskScheduled', 'MapIterationStarted', 'MapIterationSucceeded', 'TaskStateEntered', 'MapStateEntered',
    ])
    def test_hides_scheduling_and_iteration_noise(self, stepfunctions, event_type):
        assert _timeline(stepfunctions, _history_event(1, event_type)) == []

    @pytest.mark.parametrize('event_type', ['ExecutionStarted', 'TaskSubmitted', 'ChoiceStateEntered', 'ExecutionAborted'])
    def test_omits_event_types_that_have_no_timeline_message(self, stepfunctions, event_type):
        assert _timeline(stepfunctions, _history_event(1, event_type)) == []

    def test_keeps_only_the_first_of_two_identical_messages_for_the_same_state(self, stepfunctions):
        events = _timeline(stepfunctions, *_started_task('ParseKeywords', first_id=1), *_started_task('ParseKeywords', first_id=11))

        assert events == [_shown(3, 'TaskStarted', state_name='ParseKeywords', message='Parsing keywords from S3')]

    def test_keeps_identical_messages_that_belong_to_different_states(self, stepfunctions):
        events = _timeline(
            stepfunctions,
            _entered(1, 'ParseKeywords'), _history_event(2, 'TaskFailed', 1),
            _entered(3, 'GenerateSummary'), _history_event(4, 'TaskFailed', 3),
        )

        assert events == [
            _shown(2, 'TaskFailed', state_name='ParseKeywords', message='Task failed', error='Unknown error'),
            _shown(4, 'TaskFailed', state_name='GenerateSummary', message='Task failed', error='Unknown error'),
        ]

    def test_keeps_an_identical_message_when_only_one_occurrence_names_a_state(self, stepfunctions):
        events = _timeline(stepfunctions, _entered(1, 'ParseKeywords'), _history_event(2, 'TaskFailed', 1), _history_event(3, 'TaskFailed', None))

        assert [(e['id'], e.get('state_name')) for e in events] == [(2, 'ParseKeywords'), (3, None)]

    def test_preserves_the_history_order_in_the_timeline(self, stepfunctions):
        events = _timeline(stepfunctions, _history_event(9, 'ExecutionSucceeded', 8), _history_event(1, 'MapStateStarted'))

        assert [e['id'] for e in events] == [9, 1]

    def test_caps_the_timeline_at_the_first_fifty_entries(self, stepfunctions):
        exits = [_history_event(i, 'MapStateExited', i - 1, stateExitedEventDetails={'name': f'Batch{i}'}) for i in range(1, 61)]

        events = _timeline(stepfunctions, *exits)

        assert [e['id'] for e in events] == list(range(1, 51))


class TestErrorMapping:
    """Failures from the Step Functions client come back as sanitised 500s."""

    @pytest.mark.parametrize(('failure', 'message'), [
        (
            ClientError({'Error': {'Code': 'ExecutionDoesNotExist', 'Message': 'Execution Does Not Exist'}}, 'DescribeExecution'),
            'Service temporarily unavailable',
        ),
        (ParamValidationError(report='Invalid type for parameter executionArn, value: None'), 'An unexpected error occurred'),
    ], ids=['client-error', 'parameter-validation'])
    def test_returns_a_sanitised_500_when_step_functions_rejects_the_lookup(self, stepfunctions, failure, message):
        stepfunctions.describe_execution.side_effect = failure

        status, body = parse_response(_mod.handler(_execution_event(), None))

        assert (status, body) == (500, {'error': message})
