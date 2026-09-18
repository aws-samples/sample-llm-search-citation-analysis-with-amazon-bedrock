"""
Manage Schedule API Lambda

Schedules are EventBridge Scheduler schedules in the ``citation-analysis-schedules``
group; there is no other store. Since 2.3.0 a schedule is identified by a
generated, immutable ``Name`` (``sch-<8 hex>``) while the user-facing name
lives in ``Description``, and ``Target.Input`` carries the whole editable
definition as a *v2 descriptor*::

    {
      "schedule_id": "sch-1a2b3c4d",
      "display_name": "Hotel Coruña — weekly",
      "form": {"frequency": "weekly", "time": "09:00", "timezone": "Europe/Madrid",
               "day_of_week": "MON", "day_of_month": 1},
      "scope": {"mode": "all"} | {"mode": "groups", "group_ids": [...]} | {"mode": "keywords", "keyword_ids": [...]}
    }

ParseKeywords resolves ``scope`` at run time, so a schedule that targets a
keyword group runs whatever keywords are in the group when it fires. Schedules
created before 2.3.0 (``{"source": "dynamodb"}`` or ``{"keywords": [...]}``
inputs) are listed as ``legacy``; saving one rewrites it as v2 under the same
``Name``.

Routes (mutations are Admin-only):
    GET    /api/schedules              list
    POST   /api/schedules              create
    GET    /api/schedules/{id}
    PUT    /api/schedules/{id}         full update (name, form, scope, enabled)
    DELETE /api/schedules/{id}
    POST   /api/schedules/{id}/run     start an analysis now with the schedule's scope
"""

import json
import logging
import os
import re
import secrets
import sys
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import boto3

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import api_response, not_found_response, success_response, validation_error
from shared.auth import ADMIN_GROUP, require_group
from shared.decorators import api_handler, parse_json_body, route_handler
from shared.keyword_groups import describe_scope, load_existing_group_ids, validate_scope
from shared.utils import get_timestamp_compact

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

scheduler = boto3.client('scheduler')
stepfunctions = boto3.client('stepfunctions')
dynamodb = boto3.resource('dynamodb')

STATE_MACHINE_ARN = os.environ['STATE_MACHINE_ARN']
SCHEDULE_ROLE_ARN = os.environ['SCHEDULE_ROLE_ARN']
KEYWORD_GROUPS_TABLE = os.environ.get('DYNAMODB_TABLE_KEYWORD_GROUPS', 'CitationAnalysis-KeywordGroups')
SCHEDULE_GROUP = 'citation-analysis-schedules'

SCHEDULE_ID_PREFIX = 'sch-'
FREQUENCIES = ('daily', 'weekly', 'monthly')
DAYS_OF_WEEK = ('SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT')
MAX_DISPLAY_NAME_LENGTH = 100
MAX_TIMEZONE_LENGTH = 50
# 29-31 would silently skip the months that lack that day.
MAX_DAY_OF_MONTH = 28
DEFAULT_DISPLAY_NAME = 'Scheduled analysis'
DEFAULT_FORM: dict[str, Any] = {
    'frequency': 'daily',
    'time': '09:00',
    'timezone': 'UTC',
    'day_of_week': 'MON',
    'day_of_month': 1,
}

_TIME_PATTERN = re.compile(r'^(\d{1,2}):(\d{2})$')
# The three shapes `build_cron` produces, so legacy schedules can be edited.
_CRON_PATTERN = re.compile(r'^cron\((\d{1,2}) (\d{1,2}) (\*|\?|\d{1,2}) \* (\*|\?|[A-Z]{3}) \*\)$')


# =============================================================================
# Form: frequency/time/timezone/day → cron and back
# =============================================================================

def validate_form(candidate: dict[str, Any], base: dict[str, Any] | None = None) -> tuple[dict[str, Any] | None, str | None, str | None]:
    """Validate the editable timing fields; returns (form, error, field).

    ``base`` supplies the values a partial update does not mention (the
    schedule's current form); defaults fill whatever is left.
    """
    merged = {**DEFAULT_FORM, **(base or {}), **{key: value for key, value in candidate.items() if value is not None}}

    frequency = str(merged['frequency']).strip().lower()
    if frequency not in FREQUENCIES:
        return None, 'frequency must be one of daily, weekly, monthly', 'frequency'

    match = _TIME_PATTERN.match(str(merged['time']).strip())
    if not match:
        return None, 'Invalid time format. Use HH:MM', 'time'
    hour, minute = int(match.group(1)), int(match.group(2))
    if hour > 23 or minute > 59:
        return None, 'time must be between 00:00 and 23:59', 'time'

    timezone = str(merged['timezone']).strip()
    if not timezone or len(timezone) > MAX_TIMEZONE_LENGTH or not _is_valid_timezone(timezone):
        return None, f'Unknown timezone {timezone!r}. Use an IANA name such as Europe/Madrid', 'timezone'

    day_of_week = str(merged['day_of_week']).strip().upper()
    if day_of_week not in DAYS_OF_WEEK:
        return None, 'day_of_week must be one of SUN, MON, TUE, WED, THU, FRI, SAT', 'day_of_week'

    try:
        day_of_month = int(str(merged['day_of_month']).strip())
    except ValueError:
        return None, 'day_of_month must be a number', 'day_of_month'
    if day_of_month < 1 or day_of_month > MAX_DAY_OF_MONTH:
        return None, f'day_of_month must be between 1 and {MAX_DAY_OF_MONTH}', 'day_of_month'

    return {
        'frequency': frequency,
        'time': f'{hour:02d}:{minute:02d}',
        'timezone': timezone,
        'day_of_week': day_of_week,
        'day_of_month': day_of_month,
    }, None, None


def _is_valid_timezone(name: str) -> bool:
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return False
    return True


def build_cron(form: dict[str, Any]) -> str:
    """EventBridge cron expression for a validated form."""
    hour, minute = (int(part) for part in form['time'].split(':'))
    if form['frequency'] == 'weekly':
        return f"cron({minute} {hour} ? * {form['day_of_week']} *)"
    if form['frequency'] == 'monthly':
        return f"cron({minute} {hour} {form['day_of_month']} * ? *)"
    return f"cron({minute} {hour} * * ? *)"


def parse_cron(expression: str, timezone: str) -> dict[str, Any] | None:
    """Recover a form from one of the expressions `build_cron` produces.

    Only legacy schedules need this — v2 descriptors carry their form. Returns
    ``None`` for anything hand-written outside the three regular shapes.
    """
    match = _CRON_PATTERN.match(expression or '')
    if not match:
        return None
    minute, hour, day_of_month, day_of_week = match.groups()
    form = {**DEFAULT_FORM, 'time': f'{int(hour):02d}:{int(minute):02d}', 'timezone': timezone or 'UTC'}
    if day_of_week in DAYS_OF_WEEK:
        form.update(frequency='weekly', day_of_week=day_of_week)
    elif day_of_month.isdigit():
        form.update(frequency='monthly', day_of_month=int(day_of_month))
    return form


# =============================================================================
# Descriptor: what is stored in Target.Input and what the API returns
# =============================================================================

def _target_input(schedule_id: str, display_name: str, form: dict[str, Any], scope: dict[str, Any]) -> str:
    return json.dumps({
        'schedule_id': schedule_id,
        'display_name': display_name,
        'form': form,
        'scope': scope,
    })


def _parse_target_input(target: dict[str, Any] | None) -> dict[str, Any] | None:
    try:
        parsed = json.loads((target or {}).get('Input') or '')
    except (TypeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _iso(value: Any) -> str | None:
    return value.isoformat() if hasattr(value, 'isoformat') else None


def describe_schedule(detail: dict[str, Any]) -> dict[str, Any]:
    """API shape of one schedule, from a GetSchedule response.

    v2 descriptors are returned as stored. Legacy inputs are translated as
    far as they go: ``{"source": "dynamodb"}`` is scope ``all``; a keyword-text
    list has no id-based scope (``scope: null``, texts under ``keywords``) and
    must be re-scoped when edited; the form is recovered from the cron.
    """
    name = detail.get('Name', '')
    expression = detail.get('ScheduleExpression', '')
    timezone = detail.get('ScheduleExpressionTimezone') or 'UTC'
    state = detail.get('State', 'ENABLED')
    parsed = _parse_target_input(detail.get('Target'))

    legacy = not (parsed and ('form' in parsed or 'schedule_id' in parsed))
    scope: dict[str, Any] | None = None
    keywords: list[str] = []
    form = None
    display_name = name

    if parsed and not legacy:
        display_name = str(parsed.get('display_name') or detail.get('Description') or name).strip() or name
        form, _error, _field = validate_form(parsed.get('form') or {}) if isinstance(parsed.get('form'), dict) else (None, None, None)
        scope, _scope_error = validate_scope(parsed.get('scope'))
    elif parsed and parsed.get('source') == 'dynamodb':
        scope = {'mode': 'all'}
    elif parsed and isinstance(parsed.get('keywords'), list):
        keywords = [text for text in parsed['keywords'] if isinstance(text, str)]

    if form is None:
        form = parse_cron(expression, timezone)

    return {
        'id': name,
        'name': name,
        'display_name': display_name,
        'state': state,
        'enabled': state == 'ENABLED',
        'schedule': expression,
        'timezone': timezone,
        'form': form,
        'scope': scope,
        'scope_summary': describe_scope(scope) if scope else (f'{len(keywords)} keyword(s)' if keywords else 'unknown scope'),
        'keywords': keywords,
        'legacy': legacy,
        'description': detail.get('Description', ''),
        'created_at': _iso(detail.get('CreationDate')),
        'updated_at': _iso(detail.get('LastModificationDate')),
    }


# =============================================================================
# EventBridge Scheduler helpers
# =============================================================================

def _ensure_schedule_group() -> None:
    try:
        scheduler.get_schedule_group(Name=SCHEDULE_GROUP)
    except scheduler.exceptions.ResourceNotFoundException:
        scheduler.create_schedule_group(Name=SCHEDULE_GROUP)


def _list_all_schedule_names() -> list[str]:
    names: list[str] = []
    params: dict[str, Any] = {'GroupName': SCHEDULE_GROUP, 'MaxResults': 100}
    while True:
        response = scheduler.list_schedules(**params)
        names.extend(summary['Name'] for summary in response.get('Schedules', []))
        token = response.get('NextToken')
        if not token:
            return names
        params['NextToken'] = token


def _get_detail(schedule_id: str) -> dict[str, Any] | None:
    try:
        return scheduler.get_schedule(Name=schedule_id, GroupName=SCHEDULE_GROUP)
    except scheduler.exceptions.ResourceNotFoundException:
        return None


def _new_schedule_id() -> str:
    return f'{SCHEDULE_ID_PREFIX}{secrets.token_hex(4)}'


def _path_id(event: dict[str, Any]) -> str | None:
    params = event.get('pathParameters') or {}
    return params.get('id') or params.get('name')


def _validation_exception_message(exc: Exception) -> str:
    response = getattr(exc, 'response', None)
    message = response.get('Error', {}).get('Message') if isinstance(response, dict) else None
    return message or str(exc) or 'EventBridge Scheduler rejected the schedule'


# =============================================================================
# Request validation
# =============================================================================

def _validate_display_name(value: Any, default: str) -> tuple[str | None, str | None]:
    if value is None:
        return default, None
    if not isinstance(value, str):
        return None, 'display_name must be a string'
    name = value.strip()
    if not name:
        return None, 'display_name must not be empty'
    if len(name) > MAX_DISPLAY_NAME_LENGTH:
        return None, f'display_name must be at most {MAX_DISPLAY_NAME_LENGTH} characters'
    return name, None


def _validate_scope_request(value: Any, event: dict[str, Any]) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Validate a scope and check that referenced groups exist; returns (scope, error_response)."""
    scope, error = validate_scope(value)
    if error:
        return None, validation_error(error, event, 'scope')
    if scope['mode'] == 'groups':
        existing = load_existing_group_ids(dynamodb.Table(KEYWORD_GROUPS_TABLE), scope['group_ids'])
        missing = [group_id for group_id in scope['group_ids'] if group_id not in existing]
        if missing:
            return None, validation_error(f"Unknown keyword group id(s): {', '.join(missing)}", event, 'scope')
    return scope, None


def _validate_enabled(value: Any, default: bool) -> tuple[bool | None, str | None]:
    if value is None:
        return default, None
    if isinstance(value, bool):
        return value, None
    if isinstance(value, str) and value.lower() in ('true', 'false'):
        return value.lower() == 'true', None
    return None, 'enabled must be true or false'


def _form_fields(body: dict[str, Any]) -> dict[str, Any]:
    """The timing fields, accepted flat or nested under ``form``."""
    nested = body.get('form') if isinstance(body.get('form'), dict) else {}
    flat = {key: body.get(key) for key in DEFAULT_FORM}
    return {**nested, **{key: value for key, value in flat.items() if value is not None}}


# =============================================================================
# Routes
# =============================================================================

def _list_schedules(event: dict[str, Any]) -> dict[str, Any]:
    """GET /api/schedules — every schedule, newest first."""
    _ensure_schedule_group()
    schedules = []
    for name in _list_all_schedule_names():
        detail = _get_detail(name)
        if detail:
            schedules.append(describe_schedule(detail))
    schedules.sort(key=lambda item: item.get('created_at') or '', reverse=True)
    return success_response({'schedules': schedules, 'count': len(schedules)}, event)


def _get_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """GET /api/schedules or GET /api/schedules/{id}."""
    schedule_id = _path_id(event)
    if not schedule_id:
        return _list_schedules(event)
    detail = _get_detail(schedule_id)
    if not detail:
        return not_found_response(resource='Schedule', event=event)
    return success_response(describe_schedule(detail), event)


def _write_schedule(action: str, schedule_id: str, display_name: str, form: dict[str, Any], scope: dict[str, Any], enabled: bool) -> None:
    """CreateSchedule or UpdateSchedule with the full v2 definition (UpdateSchedule is a full replace)."""
    call = scheduler.create_schedule if action == 'create' else scheduler.update_schedule
    call(
        Name=schedule_id,
        GroupName=SCHEDULE_GROUP,
        ScheduleExpression=build_cron(form),
        ScheduleExpressionTimezone=form['timezone'],
        State='ENABLED' if enabled else 'DISABLED',
        Description=display_name,
        FlexibleTimeWindow={'Mode': 'OFF'},
        Target={
            'Arn': STATE_MACHINE_ARN,
            'RoleArn': SCHEDULE_ROLE_ARN,
            'Input': _target_input(schedule_id, display_name, form, scope),
        },
    )


def _written_detail(schedule_id: str, display_name: str, form: dict[str, Any], scope: dict[str, Any], enabled: bool) -> dict[str, Any]:
    """What GetSchedule would return for the definition just written."""
    return {
        'Name': schedule_id,
        'Description': display_name,
        'ScheduleExpression': build_cron(form),
        'ScheduleExpressionTimezone': form['timezone'],
        'State': 'ENABLED' if enabled else 'DISABLED',
        'Target': {'Input': _target_input(schedule_id, display_name, form, scope)},
    }


@require_group(ADMIN_GROUP)
@parse_json_body
def _create_schedule_handler(event: dict[str, Any], context: Any, body: dict[str, Any]) -> dict[str, Any]:
    """POST /api/schedules — create a v2 schedule."""
    if 'keywords' in body:
        return validation_error(
            'keywords is no longer accepted; send a scope ({"mode": "keywords", "keyword_ids": [...]})', event, 'keywords'
        )

    display_name, error = _validate_display_name(body.get('display_name', body.get('name')), DEFAULT_DISPLAY_NAME)
    if error:
        return validation_error(error, event, 'display_name')
    form, error, field = validate_form(_form_fields(body))
    if error:
        return validation_error(error, event, field)
    scope, scope_error = _validate_scope_request(body.get('scope') or {'mode': 'all'}, event)
    if scope_error:
        return scope_error
    enabled, error = _validate_enabled(body.get('enabled'), True)
    if error:
        return validation_error(error, event, 'enabled')

    _ensure_schedule_group()
    schedule_id = _new_schedule_id()
    for _attempt in range(2):
        try:
            _write_schedule('create', schedule_id, display_name, form, scope, enabled)
            break
        except scheduler.exceptions.ConflictException:
            # 32 random bits; a collision is a retry, not an error.
            schedule_id = _new_schedule_id()
        except scheduler.exceptions.ValidationException as exc:
            return validation_error(_validation_exception_message(exc), event)
    else:
        return api_response(409, {'error': 'Could not allocate a schedule id, please retry'}, event)

    logger.info(f"Created schedule {schedule_id} ({display_name!r}, {describe_scope(scope)})")
    return success_response({
        **describe_schedule(_written_detail(schedule_id, display_name, form, scope, enabled)),
        'message': 'Schedule created successfully',
    }, event, 201)


@require_group(ADMIN_GROUP)
@parse_json_body
def _update_schedule_handler(event: dict[str, Any], context: Any, body: dict[str, Any]) -> dict[str, Any]:
    """PUT /api/schedules/{id} — replace name, timing, scope and state.

    Fields left out keep their current value. A legacy keyword-text schedule
    has no id-based scope, so editing one requires a ``scope`` — after which
    it is a v2 schedule under the same id.
    """
    schedule_id = _path_id(event)
    if not schedule_id:
        return validation_error('Schedule id is required', event, 'id')
    if 'keywords' in body:
        return validation_error('keywords is no longer accepted; send a scope', event, 'keywords')

    detail = _get_detail(schedule_id)
    if not detail:
        return not_found_response(resource='Schedule', event=event)
    current = describe_schedule(detail)

    display_name, error = _validate_display_name(body.get('display_name', body.get('name')), current['display_name'])
    if error:
        return validation_error(error, event, 'display_name')
    form, error, field = validate_form(_form_fields(body), base=current.get('form'))
    if error:
        return validation_error(error, event, field)
    scope_value = body.get('scope', current['scope'])
    if scope_value is None:
        return validation_error('scope is required to update a schedule created before 2.3.0', event, 'scope')
    scope, scope_error = _validate_scope_request(scope_value, event)
    if scope_error:
        return scope_error
    enabled, error = _validate_enabled(body.get('enabled'), current['enabled'])
    if error:
        return validation_error(error, event, 'enabled')

    try:
        _write_schedule('update', schedule_id, display_name, form, scope, enabled)
    except scheduler.exceptions.ResourceNotFoundException:
        return not_found_response(resource='Schedule', event=event)
    except scheduler.exceptions.ValidationException as exc:
        return validation_error(_validation_exception_message(exc), event)

    logger.info(f"Updated schedule {schedule_id} ({display_name!r}, {describe_scope(scope)})")
    return success_response({
        **describe_schedule(_written_detail(schedule_id, display_name, form, scope, enabled)),
        'message': 'Schedule updated successfully',
    }, event)


@require_group(ADMIN_GROUP)
def _delete_schedule_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """DELETE /api/schedules/{id}."""
    schedule_id = _path_id(event)
    if not schedule_id:
        return validation_error('Schedule id is required', event, 'id')
    try:
        scheduler.delete_schedule(Name=schedule_id, GroupName=SCHEDULE_GROUP)
    except scheduler.exceptions.ResourceNotFoundException:
        return not_found_response(resource='Schedule', event=event)
    return success_response({'message': 'Schedule deleted successfully'}, event)


@require_group(ADMIN_GROUP)
def _run_schedule_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """POST /api/schedules/{id}/run — start an analysis now with the schedule's scope.

    The execution input is what EventBridge would have sent, so ParseKeywords
    resolves the same keywords and query prompts a timed run would.
    """
    schedule_id = _path_id(event)
    if not schedule_id:
        return validation_error('Schedule id is required', event, 'id')
    detail = _get_detail(schedule_id)
    if not detail:
        return not_found_response(resource='Schedule', event=event)
    schedule = describe_schedule(detail)

    execution_input: dict[str, Any] = {
        'schedule_id': schedule_id,
        'display_name': schedule['display_name'],
        'triggered_by': 'schedule-run-now',
    }
    if schedule['scope'] is not None:
        execution_input['scope'] = schedule['scope']
    elif schedule['keywords']:
        execution_input['keywords'] = schedule['keywords']
    else:
        return validation_error('This schedule has no usable keyword scope; edit it first', event, 'scope')

    execution_name = f'schedule-run-{get_timestamp_compact()}-{secrets.token_hex(2)}'
    response = stepfunctions.start_execution(
        stateMachineArn=STATE_MACHINE_ARN,
        name=execution_name,
        input=json.dumps(execution_input),
    )
    logger.info(f"Started {execution_name} for schedule {schedule_id} ({schedule['scope_summary']})")
    return success_response({
        'execution_arn': response['executionArn'],
        'execution_name': execution_name,
        'schedule_id': schedule_id,
        'scope_summary': schedule['scope_summary'],
        'message': f"Analysis started for {schedule['display_name']} ({schedule['scope_summary']})",
    }, event, 202)


@api_handler
@route_handler({
    ('POST', '/run'): _run_schedule_handler,
    ('GET', None): _get_handler,
    ('POST', None): _create_schedule_handler,
    ('PUT', None): _update_schedule_handler,
    ('DELETE', None): _delete_schedule_handler,
})
def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Route handler for API Gateway requests."""
    pass  # Routes handle everything
