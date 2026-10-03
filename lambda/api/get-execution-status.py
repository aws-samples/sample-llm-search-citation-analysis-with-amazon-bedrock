"""
Get Execution Status API Lambda

Returns the status and history of a Step Functions execution, plus the
per-keyword progress of its ProcessKeywords Distributed Map run.

``ProcessKeywords`` runs each keyword as a child execution, so the parent
history only carries ``MapRunStarted`` / ``MapRunSucceeded`` / ``MapRunFailed``
for it; the keyword counts come from ``DescribeMapRun``. Executions started
before the Distributed Map (inline Map) have no map run and report
``progress: null``.
"""

import json
import logging
import sys
from collections.abc import Callable, Mapping, Sequence
from typing import Any
from urllib.parse import unquote

import boto3
from botocore.exceptions import BotoCoreError, ClientError

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
_STATE_EXITED_MESSAGES = {**_TASK_SUCCEEDED_MESSAGES, 'ParseKeywords': 'Keywords parsed successfully'}
_MAP_EXITED_MESSAGES = {
    'ProcessKeywords': 'All keywords processed',
    'CrawlCitations': 'All citations crawled',
}
# Distributed Map run events; the only map run in the workflow is ProcessKeywords.
_MAP_RUN_MESSAGES = {
    'MapRunStarted': 'Keyword processing started',
    'MapRunSucceeded': 'Keyword processing completed',
    'MapRunFailed': 'Keyword processing failed',
}
_MAP_RUN_STATE_NAME = 'ProcessKeywords'

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

    Returns execution status, event history and ProcessKeywords keyword
    progress (``null`` until the map run starts, and for inline-Map runs).
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

    history_events = history.get('events', [])
    display_events = _build_timeline(history_events)
    stop_date = execution.get('stopDate')

    return success_response({
        'execution': {
            'arn': execution['executionArn'],
            'name': execution['name'],
            'status': execution['status'],
            'start_date': execution['startDate'].isoformat(),
            'stop_date': stop_date.isoformat() if stop_date else None,
        },
        'events': display_events[:_MAX_TIMELINE_EVENTS],  # Limit to 50 most recent events
        # A next page means older events (where MapRunStarted lives) were cut off.
        'progress': _keyword_progress(execution_arn, history_events, history_truncated='nextToken' in history),
    }, event)


def _keyword_progress(
    execution_arn: str, history_events: Sequence[Mapping[str, Any]], *, history_truncated: bool
) -> dict[str, int] | None:
    """
    Keyword counts of the execution's ProcessKeywords map run, or ``None``.

    ``None`` when no map run has started yet, for inline-Map executions
    started before the Distributed Map, and when Step Functions cannot be
    asked: progress is decoration, so a DescribeMapRun / ListMapRuns failure
    is logged and never fails the status endpoint.
    """
    try:
        map_run_arn = _find_map_run_arn(execution_arn, history_events, history_truncated=history_truncated)
        map_run = stepfunctions.describe_map_run(mapRunArn=map_run_arn) if map_run_arn else None
    except (ClientError, BotoCoreError):
        logger.exception('Keyword progress unavailable for %s', execution_arn)
        return None
    return _progress_from_item_counts(map_run.get('itemCounts', {})) if map_run else None


def _find_map_run_arn(
    execution_arn: str, history_events: Sequence[Mapping[str, Any]], *, history_truncated: bool
) -> str | None:
    """
    The ARN of the newest map run, from ``MapRunStarted`` in the fetched history.

    The history is read newest-first, so the first ``MapRunStarted`` is the
    latest one. When the page was truncated before reaching it, the execution's
    map runs are listed instead (``states:ListMapRuns``); a complete history
    without one means no map run exists, so no extra call is made.
    """
    for evt in history_events:
        if evt['type'] == 'MapRunStarted':
            return evt.get('mapRunStartedEventDetails', {}).get('mapRunArn')
    if not history_truncated:
        return None
    map_runs = stepfunctions.list_map_runs(executionArn=execution_arn).get('mapRuns', [])
    if not map_runs:
        return None
    return max(map_runs, key=lambda run: run['startDate'])['mapRunArn']


def _progress_from_item_counts(item_counts: Mapping[str, Any]) -> dict[str, int]:
    """DescribeMapRun ``itemCounts`` as keyword counts; timed-out and aborted children count as failed."""
    def count(key: str) -> int:
        value = item_counts.get(key, 0)
        return value if isinstance(value, int) and not isinstance(value, bool) else 0

    return {
        'keywords_total': count('total'),
        'keywords_succeeded': count('succeeded'),
        'keywords_failed': count('failed') + count('timedOut') + count('aborted'),
        'keywords_running': count('running'),
        'keywords_pending': count('pending'),
    }


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

    Only list-valued collections and a ``keyword_count`` are counted; any
    other shape (a scalar output, a number where a list was expected, entries
    that are not objects) simply produces no ``details``.
    """
    try:
        output = json.loads(details.get('output', '{}'))
    except json.JSONDecodeError:
        return
    if not isinstance(output, dict):
        return
    summary = _output_summary(output)
    if summary is not None:
        event_info['details'] = summary


def _output_summary(output: Mapping[str, Any]) -> str | None:
    """
    The count line for a task output, or ``None``.

    ParseKeywords reports ``keyword_count`` (the keywords now travel in an S3
    manifest); executions started before that still carry the ``keywords``
    list, which wins when both are present.
    """
    keywords = output.get('keywords')
    keyword_count = _as_count(output.get('keyword_count'))
    citations = output.get('deduplicated_citations')
    results = output.get('results')
    if isinstance(keywords, list):
        return f"{len(keywords)} keywords"
    if keyword_count is not None:
        return f"{keyword_count} keywords"
    if isinstance(citations, list):
        return f"{len(citations)} citations"
    if isinstance(results, list):
        # Search results: one entry per provider
        return f"{len(results)} providers, {_citation_total(results)} citations"
    return None


def _as_count(value: Any) -> int | None:
    """A non-negative ``int`` or ASCII-digit string as an ``int``; anything else (bools included) is ``None``."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if value >= 0 else None
    if isinstance(value, str) and value.isascii() and value.isdigit():
        return int(value)
    return None


def _citation_total(results: list[Any]) -> float:
    """Sum of ``citation_count`` over the provider results that carry a numeric one (an ``int`` unless a count was a float)."""
    counts = (entry.get('citation_count', 0) for entry in results if isinstance(entry, dict))
    return sum(count for count in counts if isinstance(count, int | float))


def _describe_task_failure(event_info: dict[str, Any], details: dict[str, Any]) -> None:
    """Surface a failed task's error code and (truncated) cause."""
    event_info['message'] = "Task failed"
    _attach_error(event_info, details)


def _attach_error(event_info: dict[str, Any], details: Mapping[str, Any]) -> None:
    """Copy a failure's error code (``Unknown error`` when absent) and its non-empty cause, truncated."""
    event_info['error'] = details.get('error', 'Unknown error')
    cause = details.get('cause', '')
    if cause:
        # Truncate long error causes
        event_info['cause'] = cause[:_MAX_CAUSE_LENGTH] + '...' if len(cause) > _MAX_CAUSE_LENGTH else cause


def _describe_map_run_event(event_info: dict[str, Any], evt: Mapping[str, Any]) -> None:
    """Describe a MapRunStarted / MapRunSucceeded / MapRunFailed event of the ProcessKeywords map run."""
    event_type = evt['type']
    event_info['state_name'] = _MAP_RUN_STATE_NAME
    event_info['message'] = _MAP_RUN_MESSAGES[event_type]
    if event_type == 'MapRunFailed':
        _attach_error(event_info, evt.get('mapRunFailedEventDetails', {}))


def _describe_transition_event(event_info: dict[str, Any], evt: Mapping[str, Any]) -> None:
    """Describe a state-exit, Map, map-run or execution-level event; other types are left without a message."""
    event_type = evt['type']

    if event_type in _MAP_RUN_MESSAGES:
        _describe_map_run_event(event_info, evt)

    elif event_type in ('TaskStateExited', 'MapStateExited'):
        # Important for tracking step completion: a task exit has a message only
        # for the known steps, a Map exit falls back to "Completed: <state>".
        state_name = evt.get('stateExitedEventDetails', {}).get('name', '')
        event_info['state_name'] = state_name
        event_info['message'] = (
            _STATE_EXITED_MESSAGES.get(state_name) if event_type == 'TaskStateExited'
            else _MAP_EXITED_MESSAGES.get(state_name, f"Completed: {state_name}")
        )

    elif event_type == 'MapStateStarted':
        event_info['message'] = "Processing keywords in parallel"
        event_info['state_name'] = 'ProcessKeywords'

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
