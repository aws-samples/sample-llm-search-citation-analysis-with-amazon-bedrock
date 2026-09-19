"""
Get Execution Status API Lambda

Returns the status and history of a Step Functions execution.
"""

import json
import logging
import sys
from collections.abc import Callable, Mapping, Sequence
from typing import Any
from urllib.parse import unquote

import boto3

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import not_found_response, success_response, validation_error
from shared.decorators import api_handler, validate

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

stepfunctions = boto3.client('stepfunctions')

# History event types the timeline hides: each is redundant with, or noisier
# than, another event type the timeline already shows.
_HIDDEN_EVENT_TYPES = frozenset({
    'TaskScheduled',          # Redundant with TaskStarted
    'MapIterationStarted',    # Too noisy
    'MapIterationSucceeded',  # Too noisy
    'TaskStateEntered',       # Redundant - we use TaskStarted
    'MapStateEntered',        # Redundant - we use MapStateStarted
})

# Task events (TaskStarted / TaskSucceeded / TaskFailed) do not name their
# state; it is recovered by walking previousEventId back to the
# TaskStateEntered that scheduled the task, at most this many hops.
_MAX_STATE_LOOKUP_DEPTH = 10

# Friendly messages per workflow state. States not listed get a generic
# "<verb> <state>" message; task events whose state cannot be resolved get the
# bare fallback instead.
_TASK_STARTED_MESSAGES = {
    'ParseKeywords': 'Parsing keywords from S3',
    'SearchAllProviders': 'Searching all providers',
    'DeduplicateCitations': 'Deduplicating citations',
    'CrawlSingleCitation': 'Crawling citation',
    'GenerateSummary': 'Generating summary',
}
_TASK_SUCCEEDED_MESSAGES = {
    'ParseKeywords': 'Keywords parsed',
    'SearchAllProviders': 'Search completed',
    'DeduplicateCitations': 'Deduplication completed',
    'CrawlSingleCitation': 'Citation crawled',
    'GenerateSummary': 'Summary generated',
}
# TaskStateExited only earns a timeline entry for these states; the others
# produce no message and are dropped with the message-less entries.
_STATE_EXITED_MESSAGES = {
    'ParseKeywords': 'Keywords parsed successfully',
    'SearchAllProviders': 'Search completed',
    'DeduplicateCitations': 'Deduplication completed',
    'CrawlSingleCitation': 'Citation crawled',
    'GenerateSummary': 'Summary generated',
}
_MAP_EXITED_MESSAGES = {
    'ProcessKeywords': 'All keywords processed',
    'CrawlCitations': 'All citations crawled',
}

# Long error causes are cut to this many characters (plus an ellipsis).
_MAX_CAUSE_LENGTH = 200
# The timeline returns at most this many entries (the most recent ones).
_MAX_TIMELINE_EVENTS = 50


@api_handler
@validate({
    'id': {'source': 'path', 'type': str, 'max_length': 2048},
    'stateMachineArn': {'source': 'query', 'type': str, 'max_length': 256}
})
def handler(event: dict[str, Any], context: Any, id: str | None = None, stateMachineArn: str | None = None) -> dict[str, Any]:
    """
    GET /api/executions/{executionArn}
    GET /api/executions/latest

    Returns execution status and event history.
    """
    # URL decode the execution ID
    execution_id = unquote(id) if id else None
    if not execution_id:
        return validation_error('id path parameter required', event, 'id')

    if execution_id == 'latest':
        # Get the latest execution
        if not stateMachineArn:
            return validation_error('stateMachineArn query parameter required', event, 'stateMachineArn')

        executions = stepfunctions.list_executions(
            stateMachineArn=stateMachineArn,
            maxResults=1
        )

        if not executions.get('executions'):
            return not_found_response('Executions', event)

        execution_arn = executions['executions'][0]['executionArn']
    else:
        # Decode execution ARN from base64 or use directly
        execution_arn = execution_id

    # Get execution details
    execution = stepfunctions.describe_execution(executionArn=execution_arn)

    # Get execution history
    history = stepfunctions.get_execution_history(
        executionArn=execution_arn,
        maxResults=100,
        reverseOrder=True
    )

    display_events = _build_timeline(history.get('events', []))
    stop_date = execution.get('stopDate')

    return success_response({
        'execution': {
            'arn': execution['executionArn'],
            'name': execution['name'],
            'status': execution['status'],
            'start_date': execution['startDate'].isoformat(),
            'stop_date': stop_date.isoformat() if stop_date else None,
        },
        'events': display_events[:_MAX_TIMELINE_EVENTS]  # Limit to 50 most recent events
    }, event)


def _build_timeline(all_events: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """
    Turn the raw execution history into the timeline the dashboard shows.

    Hidden event types are dropped, every remaining event is described, and
    entries without a message or repeating an earlier (message, state) pair
    are filtered out. Order is preserved: Step Functions delivers the history
    newest-first, so the first of two identical messages is the latest one.
    """
    find_state_name = _state_name_resolver(all_events)

    events = []
    for evt in all_events:
        event_info = _describe_event(evt, find_state_name)
        if event_info is not None:
            events.append(event_info)

    return _deduplicate_messages(events)


def _state_name_resolver(all_events: Sequence[Mapping[str, Any]]) -> Callable[[Any], str | None]:
    """
    Build the lookup from a history event id to the state that scheduled it.

    Task events do not carry their state name; the returned function walks
    ``previousEventId`` back to the ``TaskStateEntered`` event that precedes
    the task. Both indexes are built ONCE so each lookup is O(depth) instead
    of O(n) — the whole pass was O(n²) before this. See audit item 15.
    """
    # First pass: build state mapping from TaskStateEntered events
    current_state_by_event_id = {
        evt['id']: evt.get('stateEnteredEventDetails', {}).get('name', '')
        for evt in all_events
        if evt['type'] == 'TaskStateEntered'
    }
    events_by_id = {e['id']: e for e in all_events}

    def find_state_name(event_id: Any, depth: int = 0) -> str | None:
        if depth > _MAX_STATE_LOOKUP_DEPTH or event_id is None:
            return None
        if event_id in current_state_by_event_id:
            return current_state_by_event_id[event_id]
        # O(1) lookup via events_by_id; recurse up the previousEventId chain.
        parent = events_by_id.get(event_id)
        if parent is None:
            return None
        return find_state_name(parent.get('previousEventId'), depth + 1)

    return find_state_name


def _describe_event(evt: Mapping[str, Any], find_state_name: Callable[[Any], str | None]) -> dict[str, Any] | None:
    """
    The timeline entry for one history event, or ``None`` for hidden types.

    Event types with no description keep the bare id/type/timestamp entry and
    are dropped later because they carry no message.
    """
    event_type = evt['type']
    event_info = {
        'id': evt['id'],
        'type': event_type,
        'timestamp': evt['timestamp'].isoformat()
    }

    # Skip noisy/redundant event types
    if event_type in _HIDDEN_EVENT_TYPES:
        return None

    if event_type in ('TaskStarted', 'TaskSucceeded', 'TaskFailed'):
        _describe_task_event(event_info, evt, find_state_name(evt.get('previousEventId')))
    else:
        _describe_transition_event(event_info, evt)

    return event_info


def _describe_task_event(event_info: dict[str, Any], evt: Mapping[str, Any], state_name: str | None) -> None:
    """Describe a TaskStarted / TaskSucceeded / TaskFailed event attributed to ``state_name`` (if resolved)."""
    event_type = evt['type']
    if state_name:
        event_info['state_name'] = state_name

    if event_type == 'TaskStarted':
        event_info['message'] = _task_message(_TASK_STARTED_MESSAGES, state_name, 'Running', 'Task started')
    elif event_type == 'TaskSucceeded':
        event_info['message'] = _task_message(_TASK_SUCCEEDED_MESSAGES, state_name, 'Completed', 'Task completed')
        _describe_task_output(event_info, evt.get('taskSucceededEventDetails', {}))
    else:
        _describe_task_failure(event_info, evt.get('taskFailedEventDetails', {}))


def _task_message(messages: dict[str, str], state_name: str | None, generic_verb: str, no_state_fallback: str) -> str:
    """The friendly message for ``state_name``, ``"<generic_verb> <state>"`` for unknown states, or the fallback."""
    if not state_name:
        return no_state_fallback
    # Generate descriptive message based on state
    return messages.get(state_name, f"{generic_verb} {state_name}")


def _describe_task_output(event_info: dict[str, Any], details: dict[str, Any]) -> None:
    """Attach a ``details`` count parsed from a succeeded task's JSON output, when it carries one.

    Only list-valued collections are counted; any other shape (a scalar
    output, a number where a list was expected, entries that are not
    objects) simply produces no ``details``.
    """
    try:
        output = json.loads(details.get('output', '{}'))
    except json.JSONDecodeError:
        return
    if not isinstance(output, dict):
        return

    keywords = output.get('keywords')
    citations = output.get('deduplicated_citations')
    results = output.get('results')
    if isinstance(keywords, list):
        event_info['details'] = f"{len(keywords)} keywords"
    elif isinstance(citations, list):
        event_info['details'] = f"{len(citations)} citations"
    elif isinstance(results, list):
        # Search results: one entry per provider
        event_info['details'] = f"{len(results)} providers, {_citation_total(results)} citations"


def _citation_total(results: list[Any]) -> float:
    """Sum of ``citation_count`` over the provider results that carry a numeric one (an ``int`` unless a count was a float)."""
    counts = (entry.get('citation_count', 0) for entry in results if isinstance(entry, dict))
    return sum(count for count in counts if isinstance(count, int | float))


def _describe_task_failure(event_info: dict[str, Any], details: dict[str, Any]) -> None:
    """Surface a failed task's error code and (truncated) cause."""
    event_info['message'] = "Task failed"
    event_info['error'] = details.get('error', 'Unknown error')
    cause = details.get('cause', '')
    if cause:
        # Truncate long error causes
        event_info['cause'] = cause[:_MAX_CAUSE_LENGTH] + '...' if len(cause) > _MAX_CAUSE_LENGTH else cause


def _describe_transition_event(event_info: dict[str, Any], evt: Mapping[str, Any]) -> None:
    """Describe a state-exit, Map or execution-level event; other types are left without a message."""
    event_type = evt['type']

    if event_type == 'TaskStateExited':
        # Important for tracking step completion
        state_name = evt.get('stateExitedEventDetails', {}).get('name', '')
        event_info['state_name'] = state_name
        # Generate completion message
        event_info['message'] = _STATE_EXITED_MESSAGES.get(state_name)

    elif event_type == 'MapStateStarted':
        event_info['message'] = "Processing keywords in parallel"
        event_info['state_name'] = 'ProcessKeywords'

    elif event_type == 'MapStateExited':
        state_name = evt.get('stateExitedEventDetails', {}).get('name', '')
        event_info['state_name'] = state_name
        # Map state names to friendly messages
        event_info['message'] = _MAP_EXITED_MESSAGES.get(state_name, f"Completed: {state_name}")

    elif event_type == 'ExecutionFailed':
        details = evt.get('executionFailedEventDetails', {})
        event_info['message'] = "Execution failed"
        event_info['error'] = details.get('error', 'Unknown error')

    elif event_type == 'ExecutionSucceeded':
        event_info['message'] = "Execution completed successfully"


def _deduplicate_messages(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Filter out events without messages and deduplicate by (message, state_name), keeping the first."""
    # Track seen messages to avoid duplicates
    seen_messages = set()
    display_events = []
    for e in events:
        msg = e.get('message')
        if msg is None:
            continue
        # Create a key for deduplication (message + state_name)
        dedup_key = f"{msg}|{e.get('state_name', '')}"
        if dedup_key not in seen_messages:
            seen_messages.add(dedup_key)
            display_events.append(e)
    return display_events
