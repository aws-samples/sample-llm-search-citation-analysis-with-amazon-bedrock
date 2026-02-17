"""
Get Execution Status API Lambda

Returns the status and history of a Step Functions execution.
"""

import json
import sys
import logging
import boto3
from typing import Dict, Any
from urllib.parse import unquote

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.decorators import api_handler, validate
from shared.api_response import success_response, validation_error, not_found_response

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

stepfunctions = boto3.client('stepfunctions')


@api_handler
@validate({
    'id': {'source': 'path', 'type': str, 'max_length': 2048},
    'stateMachineArn': {'source': 'query', 'type': str, 'max_length': 256}
})
def handler(event: Dict[str, Any], context: Any, id: str = None, stateMachineArn: str = None) -> Dict[str, Any]:
    """
    GET /api/executions/{executionArn}
    GET /api/executions/latest
    
    Returns execution status and event history.
    """
    # URL decode the execution ID
    execution_id = unquote(id) if id else None
    
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
    
    # Parse events to extract useful information
    # Track current state from TaskStateEntered events
    current_state_by_event_id = {}
    events = []
    
    # First pass: build state mapping from TaskStateEntered events
    for evt in history.get('events', []):
        if evt['type'] == 'TaskStateEntered':
            details = evt.get('stateEnteredEventDetails', {})
            state_name = details.get('name', '')
            # Map this event ID to subsequent events
            current_state_by_event_id[evt['id']] = state_name
    
    # Helper to find state name from event chain
    def find_state_name(event_id, depth=0):
        if depth > 10 or event_id is None:
            return None
        if event_id in current_state_by_event_id:
            return current_state_by_event_id[event_id]
        # Look for the event with this ID
        for e in history.get('events', []):
            if e['id'] == event_id:
                return find_state_name(e.get('previousEventId'), depth + 1)
        return None
    
    # Track seen messages to avoid duplicates
    seen_messages = set()
    
    # Second pass: process all events
    for evt in history.get('events', []):
        event_type = evt['type']
        timestamp = evt['timestamp'].isoformat()
        previous_event_id = evt.get('previousEventId')
        
        event_info = {
            'id': evt['id'],
            'type': event_type,
            'timestamp': timestamp
        }
        
        # Skip noisy/redundant event types
        skip_types = {
            'TaskScheduled',      # Redundant with TaskStarted
            'MapIterationStarted', # Too noisy
            'MapIterationSucceeded', # Too noisy
            'TaskStateEntered',   # Redundant - we use TaskStarted
            'MapStateEntered',    # Redundant - we use MapStateStarted
        }
        if event_type in skip_types:
            continue
        
        if event_type == 'TaskStarted':
            state_name = find_state_name(previous_event_id)
            if state_name:
                event_info['state_name'] = state_name
                # Generate descriptive message based on state
                state_messages = {
                    'ParseKeywords': 'Parsing keywords from S3',
                    'SearchAllProviders': 'Searching all providers',
                    'DeduplicateCitations': 'Deduplicating citations',
                    'CrawlSingleCitation': 'Crawling citation',
                    'GenerateSummary': 'Generating summary',
                }
                event_info['message'] = state_messages.get(state_name, f"Running {state_name}")
            else:
                event_info['message'] = "Task started"
        
        elif event_type == 'TaskSucceeded':
            details = evt.get('taskSucceededEventDetails', {})
            state_name = find_state_name(previous_event_id)
            if state_name:
                event_info['state_name'] = state_name
                # Generate descriptive message based on state
                state_messages = {
                    'ParseKeywords': 'Keywords parsed',
                    'SearchAllProviders': 'Search completed',
                    'DeduplicateCitations': 'Deduplication completed',
                    'CrawlSingleCitation': 'Citation crawled',
                    'GenerateSummary': 'Summary generated',
                }
                event_info['message'] = state_messages.get(state_name, f"Completed {state_name}")
            else:
                event_info['message'] = "Task completed"
            try:
                output = json.loads(details.get('output', '{}'))
                if 'keywords' in output:
                    event_info['details'] = f"{len(output['keywords'])} keywords"
                elif 'deduplicated_citations' in output:
                    event_info['details'] = f"{len(output['deduplicated_citations'])} citations"
                elif 'results' in output:
                    # Search results
                    results = output.get('results', [])
                    total_citations = sum(r.get('citation_count', 0) for r in results)
                    event_info['details'] = f"{len(results)} providers, {total_citations} citations"
            except (json.JSONDecodeError, KeyError, TypeError):
                pass
        
        elif event_type == 'TaskFailed':
            details = evt.get('taskFailedEventDetails', {})
            state_name = find_state_name(previous_event_id)
            if state_name:
                event_info['state_name'] = state_name
            event_info['message'] = "Task failed"
            event_info['error'] = details.get('error', 'Unknown error')
            cause = details.get('cause', '')
            if cause:
                # Truncate long error causes
                event_info['cause'] = cause[:200] + '...' if len(cause) > 200 else cause
        
        elif event_type == 'TaskStateEntered':
            # Skip - redundant with TaskStarted which has better context
            continue
        
        elif event_type == 'TaskStateExited':
            # Important for tracking step completion
            details = evt.get('stateExitedEventDetails', {})
            state_name = details.get('name', '')
            event_info['state_name'] = state_name
            # Generate completion message
            state_messages = {
                'ParseKeywords': 'Keywords parsed successfully',
                'SearchAllProviders': 'Search completed',
                'DeduplicateCitations': 'Deduplication completed',
                'CrawlSingleCitation': 'Citation crawled',
                'GenerateSummary': 'Summary generated',
            }
            event_info['message'] = state_messages.get(state_name)
        
        elif event_type == 'MapStateStarted':
            event_info['message'] = "Processing keywords in parallel"
            event_info['state_name'] = 'ProcessKeywords'
        
        elif event_type == 'MapStateExited':
            details = evt.get('stateExitedEventDetails', {})
            state_name = details.get('name', '')
            event_info['state_name'] = state_name
            # Map state names to friendly messages
            if state_name == 'ProcessKeywords':
                event_info['message'] = "All keywords processed"
            elif state_name == 'CrawlCitations':
                event_info['message'] = "All citations crawled"
            else:
                event_info['message'] = f"Completed: {state_name}"
        
        elif event_type == 'ExecutionFailed':
            details = evt.get('executionFailedEventDetails', {})
            event_info['message'] = "Execution failed"
            event_info['error'] = details.get('error', 'Unknown error')
        
        elif event_type == 'ExecutionSucceeded':
            event_info['message'] = "Execution completed successfully"
        
        events.append(event_info)
    
    # Filter out events without messages and deduplicate by message
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
    
    return success_response({
        'execution': {
            'arn': execution['executionArn'],
            'name': execution['name'],
            'status': execution['status'],
            'start_date': execution['startDate'].isoformat(),
            'stop_date': execution.get('stopDate', '').isoformat() if execution.get('stopDate') else None,
        },
        'events': display_events[:50]  # Limit to 50 most recent events
    }, event)
