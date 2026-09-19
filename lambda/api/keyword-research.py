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
from collections.abc import Callable
from functools import wraps
from typing import Any
from urllib.parse import urlparse

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import BotoCoreError, ClientError

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.ai_clients import get_web_search_clients
from shared.api_response import api_response, not_found_response, success_response, validation_error
from shared.api_views import named_item_view
from shared.auth import get_caller_identity
from shared.constants import MAX_KEYWORD_LENGTH
from shared.decorators import api_handler, parse_json_body, route_handler, validate
from shared.env_vars import resolve_table_env
from shared.research_agent import (
    AGENT_DEFAULT_ROUNDS,
    AGENT_DEFAULT_TARGET_COUNT,
    AGENT_DEFAULT_TRACKING_COUNT,
    AGENT_INSTRUCTION_MAX_LENGTH,
    AGENT_MAX_ROUNDS,
    AGENT_MAX_TARGET_COUNT,
    AGENT_MAX_TRACKING_COUNT,
    AGENT_MIN_TARGET_COUNT,
    AGENT_MIN_TRACKING_COUNT,
    AGENT_SEED_MAX_LENGTH,
    BUILTIN_TEMPLATE_ID,
    GENERIC_TEMPLATE,
    SUBJECT_MAX_LENGTH,
    SYSTEM_PROMPT_MAX_LENGTH,
    TEMPLATE_DESCRIPTION_MAX_LENGTH,
    TEMPLATE_NAME_MAX_LENGTH,
    build_agent_config,
    builtin_template,
    builtin_templates,
    normalise_dimensions,
    validate_noun,
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
    checkpoint_terminal_result,
    job_attempt,
    public_view,
    retry_start_round,
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

def _is_conditional_failure(error: ClientError) -> bool:
    return error.response.get('Error', {}).get('Code') == 'ConditionalCheckFailedException'


def _replace_row(target: dict[str, Any], replacement: dict[str, Any]) -> None:
    target.clear()
    target.update(replacement)


def _persist_terminal_attempt(
    row: dict[str, Any],
    message: str,
    *,
    require_unowned: bool = False,
) -> bool:
    """Persist a failed/partial attempt only while its observed state still owns the row."""
    status, result = checkpoint_terminal_result(row)
    timestamp = get_timestamp()
    names = {'#s': 'status'}
    values: dict[str, Any] = {
        ':s': status,
        ':observed_status': row.get('status'),
        ':attempt': job_attempt(row),
        ':e': message[:500],
        ':ts': timestamp,
    }
    sets = ['#s = :s', 'error_message = :e', 'finished_at = :ts', 'updated_at = :ts']
    for index, (field, value) in enumerate(result.items()):
        placeholder = f':result{index}'
        values[placeholder] = value
        sets.append(f'{field} = {placeholder}')

    condition = '#s = :observed_status AND (attempt = :attempt OR attribute_not_exists(attempt))'
    values[':observed_revision'] = int(row.get('checkpoint_revision') or 0)
    if 'checkpoint_revision' in row:
        condition += ' AND checkpoint_revision = :observed_revision'
    else:
        condition += ' AND attribute_not_exists(checkpoint_revision)'
    started_at = row.get('attempt_started_at')
    if isinstance(started_at, str) and started_at:
        values[':attempt_started_at'] = started_at
        condition += ' AND attempt_started_at = :attempt_started_at'
    if require_unowned:
        condition += ' AND attribute_not_exists(execution_arn)'

    try:
        research_table.update_item(
            Key={'id': row['id']},
            UpdateExpression=f"SET {', '.join(sets)}",
            ConditionExpression=condition,
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
        )
    except ClientError as exc:
        if _is_conditional_failure(exc):
            return False
        raise

    row.update(result)
    row.update({'status': status, 'error_message': message[:500], 'finished_at': timestamp, 'updated_at': timestamp})
    return True


def _mark_research_failed(row: dict[str, Any], error: Exception) -> None:
    """Fail only the unowned attempt whose execution could not be started."""
    try:
        _persist_terminal_attempt(row, str(error), require_unowned=True)
    except Exception:
        logger.exception('Could not record failed research dispatch for %s', row.get('id'))


def _fail_if_research_timed_out(row: dict[str, Any]) -> None:
    """Conditionally expose checkpointed results when an active execution timed out."""
    for _attempt in range(3):
        if row.get('status') not in ACTIVE_STATUSES:
            return
        attempt_started = row.get('attempt_started_at') or row.get('retried_at') or row.get('created_at', '')
        elapsed = stale_elapsed_seconds(attempt_started, RESEARCH_STALE_AFTER_SECONDS)
        if elapsed is None:
            return

        message = f'Research timed out after {int(elapsed)} seconds. Retry to run the missing steps again.'
        try:
            if _persist_terminal_attempt(row, message):
                logger.info(
                    'Marked research %s attempt %s terminal after timeout (%ss)',
                    row['id'],
                    job_attempt(row),
                    int(elapsed),
                )
                return
        except Exception:
            logger.exception('Could not sweep timed-out research %s', row.get('id'))
            return

        current = research_table.get_item(Key={'id': row['id']}, ConsistentRead=True).get('Item')
        if not current:
            return
        _replace_row(row, current)


def _execution_id(execution_arn: str) -> str:
    return execution_arn.rsplit(':', 1)[-1]


def _record_execution_owner(job_id: str, attempt: int, execution_arn: str) -> None:
    """Bind a started execution without overwriting a newer/terminal attempt."""
    with contextlib.suppress(ClientError):
        research_table.update_item(
            Key={'id': job_id},
            UpdateExpression='SET execution_arn = :arn, execution_id = :execution_id, updated_at = :ts',
            ConditionExpression=(
                'attempt = :attempt AND #s IN (:pending, :running) '
                'AND (attribute_not_exists(execution_arn) OR execution_arn = :arn)'
            ),
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={
                ':attempt': attempt,
                ':pending': STATUS_PENDING,
                ':running': 'running',
                ':arn': execution_arn,
                ':execution_id': _execution_id(execution_arn),
                ':ts': get_timestamp(),
            },
        )


def _start_execution(job_id: str, attempt: int, expected_round: int) -> str:
    """Start the execution for one immutable attempt and return its ARN."""
    retry_count = attempt - 1
    name = job_id if retry_count == 0 else f'{job_id}-r{retry_count}'
    response = stepfunctions.start_execution(
        stateMachineArn=RESEARCH_STATE_MACHINE_ARN,
        name=name,
        input=json.dumps({
            'job_id': job_id,
            'retry': retry_count > 0,
            'attempt': attempt,
            'expected_round': expected_round,
        }),
    )
    return response['executionArn']


def _start_job(job: dict[str, Any], event: dict[str, Any], label: str) -> dict[str, Any]:
    """Persist attempt one, start its execution, and answer 202."""
    research_table.put_item(Item=job)
    try:
        execution_arn = _start_execution(job['id'], job_attempt(job), expected_round=1)
    except (ClientError, BotoCoreError) as exc:
        logger.exception('Could not start research execution for %s', job['id'])
        _mark_research_failed(job, exc)
        return _unavailable_response(f'Could not start {label.lower()}. Please try again.', event)

    _record_execution_owner(job['id'], job_attempt(job), execution_arn)
    return success_response({
        **public_view(job),
        'message': f"{label} started. Poll /keyword-research/{job['id']} for results.",
    }, event, 202)


def _path_id(event: dict[str, Any]) -> str | None:
    return (event.get('pathParameters') or {}).get('id')


def _with_research(route: Callable[..., dict[str, Any]]) -> Callable[..., dict[str, Any]]:
    """Load the job addressed by ``{id}``, swept for timeouts, and hand it to ``route`` as ``job``.

    Answers 400 without an id and 404 for an unknown job. Every route that
    reads a single job goes through here so they agree on those answers and
    on when the stale sweep runs.
    """
    @wraps(route)
    def wrapper(event: dict[str, Any], context: Any, *args: Any, **kwargs: Any) -> dict[str, Any]:
        job_id = _path_id(event)
        if not job_id:
            return validation_error('Research ID is required', event, 'id')

        job = research_table.get_item(Key={'id': job_id}, ConsistentRead=True).get('Item')
        if not job:
            return not_found_response(resource='Research', event=event)

        _fail_if_research_timed_out(job)
        return route(event, context, *args, job=job, **kwargs)
    return wrapper


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


class TemplateNotFoundError(Exception):
    """The ``template_id`` a request named does not exist (built-in or saved)."""


def _profile_of(item: dict[str, Any]) -> dict[str, Any]:
    """The industry profile of a template view/row; saved rows from before 2.6.0 read as the generic one."""
    fallback = GENERIC_TEMPLATE.to_view()
    dimensions = item.get('dimensions')
    return {
        'industry': item.get('industry') or fallback['industry'],
        'subject': item.get('subject') or fallback['subject'],
        'audience': item.get('audience') or fallback['audience'],
        'dimensions': [dict(dimension) for dimension in dimensions] if isinstance(dimensions, list) and dimensions else fallback['dimensions'],
    }


def _load_template(template_id: str) -> dict[str, Any]:
    """A built-in or saved template as the API shows it; raises when neither exists."""
    builtin = builtin_template(template_id)
    if builtin:
        return builtin
    item: dict[str, Any] | None = templates_table.get_item(Key={'id': template_id}).get('Item')
    if not item:
        raise TemplateNotFoundError(template_id)
    return _template_view(item)


def _resolve_template(template_id: str | None, system_prompt: str | None) -> dict[str, Any]:
    """What a run snapshots from its template: prompt (inline text wins), name and industry profile.

    ``template_id`` ``None`` means the hotel built-in, as before 2.6.0.
    """
    template = _load_template(template_id or BUILTIN_TEMPLATE_ID)
    return {
        **_profile_of(template),
        'template_id': template['id'],
        'template_name': template['name'],
        'system_prompt': system_prompt or template['system_prompt'],
    }


def _agent_brief_error(event: dict[str, Any], *, dimensions: Any, country: str, language: str) -> dict[str, Any] | None:
    """The 400 for a malformed research brief (dimension list, market codes), else ``None``."""
    if not isinstance(dimensions, list) or not dimensions:
        return validation_error('Pick at least one expansion dimension', event, 'dimensions')
    if any(not isinstance(dimension, str) for dimension in dimensions):
        return validation_error('Every expansion dimension must be a string', event, 'dimensions')
    if not _is_code(country):
        return validation_error('country must be a two-letter country code (e.g. es)', event, 'country')
    if not _is_code(language):
        return validation_error('language must be a two-letter language code (e.g. es)', event, 'language')
    return None


def _agent_options_error(
    event: dict[str, Any], body: dict, *, tracking_count: int, target_count: int, system_prompt: str | None, group_id: str | None,
) -> dict[str, Any] | None:
    """The 400 for an unusable tracking count, a blank prompt or an unknown group, else ``None``."""
    if 'tracking_count' in body and (
        body.get('tracking_count') is None or isinstance(body.get('tracking_count'), bool)
    ):
        return validation_error('tracking_count must be an integer', event, 'tracking_count')
    if 'tracking_count' in body and tracking_count > target_count:
        return validation_error('tracking_count cannot exceed target_count', event, 'tracking_count')
    if system_prompt is not None and not system_prompt.strip():
        return validation_error('system_prompt cannot be blank', event, 'system_prompt')
    if group_id and not groups_table.get_item(Key={'id': group_id}).get('Item'):
        return validation_error('Keyword group not found', event, 'group_id')
    return None


@parse_json_body
@validate({
    'seed': {'required': True, 'type': str, 'min_length': 2, 'max_length': AGENT_SEED_MAX_LENGTH, 'source': 'body'},
    'country': {'type': str, 'max_length': 2, 'default': 'us', 'source': 'body'},
    'language': {'type': str, 'max_length': 2, 'default': 'en', 'source': 'body'},
    'dimensions': {'required': True, 'type': list, 'source': 'body'},
    'instruction': {'type': str, 'max_length': AGENT_INSTRUCTION_MAX_LENGTH, 'default': '', 'source': 'body'},
    'target_count': {'type': int, 'min': AGENT_MIN_TARGET_COUNT, 'max': AGENT_MAX_TARGET_COUNT, 'default': AGENT_DEFAULT_TARGET_COUNT, 'source': 'body'},
    'tracking_count': {'type': int, 'min': AGENT_MIN_TRACKING_COUNT, 'max': AGENT_MAX_TRACKING_COUNT, 'default': AGENT_DEFAULT_TRACKING_COUNT, 'source': 'body'},
    'max_rounds': {'type': int, 'min': 1, 'max': AGENT_MAX_ROUNDS, 'default': AGENT_DEFAULT_ROUNDS, 'source': 'body'},
    'template_id': {'type': str, 'max_length': 100, 'source': 'body'},
    'system_prompt': {'type': str, 'max_length': SYSTEM_PROMPT_MAX_LENGTH, 'source': 'body'},
    'group_id': {'type': str, 'max_length': 100, 'source': 'body'},
})
def _start_agent(
    event: dict[str, Any], context: Any, body: dict, seed: str, country: str, language: str, dimensions: list,
    instruction: str, target_count: int, tracking_count: int, max_rounds: int, template_id: str | None,
    system_prompt: str | None, group_id: str | None,
) -> dict[str, Any]:
    """POST /api/keyword-research/agent — start a research-agent job.

    The template decides what the run researches: its subject and audience
    nouns, its dimension catalogue (the request's ``dimensions`` must come
    from it) and its system prompt (an inline edit wins). All of it is
    snapshotted on the job so later template edits never change what a past
    run did. ``group_id`` is the group the proposal is meant for; it is
    validated here and used by the UI's "Add to group" action.
    """
    error = _agent_brief_error(event, dimensions=dimensions, country=country, language=language) or _agent_options_error(
        event, body, tracking_count=tracking_count, target_count=target_count, system_prompt=system_prompt, group_id=group_id,
    )
    if error:
        return error

    try:
        template = _resolve_template(template_id, system_prompt)
    except TemplateNotFoundError:
        return not_found_response(resource='Template', event=event)
    allowed = [dimension['id'] for dimension in template['dimensions']]
    unknown = [dimension for dimension in dimensions if dimension not in allowed]
    if unknown:
        return validation_error(f"Unknown dimensions: {', '.join(str(d) for d in unknown)}. Must be one of: {', '.join(allowed)}", event, 'dimensions')

    if not get_web_search_clients():
        return _no_provider_response(event)

    config = build_agent_config(
        seed=seed, country=country, language=language, dimensions=dimensions, instruction=instruction,
        target_count=target_count,
        tracking_count=tracking_count if 'tracking_count' in body else None,
        max_rounds=max_rounds,
        group_id=group_id,
        subject=template['subject'], audience=template['audience'], dimension_catalog=template['dimensions'],
    )
    request: dict[str, Any] = {
        # Top-level copies the history list and the UI read directly.
        'seed_keyword': config['seed'],
        'config': config,
        'system_prompt': template['system_prompt'],
        'template_id': template['template_id'],
        'template_name': template['template_name'],
        'round': 0,
        'rounds': [],
    }
    created_by = get_caller_identity(event)
    if created_by:
        request['created_by'] = created_by
    job = build_job_item(str(uuid.uuid4()), TYPE_AGENT, request)
    return _start_job(job, event, 'Research agent')


def _template_view(item: dict[str, Any]) -> dict[str, Any]:
    return {
        **named_item_view(item),
        **_profile_of(item),
        'system_prompt': item.get('system_prompt', ''),
        'builtin': False,
        'created_by': item.get('created_by'),
        'created_at': item.get('created_at'),
        'updated_at': item.get('updated_at'),
    }


def _list_templates(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """GET /api/keyword-research/templates — the built-in industry templates first, then saved ones by name."""
    response = templates_table.scan(Limit=MAX_TEMPLATES)
    saved = sorted((_template_view(item) for item in response.get('Items', []) if item.get('id')), key=lambda item: item['name'].casefold())
    items = [*builtin_templates(), *saved]
    return success_response({'items': items, 'count': len(items)}, event)


# The industry-profile fields a template create/update may carry; cleaned by
# `_validated_profile_changes` after `@validate` has type-checked them.
TEMPLATE_PROFILE_RULES: dict[str, dict[str, Any]] = {
    'subject': {'type': str, 'max_length': SUBJECT_MAX_LENGTH, 'source': 'body'},
    'audience': {'type': str, 'max_length': SUBJECT_MAX_LENGTH, 'source': 'body'},
    'dimensions': {'type': list, 'source': 'body'},
}


def _validated_profile_changes(
    event: dict[str, Any], *, subject: str | None, audience: str | None, dimensions: Any,
) -> dict[str, Any]:
    """The profile fields a create/update request sets, cleaned — or the 400 to answer with."""
    changes: dict[str, Any] = {}
    for field, value in (('subject', subject), ('audience', audience)):
        if value is None:
            continue
        error = validate_noun(value, field)
        if error:
            return {'error': validation_error(error, event, field)}
        changes[field] = value.strip()
    if dimensions is not None:
        cleaned = normalise_dimensions(dimensions)
        if isinstance(cleaned, str):
            return {'error': validation_error(cleaned, event, 'dimensions')}
        changes['dimensions'] = cleaned
    return changes


@parse_json_body
@validate({
    'name': {'required': True, 'type': str, 'min_length': 1, 'max_length': TEMPLATE_NAME_MAX_LENGTH, 'source': 'body'},
    'system_prompt': {'required': True, 'type': str, 'min_length': 20, 'max_length': SYSTEM_PROMPT_MAX_LENGTH, 'source': 'body'},
    'description': {'type': str, 'max_length': TEMPLATE_DESCRIPTION_MAX_LENGTH, 'default': '', 'source': 'body'},
    'base_template_id': {'type': str, 'max_length': 100, 'source': 'body'},
    **TEMPLATE_PROFILE_RULES,
})
def _create_template(
    event: dict[str, Any], context: Any, body: dict, name: str, system_prompt: str, description: str,
    base_template_id: str | None, subject: str | None, audience: str | None, dimensions: list | None,
) -> dict[str, Any]:
    """POST /api/keyword-research/templates — save an industry template.

    Profile fields the request leaves out (industry, subject, audience,
    dimensions) come from ``base_template_id`` — the template the user copied
    — else from the generic built-in. ``industry`` is never free text.
    """
    if templates_table.scan(Select='COUNT').get('Count', 0) >= MAX_TEMPLATES:
        return validation_error(f'Maximum of {MAX_TEMPLATES} templates allowed', event)
    try:
        base = _profile_of(_load_template(base_template_id)) if base_template_id else GENERIC_TEMPLATE.to_view()
    except TemplateNotFoundError:
        return not_found_response(resource='Template', event=event)
    changes = _validated_profile_changes(event, subject=subject, audience=audience, dimensions=dimensions)
    if 'error' in changes:
        return changes['error']
    timestamp = get_timestamp()
    item: dict[str, Any] = {
        'id': str(uuid.uuid4()),
        'name': name,
        'description': description,
        'system_prompt': system_prompt,
        'industry': base['industry'],
        'subject': changes.get('subject', base['subject']),
        'audience': changes.get('audience', base['audience']),
        'dimensions': changes.get('dimensions', [dict(dimension) for dimension in base['dimensions']]),
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
    **TEMPLATE_PROFILE_RULES,
})
def _update_template(
    event: dict[str, Any], context: Any, body: dict, name: str | None, system_prompt: str | None, description: str | None,
    subject: str | None, audience: str | None, dimensions: list | None,
) -> dict[str, Any]:
    """PUT /api/keyword-research/templates/{id} — edit a saved template (built-ins are read-only)."""
    template_id = _path_id(event)
    if not template_id:
        return validation_error('Template ID is required', event, 'id')
    if builtin_template(template_id):
        return validation_error('Built-in templates cannot be edited; save a copy instead', event, 'id')
    if not templates_table.get_item(Key={'id': template_id}).get('Item'):
        return not_found_response(resource='Template', event=event)

    changes: dict[str, Any] = {'name': name, 'system_prompt': system_prompt, 'description': description}
    changes = {key: value for key, value in changes.items() if value is not None}
    profile = _validated_profile_changes(event, subject=subject, audience=audience, dimensions=dimensions)
    if 'error' in profile:
        return profile['error']
    changes.update(profile)
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
    if builtin_template(template_id):
        return validation_error('Built-in templates cannot be deleted', event, 'id')
    templates_table.delete_item(Key={'id': template_id})
    return success_response({'message': 'Template deleted successfully'}, event)


@_with_research
def _retry_research(event: dict[str, Any], context: Any, job: dict[str, Any]) -> dict[str, Any]:
    """POST /api/keyword-research/{id}/retry — atomically claim one new attempt."""
    if job.get('status') not in (STATUS_FAILED, STATUS_PARTIAL):
        return validation_error('Only failed or partial research can be retried', event, 'status')
    if not get_web_search_clients():
        return _no_provider_response(event)

    job_id = job['id']
    observed_status = job['status']
    observed_attempt = job_attempt(job)
    observed_retry_count = int(job.get('retry_count') or 0)
    next_attempt = observed_attempt + 1
    next_retry_count = observed_retry_count + 1
    expected_round = retry_start_round(job)
    timestamp = get_timestamp()
    try:
        claim = research_table.update_item(
            Key={'id': job_id},
            UpdateExpression=(
                'SET #s = :pending, attempt = :next_attempt, retry_count = :next_retry_count, '
                'attempt_started_at = :ts, retried_at = :ts, updated_at = :ts '
                'REMOVE error_message, finished_at, execution_arn, execution_id, active_round'
            ),
            ConditionExpression=(
                '#s = :observed_status '
                'AND (attempt = :observed_attempt OR attribute_not_exists(attempt)) '
                'AND (retry_count = :observed_retry_count OR attribute_not_exists(retry_count))'
            ),
            ExpressionAttributeNames={'#s': 'status'},
            ExpressionAttributeValues={
                ':pending': STATUS_PENDING,
                ':observed_status': observed_status,
                ':observed_attempt': observed_attempt,
                ':observed_retry_count': observed_retry_count,
                ':next_attempt': next_attempt,
                ':next_retry_count': next_retry_count,
                ':ts': timestamp,
            },
            ReturnValues='ALL_NEW',
        )
    except ClientError as exc:
        if _is_conditional_failure(exc):
            return validation_error('This research was already retried or changed. Refresh and try again.', event, 'status')
        raise

    attributes = claim.get('Attributes') if isinstance(claim, dict) else None
    claimed = attributes if isinstance(attributes, dict) else {
        **job,
        'status': STATUS_PENDING,
        'attempt': next_attempt,
        'retry_count': next_retry_count,
        'attempt_started_at': timestamp,
        'retried_at': timestamp,
        'updated_at': timestamp,
    }
    for field in ('error_message', 'finished_at', 'execution_arn', 'execution_id', 'active_round'):
        claimed.pop(field, None)

    try:
        execution_arn = _start_execution(job_id, next_attempt, expected_round)
    except (ClientError, BotoCoreError) as exc:
        logger.exception('Could not start retry execution for %s attempt %s', job_id, next_attempt)
        _mark_research_failed(claimed, exc)
        return _unavailable_response('Could not retry the research. Please try again.', event)

    _record_execution_owner(job_id, next_attempt, execution_arn)
    return success_response({
        'id': job_id,
        'status': STATUS_PENDING,
        'attempt': next_attempt,
        'retry_count': next_retry_count,
        'message': f'Retry started. Poll /keyword-research/{job_id} for results.',
    }, event, 202)


@_with_research
def _get_research(event: dict[str, Any], context: Any, job: dict[str, Any]) -> dict[str, Any]:
    """GET /api/keyword-research/{id} — the job with its steps and merged results.

    While the job runs, the merged result covers the steps completed so far,
    so the UI can show partial results before the last provider answers.
    """
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
    """Route handler for API Gateway requests; routes handle everything, this body is never reached."""
    ...
