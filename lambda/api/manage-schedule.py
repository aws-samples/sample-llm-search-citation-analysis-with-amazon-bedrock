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
      "scope": {"mode": "all"} | {"mode": "groups", "group_ids": [...]} | {"mode": "keywords", "keyword_ids": [...]},
      "kind": "analysis" | "domain_snapshots" | "backlink_snapshots"
    }

``kind`` says what the schedule starts (``KINDS``): an analysis run (the default, and every schedule written
before 2.43.0), or one of the paid DataForSEO snapshot runs of the SEO stack (every owned and competitor domain;
no keyword scope). A snapshot run happens only while its schedule exists, so nothing is bought until an Admin
creates one (TENETS.md, tenets 7 and 8). The SEO stack's rank trackers schedule themselves, one EventBridge
Scheduler schedule per tracker in ``citation-analysis-seo-rank``; ``GET /api/schedules?source=rank-trackers`` lists them
read-only so every planned paid run shows on one page.

ParseKeywords resolves ``scope`` at run time, so a schedule that targets a
keyword group runs whatever keywords are in the group when it fires. Schedules
created before 2.3.0 (``{"source": "dynamodb"}`` or ``{"keywords": [...]}``
inputs) are listed as ``legacy``; saving one rewrites it as v2 under the same
``Name``.

Routes (mutations are Admin-only):
    GET    /api/schedules              list, one page (limit, next_token)
    POST   /api/schedules              create
    GET    /api/schedules/{id}
    PUT    /api/schedules/{id}         full update (name, form, scope, enabled)
    DELETE /api/schedules/{id}
    POST   /api/schedules/{id}/run     start the schedule's run now (a snapshot schedule needs ``confirm_paid: true``, as does saving it enabled)
    GET    /api/schedules?source=rank-trackers  the rank trackers' schedules (read-only; edited on the tracker)
"""

import json
import logging
import os
import re
import secrets
import sys
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import boto3

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import api_response, not_found_response, success_response, validation_error
from shared.auth import ADMIN_GROUP, require_group
from shared.cursors import CURSOR_ERROR_MESSAGE, CURSOR_QUERY_PARAM, decode_offset_cursor, encode_offset_cursor
from shared.decorators import (
    RouteNotHandledError,
    api_handler,
    optional_limit,
    parse_json_body,
    route_handler,
    validate,
)
from shared.keyword_groups import describe_scope, load_existing_group_ids, validate_scope
from shared.log_safety import log_text
from shared.response_budget import PAGE_BUDGET_BYTES, json_bytes
from shared.utils import get_timestamp_compact

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

scheduler = boto3.client('scheduler')
stepfunctions = boto3.client('stepfunctions')
dynamodb = boto3.resource('dynamodb')

STATE_MACHINE_ARN = os.environ['STATE_MACHINE_ARN']
SCHEDULE_ROLE_ARN = os.environ['SCHEDULE_ROLE_ARN']
#: What each kind of schedule starts: its state machine ARN and the name a new schedule of it gets.
KINDS: dict[str, tuple[str, str]] = {
    'analysis': (STATE_MACHINE_ARN, 'Scheduled analysis'),
    'domain_snapshots': (os.environ.get('SEO_DOMAIN_SNAPSHOTS_STATE_MACHINE_ARN', ''), 'Domain traffic snapshots'),
    'backlink_snapshots': (os.environ.get('SEO_BACKLINK_SNAPSHOTS_STATE_MACHINE_ARN', ''), 'Backlink snapshots'),
}
SNAPSHOT_SCOPE_SUMMARY = 'every owned and competitor domain'
RANK_TRACKER_SCHEDULE_GROUP = 'citation-analysis-seo-rank'
RANK_TRACKER_SOURCE = 'rank-trackers'  # GET /api/schedules?source=rank-trackers
KEYWORD_GROUPS_TABLE = os.environ.get('DYNAMODB_TABLE_KEYWORD_GROUPS', 'CitationAnalysis-KeywordGroups')
SCHEDULE_GROUP = 'citation-analysis-schedules'
# GET /api/schedules pages: schedules per page, and GetSchedule calls in flight
# (EventBridge Scheduler allows 50 GetSchedule TPS by default).
SCHEDULE_PAGE_DEFAULT = 50
SCHEDULE_PAGE_MAX = 100
DETAIL_WORKERS = 8

SCHEDULE_ID_PREFIX = 'sch-'
FREQUENCIES = ('daily', 'weekly', 'monthly')
DAYS_OF_WEEK = ('SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT')
MAX_DISPLAY_NAME_LENGTH = 100
MAX_TIMEZONE_LENGTH = 50
# 29-31 would silently skip the months that lack that day.
MAX_DAY_OF_MONTH = 28
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


class _InvalidRequest(Exception):
    """A request field the route answers with a 400 naming ``field``."""

    def __init__(self, message: str, field: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.field = field

    def response(self, event: dict[str, Any]) -> dict[str, Any]:
        return validation_error(self.message, event, self.field)


# =============================================================================
# Form: frequency/time/timezone/day → cron and back
# =============================================================================

def _parse_form(candidate: dict[str, Any], base: dict[str, Any] | None = None) -> dict[str, Any]:
    """The validated timing fields, or ``_InvalidRequest`` naming the first bad one.

    ``base`` supplies the values a partial update does not mention (the
    schedule's current form); defaults fill whatever is left.
    """
    merged = {**DEFAULT_FORM, **(base or {}), **{key: value for key, value in candidate.items() if value is not None}}

    frequency = str(merged['frequency']).strip().lower()
    if frequency not in FREQUENCIES:
        raise _InvalidRequest('frequency must be one of daily, weekly, monthly', 'frequency')

    match = _TIME_PATTERN.match(str(merged['time']).strip())
    if not match:
        raise _InvalidRequest('Invalid time format. Use HH:MM', 'time')
    hour, minute = int(match.group(1)), int(match.group(2))
    if hour > 23 or minute > 59:
        raise _InvalidRequest('time must be between 00:00 and 23:59', 'time')

    timezone = str(merged['timezone']).strip()
    if not timezone or len(timezone) > MAX_TIMEZONE_LENGTH or not _is_valid_timezone(timezone):
        raise _InvalidRequest(f'Unknown timezone {timezone!r}. Use an IANA name such as Europe/Madrid', 'timezone')

    day_of_week = str(merged['day_of_week']).strip().upper()
    if day_of_week not in DAYS_OF_WEEK:
        raise _InvalidRequest('day_of_week must be one of SUN, MON, TUE, WED, THU, FRI, SAT', 'day_of_week')

    try:
        day_of_month = int(str(merged['day_of_month']).strip())
    except ValueError:
        raise _InvalidRequest('day_of_month must be a number', 'day_of_month') from None
    if day_of_month < 1 or day_of_month > MAX_DAY_OF_MONTH:
        raise _InvalidRequest(f'day_of_month must be between 1 and {MAX_DAY_OF_MONTH}', 'day_of_month')

    return {
        'frequency': frequency,
        'time': f'{hour:02d}:{minute:02d}',
        'timezone': timezone,
        'day_of_week': day_of_week,
        'day_of_month': day_of_month,
    }


def validate_form(candidate: dict[str, Any], base: dict[str, Any] | None = None) -> tuple[dict[str, Any] | None, str | None, str | None]:
    """Validate the editable timing fields; returns (form, error, field).

    The non-raising form of :func:`_parse_form`, for reading a stored
    descriptor that may predate the current rules.
    """
    try:
        form = _parse_form(candidate, base)
    except _InvalidRequest as exc:
        return None, exc.message, exc.field
    return form, None, None


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

def _target_input(schedule_id: str, display_name: str, form: dict[str, Any], scope: dict[str, Any] | None,
                  kind: str = 'analysis') -> str:
    return json.dumps({
        'schedule_id': schedule_id,
        'display_name': display_name,
        'form': form,
        'scope': scope,
        'kind': kind,
    })


def _parse_target_input(target: dict[str, Any] | None) -> dict[str, Any] | None:
    try:
        parsed = json.loads((target or {}).get('Input') or '')
    except (TypeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _iso(value: Any) -> str | None:
    return value.isoformat() if hasattr(value, 'isoformat') else None


def describe_schedule(detail: Mapping[str, Any]) -> dict[str, Any]:
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

    kind = str(parsed.get('kind') or 'analysis') if parsed else 'analysis'
    if parsed and not legacy:
        display_name = str(parsed.get('display_name') or detail.get('Description') or name).strip() or name
        form, _error, _field = validate_form(parsed.get('form') or {}) if isinstance(parsed.get('form'), dict) else (None, None, None)
        if kind == 'analysis':
            scope, _scope_error = validate_scope(parsed.get('scope'))
    elif parsed and parsed.get('source') == 'dynamodb':
        scope = {'mode': 'all'}
    elif parsed and isinstance(parsed.get('keywords'), list):
        keywords = [text for text in parsed['keywords'] if isinstance(text, str)]

    if form is None:
        form = parse_cron(expression, timezone)
    if kind == 'analysis':
        scope_summary = describe_scope(scope) if scope else (f'{len(keywords)} keyword(s)' if keywords else 'unknown scope')
    else:
        scope_summary = SNAPSHOT_SCOPE_SUMMARY

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
        'scope_summary': scope_summary,
        'kind': kind,
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


def _list_schedule_summaries() -> list[dict[str, Any]]:
    """Every ListSchedules summary in the group (name and creation date; 100 per call, no details)."""
    summaries: list[dict[str, Any]] = []
    params: dict[str, Any] = {'GroupName': SCHEDULE_GROUP, 'MaxResults': 100}
    while True:
        response = scheduler.list_schedules(**params)
        summaries.extend(dict(summary) for summary in response.get('Schedules', []) if 'Name' in summary)
        token = response.get('NextToken')
        if not token:
            return summaries
        params['NextToken'] = token


def _newest_first_names(summaries: list[dict[str, Any]]) -> list[str]:
    """Schedule names newest first by creation date, ties by name (a stable order for offset cursors)."""
    ordered = sorted(summaries, key=lambda summary: summary['Name'])
    ordered.sort(key=lambda summary: _iso(summary.get('CreationDate')) or '', reverse=True)
    return [summary['Name'] for summary in ordered]


def _get_details(names: list[str]) -> list[Mapping[str, Any] | None]:
    """GetSchedule for each name, ``DETAIL_WORKERS`` at a time, in ``names`` order (``None`` once deleted)."""
    if not names:
        return []
    with ThreadPoolExecutor(max_workers=min(DETAIL_WORKERS, len(names))) as pool:
        return list(pool.map(_get_detail, names))


def _get_detail(schedule_id: str) -> Mapping[str, Any] | None:
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
# Request validation — each helper returns the accepted value or raises
# ``_InvalidRequest`` for the route to answer with a 400
# =============================================================================

def _validate_display_name(value: Any, default: str) -> str:
    if value is None:
        return default
    if not isinstance(value, str):
        raise _InvalidRequest('display_name must be a string', 'display_name')
    name = value.strip()
    if not name:
        raise _InvalidRequest('display_name must not be empty', 'display_name')
    if len(name) > MAX_DISPLAY_NAME_LENGTH:
        raise _InvalidRequest(f'display_name must be at most {MAX_DISPLAY_NAME_LENGTH} characters', 'display_name')
    return name


def _validate_scope_request(value: Any) -> dict[str, Any]:
    """Validate a scope and check that every group it references exists."""
    scope, error = validate_scope(value)
    if scope is None:
        # validate_scope returns exactly one of (scope, None) / (None, error).
        raise _InvalidRequest(str(error), 'scope')
    if scope['mode'] == 'groups':
        existing = load_existing_group_ids(dynamodb.Table(KEYWORD_GROUPS_TABLE), scope['group_ids'])
        missing = [group_id for group_id in scope['group_ids'] if group_id not in existing]
        if missing:
            raise _InvalidRequest(f"Unknown keyword group id(s): {', '.join(missing)}", 'scope')
    return scope


def _state_machine_exists(arn: str) -> bool:
    """Whether ``arn`` names a deployed state machine (the SEO stack's are named, not referenced)."""
    if not arn:
        return False
    try:
        stepfunctions.describe_state_machine(stateMachineArn=arn)
    except stepfunctions.exceptions.StateMachineDoesNotExist:
        return False
    return True


PAID_CONFIRMATION_FIELD = 'confirm_paid'


def _require_paid_confirmation(kind: str, body: Mapping[str, Any], enabled: bool = True) -> None:
    """A snapshot schedule spends money on its own, so the server asks for the acknowledgement (tenet 4).

    Saving an enabled snapshot schedule, or running one now, needs ``confirm_paid: true``: what the dashboard sends
    after its confirmation, and what a headless client must send knowingly. A disabled one never runs.
    """
    if kind != 'analysis' and enabled and body.get(PAID_CONFIRMATION_FIELD) is not True:
        raise _InvalidRequest(
            f'{kind} schedules make paid DataForSEO calls on every run: send {PAID_CONFIRMATION_FIELD}: true',
            PAID_CONFIRMATION_FIELD,
        )


def _validate_kind(value: Any) -> str:
    """A known kind whose state machine is deployed (``analysis`` when absent)."""
    kind = 'analysis' if value is None else value
    if not isinstance(kind, str) or kind not in KINDS:
        raise _InvalidRequest(f"kind must be one of: {', '.join(KINDS)}", 'kind')
    if kind != 'analysis' and not _state_machine_exists(KINDS[kind][0]):
        raise _InvalidRequest(f'{kind} schedules need the SEO stack, which is not deployed', 'kind')
    return kind


def _validate_enabled(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str) and value.lower() in ('true', 'false'):
        return value.lower() == 'true'
    raise _InvalidRequest('enabled must be true or false', 'enabled')


def _form_fields(body: dict[str, Any]) -> dict[str, Any]:
    """The timing fields, accepted flat or nested under ``form``."""
    form = body.get('form')
    nested = form if isinstance(form, dict) else {}
    flat = {key: body.get(key) for key in DEFAULT_FORM}
    return {**nested, **{key: value for key, value in flat.items() if value is not None}}


# =============================================================================
# Routes
# =============================================================================

def _page_views(details: list[Mapping[str, Any] | None]) -> tuple[list[dict[str, Any]], int]:
    """The views of ``details`` that fit the page budget, and how many details they used up.

    A schedule deleted between the listing and its GetSchedule (``None``) is
    passed over; the first schedule is always kept so the cursor advances.
    """
    views: list[dict[str, Any]] = []
    used = 2
    for index, detail in enumerate(details):
        if detail is None:
            continue
        view = describe_schedule(detail)
        cost = json_bytes(view) + 2
        if views and used + cost > PAGE_BUDGET_BYTES:
            return views, index
        views.append(view)
        used += cost
    return views, len(details)


def _list_schedules(event: dict[str, Any], limit: int, next_token: str | None) -> dict[str, Any]:
    """GET /api/schedules — one page, newest first; ``next_token`` continues it.

    Names and creation dates come from ListSchedules; GetSchedule (the scope
    and form live in the target input) runs only for this page, in parallel.
    A page is cut to the response page budget: a keyword scope can carry up
    to 1,000 ids.
    """
    offset = decode_offset_cursor(next_token)
    if offset is None:
        return validation_error(CURSOR_ERROR_MESSAGE, event, 'next_token')
    _ensure_schedule_group()
    names = _newest_first_names(_list_schedule_summaries())
    schedules, consumed = _page_views(_get_details(names[offset:offset + limit]))
    return success_response({
        'schedules': schedules,
        'count': len(schedules),
        'total': len(names),
        'next_token': encode_offset_cursor(offset + consumed, len(names)),
    }, event)


@validate({
    'limit': optional_limit(default=SCHEDULE_PAGE_DEFAULT, max_val=SCHEDULE_PAGE_MAX),
    'source': {'type': str, 'choices': [RANK_TRACKER_SOURCE]},
    **CURSOR_QUERY_PARAM,
})
def _get_handler(event: dict[str, Any], context: Any, limit: int, next_token: str | None = None,
                 source: str | None = None) -> dict[str, Any]:
    """GET /api/schedules (one page, ``limit`` / ``next_token``), ?source=rank-trackers, or GET /api/schedules/{id}."""
    schedule_id = _path_id(event)
    if not schedule_id and source == RANK_TRACKER_SOURCE:
        return _rank_tracker_schedules(event)
    if not schedule_id:
        return _list_schedules(event, limit, next_token)
    detail = _get_detail(schedule_id)
    if not detail:
        return not_found_response(resource='Schedule', event=event)
    return success_response(describe_schedule(detail), event)


def _write_schedule(action: str, schedule_id: str, display_name: str, form: dict[str, Any], scope: dict[str, Any] | None,
                    enabled: bool, kind: str = 'analysis') -> None:
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
            'Arn': KINDS[kind][0],
            'RoleArn': SCHEDULE_ROLE_ARN,
            'Input': _target_input(schedule_id, display_name, form, scope, kind),
        },
    )


def _written_detail(schedule_id: str, display_name: str, form: dict[str, Any], scope: dict[str, Any] | None, enabled: bool,
                    kind: str = 'analysis') -> dict[str, Any]:
    """What GetSchedule would return for the definition just written."""
    return {
        'Name': schedule_id,
        'Description': display_name,
        'ScheduleExpression': build_cron(form),
        'ScheduleExpressionTimezone': form['timezone'],
        'State': 'ENABLED' if enabled else 'DISABLED',
        'Target': {'Input': _target_input(schedule_id, display_name, form, scope, kind)},
    }


def _written_view(
    schedule_id: str,
    display_name: str,
    form: dict[str, Any],
    scope: dict[str, Any] | None,
    enabled: bool,
    *,
    message: str,
    kind: str = 'analysis',
) -> dict[str, Any]:
    """The API view of the schedule just written, with the confirmation ``message``."""
    return {**describe_schedule(_written_detail(schedule_id, display_name, form, scope, enabled, kind)), 'message': message}


@require_group(ADMIN_GROUP)
@parse_json_body
def _create_schedule_handler(event: dict[str, Any], context: Any, body: dict[str, Any]) -> dict[str, Any]:
    """POST /api/schedules — create a v2 schedule."""
    if 'keywords' in body:
        return validation_error(
            'keywords is no longer accepted; send a scope ({"mode": "keywords", "keyword_ids": [...]})', event, 'keywords'
        )

    try:
        kind = _validate_kind(body.get('kind'))
        display_name = _validate_display_name(body.get('display_name', body.get('name')), KINDS[kind][1])
        form = _parse_form(_form_fields(body))
        # A snapshot run covers every owned and competitor domain: it has no keyword scope.
        scope = _validate_scope_request(body.get('scope') or {'mode': 'all'}) if kind == 'analysis' else None
        enabled = _validate_enabled(body.get('enabled'), True)
        _require_paid_confirmation(kind, body, enabled)
    except _InvalidRequest as exc:
        return exc.response(event)

    _ensure_schedule_group()
    schedule_id = _new_schedule_id()
    for _attempt in range(2):
        try:
            _write_schedule('create', schedule_id, display_name, form, scope, enabled, kind)
            break
        except scheduler.exceptions.ConflictException:
            # 32 random bits; a collision is a retry, not an error.
            schedule_id = _new_schedule_id()
        except scheduler.exceptions.ValidationException as exc:
            return validation_error(_validation_exception_message(exc), event)
    else:
        return api_response(409, {'error': 'Could not allocate a schedule id, please retry'}, event)

    logger.info('Created %s schedule %s (%r)', kind, schedule_id, display_name)
    return success_response(
        _written_view(schedule_id, display_name, form, scope, enabled, message='Schedule created successfully', kind=kind),
        event,
        201,
    )


def _scope_to_update(body: dict[str, Any], current: dict[str, Any]) -> Any:
    """The scope an update applies: the request's, else the schedule's current one.

    A legacy keyword-text schedule has no id-based scope, so editing one
    requires the request to supply it.
    """
    scope_value = body.get('scope', current['scope'])
    if scope_value is None:
        raise _InvalidRequest('scope is required to update a schedule created before 2.3.0', 'scope')
    return scope_value


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

    kind = current['kind']  # A schedule keeps its kind; another kind is another schedule.
    try:
        display_name = _validate_display_name(body.get('display_name', body.get('name')), current['display_name'])
        form = _parse_form(_form_fields(body), base=current.get('form'))
        scope = _validate_scope_request(_scope_to_update(body, current)) if kind == 'analysis' else None
        enabled = _validate_enabled(body.get('enabled'), current['enabled'])
        _validate_kind(kind)
        _require_paid_confirmation(kind, body, enabled)
    except _InvalidRequest as exc:
        return exc.response(event)

    try:
        _write_schedule('update', schedule_id, display_name, form, scope, enabled, kind)
    except scheduler.exceptions.ResourceNotFoundException:
        return not_found_response(resource='Schedule', event=event)
    except scheduler.exceptions.ValidationException as exc:
        return validation_error(_validation_exception_message(exc), event)

    logger.info('Updated %s schedule %s (%s)', kind, log_text(schedule_id), log_text(display_name))
    return success_response(
        _written_view(schedule_id, display_name, form, scope, enabled, message='Schedule updated successfully', kind=kind),
        event,
    )


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
@parse_json_body
def _run_schedule_handler(event: dict[str, Any], context: Any, body: dict[str, Any]) -> dict[str, Any]:
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
    if schedule['kind'] != 'analysis':
        return _run_snapshots_now(event, schedule, body)

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
    logger.info('Started %s for schedule %s (%s)', execution_name, log_text(schedule_id), log_text(schedule['scope_summary']))
    return success_response({
        'execution_arn': response['executionArn'],
        'execution_name': execution_name,
        'schedule_id': schedule_id,
        'scope_summary': schedule['scope_summary'],
        'message': f"Analysis started for {schedule['display_name']} ({schedule['scope_summary']})",
    }, event, 202)


def _run_snapshots_now(event: dict[str, Any], schedule: dict[str, Any], body: Mapping[str, Any]) -> dict[str, Any]:
    """Start a snapshot schedule's run now (paid: ``confirm_paid`` is required), as a timed run would."""
    try:
        _require_paid_confirmation(schedule['kind'], body)
        arn = KINDS[_validate_kind(schedule['kind'])][0]
    except _InvalidRequest as exc:
        return exc.response(event)
    execution_name = f'schedule-run-{get_timestamp_compact()}-{secrets.token_hex(2)}'
    response = stepfunctions.start_execution(
        stateMachineArn=arn, name=execution_name,
        input=json.dumps({'schedule_id': schedule['id'], 'kind': schedule['kind'], 'triggered_by': 'schedule-run-now'}),
    )
    logger.info('Started %s for %s schedule %s', execution_name, schedule['kind'], log_text(schedule['id']))
    return success_response({
        'execution_arn': response['executionArn'],
        'execution_name': execution_name,
        'schedule_id': schedule['id'],
        'scope_summary': schedule['scope_summary'],
        'message': f"{schedule['display_name']} started ({schedule['scope_summary']})",
    }, event, 202)


def describe_tracker_schedule(detail: Mapping[str, Any]) -> dict[str, Any]:
    """API shape of one rank tracker's schedule (a one-time ``at(...)`` schedule for its next slot)."""
    parsed = _parse_target_input(detail.get('Target')) or {}
    expression = str(detail.get('ScheduleExpression') or '')
    next_run = expression[3:-1] + 'Z' if expression.startswith('at(') and expression.endswith(')') else None
    return {
        'id': detail.get('Name', ''),
        'tracker_id': parsed.get('tracker_id'),
        'display_name': str(detail.get('Description') or parsed.get('tracker_id') or ''),
        'next_run_at': next_run,
        'enabled': detail.get('State', 'ENABLED') == 'ENABLED',
    }


def _rank_tracker_schedules(event: dict[str, Any]) -> dict[str, Any]:
    """GET /api/schedules?source=rank-trackers - the trackers' own schedules, read-only (each is edited on its tracker)."""
    names: list[str] = []
    more = False
    params: dict[str, Any] = {'GroupName': RANK_TRACKER_SCHEDULE_GROUP, 'MaxResults': 100}
    try:
        while True:
            response = scheduler.list_schedules(**params)
            names.extend(summary['Name'] for summary in response.get('Schedules', []) if 'Name' in summary)
            token = response.get('NextToken')
            more = bool(token)
            if not token or len(names) >= SCHEDULE_PAGE_MAX:
                break
            params['NextToken'] = token
    except scheduler.exceptions.ResourceNotFoundException:
        names, more = [], False  # The SEO stack (and its schedule group) is not deployed.

    def detail(name: str) -> Mapping[str, Any] | None:
        try:
            return scheduler.get_schedule(Name=name, GroupName=RANK_TRACKER_SCHEDULE_GROUP)
        except scheduler.exceptions.ResourceNotFoundException:
            return None

    with ThreadPoolExecutor(max_workers=DETAIL_WORKERS) as pool:
        details = [item for item in pool.map(detail, names[:SCHEDULE_PAGE_MAX]) if item is not None]
    schedules = sorted((describe_tracker_schedule(item) for item in details), key=lambda item: item['next_run_at'] or '')
    # A read says when it was cut short (tenets 2 and 4): more trackers are scheduled than one answer lists.
    truncated = len(names) > SCHEDULE_PAGE_MAX or more
    return success_response({'schedules': schedules, 'count': len(schedules), 'truncated': truncated}, event)


@api_handler
@route_handler({
    ('POST', '/run'): _run_schedule_handler,
    ('GET', None): _get_handler,
    ('POST', None): _create_schedule_handler,
    ('PUT', None): _update_schedule_handler,
    ('DELETE', None): _delete_schedule_handler,
})
def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Route handler for API Gateway requests; routes handle everything, this body is never reached."""
    raise RouteNotHandledError(__name__)
