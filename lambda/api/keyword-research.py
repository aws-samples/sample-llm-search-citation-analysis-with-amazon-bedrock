"""
Keyword Research API Lambda

Starts, reads, retries and deletes keyword research jobs (seed-keyword
expansion and competitor URL analysis). The work itself runs in the
``CitationAnalysis-KeywordResearch`` Step Functions state machine
(``lambda/research-worker``): one execution per job, one parallel step per
configured web-search provider, each step checkpointed the moment it
finishes. This Lambda only ever does DynamoDB reads/writes and
``StartExecution`` calls, so it fits inside API Gateway's 29s ceiling and no
longer needs to invoke itself in the background.

Routes:
    POST   /api/keyword-research/expand        start an expansion job (202)
    POST   /api/keyword-research/competitor    start a competitor job (202)
    POST   /api/keyword-research/{id}/retry    re-run the failed steps (202)
    GET    /api/keyword-research/{id}          job, steps, merged (partial) results
    GET    /api/keyword-research/history       recent jobs, newest first
    DELETE /api/keyword-research/{id}
"""

import contextlib
import json
import logging
import os
import sys
import uuid
from typing import Any
from urllib.parse import urlparse

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import BotoCoreError, ClientError

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.ai_clients import get_web_search_clients
from shared.api_response import error_response, not_found_response, success_response, validation_error
from shared.constants import MAX_KEYWORD_LENGTH
from shared.decorators import api_handler, parse_json_body, route_handler, validate
from shared.research_jobs import (
    ACTIVE_STATUSES,
    RESEARCH_STALE_AFTER_SECONDS,
    STATUS_FAILED,
    STATUS_PARTIAL,
    STATUS_PENDING,
    TYPE_COMPETITOR,
    TYPE_EXPANSION,
    build_job_item,
    public_view,
)
from shared.stale_jobs import stale_elapsed_seconds
from shared.url_validator import validate_url_safe
from shared.utils import get_timestamp

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')
stepfunctions = boto3.client('stepfunctions')

# Fail-fast: Required environment variables
KEYWORD_RESEARCH_TABLE = os.environ['KEYWORD_RESEARCH_TABLE']
RESEARCH_STATE_MACHINE_ARN = os.environ['RESEARCH_STATE_MACHINE_ARN']

# GSI (type, created_at) — history is a Query, newest first, never a Scan.
HISTORY_INDEX = 'TypeCreatedIndex'

research_table = dynamodb.Table(KEYWORD_RESEARCH_TABLE)


# =============================================================================
# Job bookkeeping
# =============================================================================

def _mark_research_failed(research_id: str, error: Exception) -> None:
    """Record a job that could not be started; never let the bookkeeping write mask the error."""
    with contextlib.suppress(Exception):
        research_table.update_item(
            Key={'id': research_id},
            UpdateExpression='SET #s = :s, error_message = :e, updated_at = :ts',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={':s': STATUS_FAILED, ':e': str(error)[:500], ':ts': get_timestamp()},
        )


def _fail_if_research_timed_out(row: dict[str, Any]) -> None:
    """Mark a non-terminal job failed once it has outlived the state machine.

    The worker records every step outcome and ``Finalize`` records the job's,
    so in normal operation nothing is ever left at ``pending``/``running``.
    The one thing that leaves no trace in Python is the execution itself
    dying — the state machine's 30-minute timeout, or an execution that never
    started. This reader-side sweep is the safety net for that case only;
    the threshold sits above the state machine timeout so a live job can
    never be marked failed and then flip back.

    The clock starts at the current attempt (``retried_at`` for a retry),
    not at ``created_at``, or every retry of an old job would be swept at
    once. Mutates ``row`` in place so the response that triggers the sweep
    reports the corrected status.
    """
    if row.get('status') not in ACTIVE_STATUSES:
        return

    attempt_started = row.get('retried_at') or row.get('created_at', '')
    elapsed = stale_elapsed_seconds(attempt_started, RESEARCH_STALE_AFTER_SECONDS)
    if elapsed is None:
        return

    message = f'Research timed out after {int(elapsed)} seconds. Retry to run the missing steps again.'
    with contextlib.suppress(Exception):
        research_table.update_item(
            Key={'id': row['id']},
            UpdateExpression='SET #s = :s, error_message = :e, updated_at = :ts',
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={':s': STATUS_FAILED, ':e': message, ':ts': get_timestamp()},
        )
    row['status'] = STATUS_FAILED
    row['error_message'] = message
    logger.info(f"Marked research {row['id']} as failed due to timeout ({int(elapsed)}s)")


def _start_execution(job_id: str, attempt: int) -> str:
    """Start one state machine execution for the job; returns the execution ARN.

    Execution names must be unique per state machine, so retries get a
    suffix. The input always carries ``retry`` because the Plan state reads
    it with a JSONPath and a missing key would raise ``States.Runtime``.
    """
    name = job_id if attempt == 0 else f'{job_id}-r{attempt}'
    response = stepfunctions.start_execution(
        stateMachineArn=RESEARCH_STATE_MACHINE_ARN,
        name=name,
        input=json.dumps({'job_id': job_id, 'retry': attempt > 0}),
    )
    return response['executionArn']


def _start_job(job: dict[str, Any], event: dict[str, Any], label: str) -> dict[str, Any]:
    """Persist the pending row, start its execution, answer 202."""
    research_table.put_item(Item=job)
    try:
        _start_execution(job['id'], attempt=0)
    except (ClientError, BotoCoreError) as exc:
        # Running the work here instead would outlive API Gateway's 29s
        # timeout. Fail fast and mark the row terminal so it does not sit at
        # `pending` forever.
        logger.error(f"Could not start research execution for {job['id']}: {exc}")
        _mark_research_failed(job['id'], exc)
        return error_response(f'Could not start {label.lower()}. Please try again.', event, 503)

    return success_response({
        **public_view(job),
        'message': f"{label} started. Poll /keyword-research/{job['id']} for results.",
    }, event, 202)


def _path_id(event: dict[str, Any]) -> str | None:
    return (event.get('pathParameters') or {}).get('id')


# =============================================================================
# Routes
# =============================================================================

@parse_json_body
@validate({
    'seed_keyword': {'required': True, 'type': str, 'max_length': MAX_KEYWORD_LENGTH, 'source': 'body'},
    'industry': {'type': str, 'max_length': 100, 'default': 'general', 'source': 'body'},
    'count': {'type': int, 'min': 1, 'max': 50, 'default': 20, 'source': 'body'}
})
def _expand_keywords(event: dict[str, Any], context: Any, body: dict, seed_keyword: str, industry: str, count: int) -> dict[str, Any]:
    """POST /api/keyword-research/expand — start an expansion job.

    ``count`` is the number of keywords asked of *each* provider; the merged
    result deduplicates across providers and can be larger.
    """
    if not get_web_search_clients():
        return error_response("No API keys configured.", event, 400)

    job = build_job_item(
        str(uuid.uuid4()),
        TYPE_EXPANSION,
        {'seed_keyword': seed_keyword, 'industry': industry, 'count': count},
    )
    return _start_job(job, event, 'Keyword expansion')


@parse_json_body
@validate({
    'url': {'required': True, 'type': str, 'max_length': 2048, 'source': 'body'}
})
def _analyze_competitor(event: dict[str, Any], context: Any, body: dict, url: str) -> dict[str, Any]:
    """POST /api/keyword-research/competitor — start a competitor analysis job."""
    competitor_url = url.strip()
    if not competitor_url.startswith(('http://', 'https://')):
        competitor_url = 'https://' + competitor_url

    is_safe, ssrf_error = validate_url_safe(competitor_url)
    if not is_safe:
        return validation_error(ssrf_error, event)

    if not get_web_search_clients():
        return error_response("No API keys configured.", event, 400)

    domain = urlparse(competitor_url).netloc.replace('www.', '')
    job = build_job_item(
        str(uuid.uuid4()),
        TYPE_COMPETITOR,
        {'url': competitor_url, 'domain': domain},
    )
    return _start_job(job, event, 'Competitor analysis')


def _retry_research(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """POST /api/keyword-research/{id}/retry — re-run only the steps that did not complete.

    Completed steps keep their results; the new execution plans the rest.
    Only ``failed`` and ``partial`` jobs (including a stale job the sweep just
    failed) can be retried — a running job is already doing the work.
    """
    job_id = _path_id(event)
    if not job_id:
        return validation_error('Research ID is required', event, 'id')

    job = research_table.get_item(Key={'id': job_id}).get('Item')
    if not job:
        return not_found_response(resource='Research', event=event)

    _fail_if_research_timed_out(job)
    if job.get('status') not in (STATUS_FAILED, STATUS_PARTIAL):
        return validation_error('Only failed or partial research can be retried', event, 'status')

    if not get_web_search_clients():
        return error_response("No API keys configured.", event, 400)

    attempt = int(job.get('retry_count') or 0) + 1
    timestamp = get_timestamp()
    research_table.update_item(
        Key={'id': job_id},
        UpdateExpression='SET #s = :s, retry_count = :n, retried_at = :ts, updated_at = :ts REMOVE error_message, finished_at',
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={':s': STATUS_PENDING, ':n': attempt, ':ts': timestamp},
    )
    try:
        _start_execution(job_id, attempt)
    except (ClientError, BotoCoreError) as exc:
        logger.error(f"Could not start retry execution for {job_id}: {exc}")
        _mark_research_failed(job_id, exc)
        return error_response('Could not retry the research. Please try again.', event, 503)

    return success_response({
        'id': job_id,
        'status': STATUS_PENDING,
        'retry_count': attempt,
        'message': f'Retry started. Poll /keyword-research/{job_id} for results.',
    }, event, 202)


def _get_research(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """GET /api/keyword-research/{id} — the job with its steps and merged results.

    While the job runs, the merged result covers the steps completed so far,
    so the UI can show partial results before the last provider answers.
    """
    job_id = _path_id(event)
    if not job_id:
        return validation_error('Research ID is required', event, 'id')

    job = research_table.get_item(Key={'id': job_id}).get('Item')
    if not job:
        return not_found_response(resource='Research', event=event)

    _fail_if_research_timed_out(job)
    return success_response(public_view(job), event)


def _query_history(job_type: str | None, limit: int) -> list[dict[str, Any]]:
    """Newest jobs per type from the GSI; both types when no filter is given."""
    types = [job_type] if job_type else [TYPE_EXPANSION, TYPE_COMPETITOR]
    items: list[dict[str, Any]] = []
    for each in types:
        response = research_table.query(
            IndexName=HISTORY_INDEX,
            KeyConditionExpression=Key('type').eq(each),
            ScanIndexForward=False,
            Limit=limit,
        )
        items.extend(response.get('Items', []))
    items.sort(key=lambda item: item.get('created_at', ''), reverse=True)
    return items[:limit]


@validate({
    'type': {'type': str, 'choices': [TYPE_EXPANSION, TYPE_COMPETITOR]},
    'limit': {'type': int, 'min': 1, 'max': 100, 'default': 20}
})
def _get_history(event: dict[str, Any], context: Any, type: str | None = None, limit: int = 20) -> dict[str, Any]:
    """GET /api/keyword-research/history — recent jobs, newest first."""
    items = _query_history(type, limit)
    for item in items:
        _fail_if_research_timed_out(item)

    views = [public_view(item) for item in items]
    return success_response({'items': views, 'count': len(views)}, event)


def _delete_research(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """DELETE /api/keyword-research/{id} — delete a research result."""
    research_id = _path_id(event)
    if not research_id:
        return validation_error('Research ID is required', event, 'id')

    research_table.delete_item(Key={'id': research_id})
    return success_response({'message': 'Research deleted successfully'}, event)


@api_handler
@route_handler({
    ('POST', '/expand'): _expand_keywords,
    ('POST', '/competitor'): _analyze_competitor,
    ('POST', '/retry'): _retry_research,
    ('GET', '/history'): _get_history,
    ('GET', None): _get_research,
    ('DELETE', None): _delete_research,
})
def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Route handler for API Gateway requests."""
    pass  # Routes handle everything
