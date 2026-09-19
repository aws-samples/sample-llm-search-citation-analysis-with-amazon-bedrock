"""
Keyword Research API Lambda

Starts, reads, retries and deletes keyword research jobs (seed-keyword
expansion, competitor URL analysis and the research agent), and manages the
agent's system-prompt templates. The work itself runs in the
``CitationAnalysis-KeywordResearch`` Step Functions state machine
(``lambda/research-worker``): one execution per job, one parallel step per
configured web-search provider (or per model-planned query for the agent),
each step checkpointed the moment it finishes. This Lambda only ever does
DynamoDB reads/writes and ``StartExecution`` calls, so it fits inside API
Gateway's 29s ceiling and no longer needs to invoke itself in the background.

Routes:
    POST   /api/keyword-research/expand         start an expansion job (202)
    POST   /api/keyword-research/competitor     start a competitor job (202)
    POST   /api/keyword-research/agent          start a research-agent job (202)
    GET    /api/keyword-research/templates      built-in + saved agent templates
    POST   /api/keyword-research/templates      save a template (201)
    PUT    /api/keyword-research/templates/{id} edit a saved template
    DELETE /api/keyword-research/templates/{id}
    POST   /api/keyword-research/{id}/retry     re-run the failed steps (202)
    GET    /api/keyword-research/{id}           job, steps, merged (partial) results
    GET    /api/keyword-research/history        recent jobs, newest first
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
from shared.api_response import api_response, not_found_response, success_response, validation_error
from shared.auth import get_caller_identity
from shared.constants import MAX_KEYWORD_LENGTH
from shared.decorators import api_handler, parse_json_body, route_handler, validate
from shared.env_vars import resolve_table_env
from shared.research_agent import (
    AGENT_DEFAULT_ROUNDS,
    AGENT_DEFAULT_TARGET_COUNT,
    AGENT_DIMENSIONS,
    AGENT_INSTRUCTION_MAX_LENGTH,
    AGENT_MAX_ROUNDS,
    AGENT_MAX_TARGET_COUNT,
    AGENT_MIN_TARGET_COUNT,
    AGENT_SEED_MAX_LENGTH,
    BUILTIN_TEMPLATE_ID,
    DEFAULT_SYSTEM_PROMPT,
    SYSTEM_PROMPT_MAX_LENGTH,
    TEMPLATE_DESCRIPTION_MAX_LENGTH,
    TEMPLATE_NAME_MAX_LENGTH,
    build_agent_config,
    builtin_template,
)
from shared.research_jobs import (
    ACTIVE_STATUSES,
    JOB_TYPES,
    RESEARCH_STALE_AFTER_SECONDS,
    STATUS_FAILED,
    STATUS_PARTIAL,
    STATUS_PENDING,
    TYPE_AGENT,
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
RESEARCH_TEMPLATES_TABLE = resolve_table_env('DYNAMODB_TABLE_RESEARCH_TEMPLATES')
KEYWORD_GROUPS_TABLE = resolve_table_env('DYNAMODB_TABLE_KEYWORD_GROUPS')

# GSI (type, created_at) — history is a Query, newest first, never a Scan.
HISTORY_INDEX = 'TypeCreatedIndex'

# Saved templates are few (one per team/hotel style); a bounded scan is the
# whole table.
MAX_TEMPLATES = 50

research_table = dynamodb.Table(KEYWORD_RESEARCH_TABLE)
templates_table = dynamodb.Table(RESEARCH_TEMPLATES_TABLE)
groups_table = dynamodb.Table(KEYWORD_GROUPS_TABLE)


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
        return _unavailable_response(f'Could not start {label.lower()}. Please try again.', event)

    return success_response({
        **public_view(job),
        'message': f"{label} started. Poll /keyword-research/{job['id']} for results.",
    }, event, 202)


def _path_id(event: dict[str, Any]) -> str | None:
    return (event.get('pathParameters') or {}).get('id')


def _load_research(event: dict[str, Any]) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """The job addressed by ``{id}``, swept for timeouts; returns ``(job, error_response)``.

    ``(None, 400)`` without an id, ``(None, 404)`` for an unknown job. Every
    route that reads a single job goes through here so they agree on those
    answers and on when the stale sweep runs.
    """
    job_id = _path_id(event)
    if not job_id:
        return None, validation_error('Research ID is required', event, 'id')

    job = research_table.get_item(Key={'id': job_id}).get('Item')
    if not job:
        return None, not_found_response(resource='Research', event=event)

    _fail_if_research_timed_out(job)
    return job, None


def _no_provider_response(event: dict[str, Any]) -> dict[str, Any]:
    """400 with the actual reason.

    ``error_response`` sanitizes *exceptions* by type and answers "An
    unexpected error occurred" for a plain string, so this message never
    reached the UI before 2.5.0.
    """
    return validation_error('No API keys configured. Add a Perplexity, OpenAI or Gemini key under Settings > Providers.', event)


def _unavailable_response(message: str, event: dict[str, Any]) -> dict[str, Any]:
    """503 that keeps its message (see ``_no_provider_response``)."""
    return api_response(503, {'error': message}, event)


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
        return _no_provider_response(event)

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
        return _no_provider_response(event)

    domain = urlparse(competitor_url).netloc.replace('www.', '')
    job = build_job_item(
        str(uuid.uuid4()),
        TYPE_COMPETITOR,
        {'url': competitor_url, 'domain': domain},
    )
    return _start_job(job, event, 'Competitor analysis')


# =============================================================================
# Research agent
# =============================================================================

def _is_code(value: str) -> bool:
    """ISO-style two-letter country / language code."""
    return len(value) == 2 and value.isalpha() and value.isascii()


def _resolve_system_prompt(template_id: str | None, system_prompt: str | None) -> tuple[str, str | None, str | None]:
    """The prompt snapshot for a job: inline text wins, then the chosen template, then the default.

    Returns ``(system_prompt, template_id, template_name)``; ``None`` for the
    name when the template no longer exists (the prompt text is still used).
    """
    if template_id is None or template_id == BUILTIN_TEMPLATE_ID:
        builtin = builtin_template()
        prompt = system_prompt or builtin['system_prompt']
        return prompt, BUILTIN_TEMPLATE_ID, builtin['name']
    item = templates_table.get_item(Key={'id': template_id}).get('Item')
    if not item:
        return system_prompt or DEFAULT_SYSTEM_PROMPT, template_id, None
    return system_prompt or item.get('system_prompt') or DEFAULT_SYSTEM_PROMPT, template_id, item.get('name')


@parse_json_body
@validate({
    'seed': {'required': True, 'type': str, 'min_length': 2, 'max_length': AGENT_SEED_MAX_LENGTH, 'source': 'body'},
    'country': {'type': str, 'max_length': 2, 'default': 'us', 'source': 'body'},
    'language': {'type': str, 'max_length': 2, 'default': 'en', 'source': 'body'},
    'dimensions': {'required': True, 'type': list, 'source': 'body'},
    'instruction': {'type': str, 'max_length': AGENT_INSTRUCTION_MAX_LENGTH, 'default': '', 'source': 'body'},
    'target_count': {'type': int, 'min': AGENT_MIN_TARGET_COUNT, 'max': AGENT_MAX_TARGET_COUNT, 'default': AGENT_DEFAULT_TARGET_COUNT, 'source': 'body'},
    'max_rounds': {'type': int, 'min': 1, 'max': AGENT_MAX_ROUNDS, 'default': AGENT_DEFAULT_ROUNDS, 'source': 'body'},
    'template_id': {'type': str, 'max_length': 100, 'source': 'body'},
    'system_prompt': {'type': str, 'max_length': SYSTEM_PROMPT_MAX_LENGTH, 'source': 'body'},
    'group_id': {'type': str, 'max_length': 100, 'source': 'body'},
})
def _start_agent(
    event: dict[str, Any], context: Any, body: dict, seed: str, country: str, language: str, dimensions: list,
    instruction: str, target_count: int, max_rounds: int, template_id: str | None, system_prompt: str | None, group_id: str | None,
) -> dict[str, Any]:
    """POST /api/keyword-research/agent — start a research-agent job.

    The system prompt is snapshotted on the job (inline edit, else the chosen
    template, else the built-in default) so later template edits never change
    what a past run did. ``group_id`` is the group the proposal is meant for;
    it is validated here and used by the UI's "Add to group" action.
    """
    if not isinstance(dimensions, list) or not dimensions:
        return validation_error('Pick at least one expansion dimension', event, 'dimensions')
    unknown = [dimension for dimension in dimensions if dimension not in AGENT_DIMENSIONS]
    if unknown:
        return validation_error(f"Unknown dimensions: {', '.join(str(d) for d in unknown)}. Must be one of: {', '.join(AGENT_DIMENSIONS)}", event, 'dimensions')
    if not _is_code(country):
        return validation_error('country must be a two-letter country code (e.g. es)', event, 'country')
    if not _is_code(language):
        return validation_error('language must be a two-letter language code (e.g. es)', event, 'language')
    if system_prompt is not None and not system_prompt.strip():
        return validation_error('system_prompt cannot be blank', event, 'system_prompt')
    if group_id and not groups_table.get_item(Key={'id': group_id}).get('Item'):
        return validation_error('Keyword group not found', event, 'group_id')

    if not get_web_search_clients():
        return _no_provider_response(event)

    prompt, resolved_template_id, template_name = _resolve_system_prompt(template_id, system_prompt)
    config = build_agent_config(
        seed=seed, country=country, language=language, dimensions=dimensions, instruction=instruction,
        target_count=target_count, max_rounds=max_rounds, group_id=group_id,
    )
    request: dict[str, Any] = {
        # Top-level copies the history list and the UI read directly.
        'seed_keyword': config['seed'],
        'config': config,
        'system_prompt': prompt,
        'template_id': resolved_template_id,
        'round': 0,
        'rounds': [],
    }
    if template_name:
        request['template_name'] = template_name
    created_by = get_caller_identity(event)
    if created_by:
        request['created_by'] = created_by
    job = build_job_item(str(uuid.uuid4()), TYPE_AGENT, request)
    return _start_job(job, event, 'Research agent')


def _template_view(item: dict[str, Any]) -> dict[str, Any]:
    return {
        'id': item['id'],
        'name': item.get('name', ''),
        'description': item.get('description', ''),
        'system_prompt': item.get('system_prompt', ''),
        'builtin': False,
        'created_by': item.get('created_by'),
        'created_at': item.get('created_at'),
        'updated_at': item.get('updated_at'),
    }


def _list_templates(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """GET /api/keyword-research/templates — the built-in template first, then saved ones by name."""
    response = templates_table.scan(Limit=MAX_TEMPLATES)
    saved = sorted((_template_view(item) for item in response.get('Items', []) if item.get('id')), key=lambda item: item['name'].casefold())
    items = [builtin_template(), *saved]
    return success_response({'items': items, 'count': len(items)}, event)


@parse_json_body
@validate({
    'name': {'required': True, 'type': str, 'min_length': 1, 'max_length': TEMPLATE_NAME_MAX_LENGTH, 'source': 'body'},
    'system_prompt': {'required': True, 'type': str, 'min_length': 20, 'max_length': SYSTEM_PROMPT_MAX_LENGTH, 'source': 'body'},
    'description': {'type': str, 'max_length': TEMPLATE_DESCRIPTION_MAX_LENGTH, 'default': '', 'source': 'body'},
})
def _create_template(event: dict[str, Any], context: Any, body: dict, name: str, system_prompt: str, description: str) -> dict[str, Any]:
    """POST /api/keyword-research/templates — save an agent system prompt as a template."""
    if templates_table.scan(Select='COUNT').get('Count', 0) >= MAX_TEMPLATES:
        return validation_error(f'Maximum of {MAX_TEMPLATES} templates allowed', event)
    timestamp = get_timestamp()
    item: dict[str, Any] = {
        'id': str(uuid.uuid4()),
        'name': name,
        'description': description,
        'system_prompt': system_prompt,
        'created_at': timestamp,
        'updated_at': timestamp,
    }
    created_by = get_caller_identity(event)
    if created_by:
        item['created_by'] = created_by
    templates_table.put_item(Item=item)
    return success_response(_template_view(item), event, 201)


@parse_json_body
@validate({
    'name': {'type': str, 'min_length': 1, 'max_length': TEMPLATE_NAME_MAX_LENGTH, 'source': 'body'},
    'system_prompt': {'type': str, 'min_length': 20, 'max_length': SYSTEM_PROMPT_MAX_LENGTH, 'source': 'body'},
    'description': {'type': str, 'max_length': TEMPLATE_DESCRIPTION_MAX_LENGTH, 'source': 'body'},
})
def _update_template(event: dict[str, Any], context: Any, body: dict, name: str | None, system_prompt: str | None, description: str | None) -> dict[str, Any]:
    """PUT /api/keyword-research/templates/{id} — edit a saved template (the built-in one is read-only)."""
    template_id = _path_id(event)
    if not template_id:
        return validation_error('Template ID is required', event, 'id')
    if template_id == BUILTIN_TEMPLATE_ID:
        return validation_error('The built-in template cannot be edited; save a copy instead', event, 'id')
    if not templates_table.get_item(Key={'id': template_id}).get('Item'):
        return not_found_response(resource='Template', event=event)

    changes = {'name': name, 'system_prompt': system_prompt, 'description': description}
    changes = {key: value for key, value in changes.items() if value is not None}
    if not changes:
        return validation_error('Nothing to update', event)

    names = {'#n': 'name'}
    values: dict[str, Any] = {':ts': get_timestamp()}
    sets = ['updated_at = :ts']
    for index, (field, value) in enumerate(changes.items()):
        alias = '#n' if field == 'name' else field
        values[f':v{index}'] = value
        sets.append(f'{alias} = :v{index}')
    response = templates_table.update_item(
        Key={'id': template_id},
        UpdateExpression=f"SET {', '.join(sets)}",
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
        ReturnValues='ALL_NEW',
    )
    return success_response(_template_view(response['Attributes']), event)


def _delete_template(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """DELETE /api/keyword-research/templates/{id}"""
    template_id = _path_id(event)
    if not template_id:
        return validation_error('Template ID is required', event, 'id')
    if template_id == BUILTIN_TEMPLATE_ID:
        return validation_error('The built-in template cannot be deleted', event, 'id')
    templates_table.delete_item(Key={'id': template_id})
    return success_response({'message': 'Template deleted successfully'}, event)


def _retry_research(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """POST /api/keyword-research/{id}/retry — re-run only the steps that did not complete.

    Completed steps keep their results; the new execution plans the rest.
    Only ``failed`` and ``partial`` jobs (including a stale job the sweep just
    failed) can be retried — a running job is already doing the work.
    """
    job, error = _load_research(event)
    if error:
        return error
    if job.get('status') not in (STATUS_FAILED, STATUS_PARTIAL):
        return validation_error('Only failed or partial research can be retried', event, 'status')

    if not get_web_search_clients():
        return _no_provider_response(event)

    job_id = job['id']
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
        return _unavailable_response('Could not retry the research. Please try again.', event)

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
    job, error = _load_research(event)
    if error:
        return error
    return success_response(public_view(job), event)


def _query_history(job_type: str | None, limit: int) -> list[dict[str, Any]]:
    """Newest jobs per type from the GSI; every type when no filter is given."""
    types = [job_type] if job_type else list(JOB_TYPES)
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
    'type': {'type': str, 'choices': list(JOB_TYPES)},
    'limit': {'type': int, 'min': 1, 'max': 100, 'default': 20}
})
def _get_history(event: dict[str, Any], context: Any, type: str | None = None, limit: int = 20) -> dict[str, Any]:
    """GET /api/keyword-research/history — recent jobs, newest first.

    Agent rows drop the system-prompt snapshot here (up to 6 KB each); the
    detail route still returns it.
    """
    items = _query_history(type, limit)
    for item in items:
        _fail_if_research_timed_out(item)

    views = [public_view(item) for item in items]
    for view in views:
        view.pop('system_prompt', None)
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
    ('POST', '/agent'): _start_agent,
    ('GET', '/templates'): _list_templates,
    ('POST', '/templates'): _create_template,
    ('PUT', '/templates'): _update_template,
    ('DELETE', '/templates'): _delete_template,
    ('POST', '/retry'): _retry_research,
    ('GET', '/history'): _get_history,
    ('GET', None): _get_research,
    ('DELETE', None): _delete_research,
})
def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Route handler for API Gateway requests."""
    pass  # Routes handle everything
