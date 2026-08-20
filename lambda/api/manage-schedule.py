"""
Manage Schedule API Lambda

Create, update, delete EventBridge schedules for automated analysis runs.
"""

import json
import logging
import os
import sys
from typing import Any

import boto3

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import api_response, error_response, not_found_response, success_response, validation_error
from shared.auth import ADMIN_GROUP, require_group
from shared.constants import MAX_KEYWORD_LENGTH
from shared.decorators import api_handler, parse_json_body, validate

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

scheduler = boto3.client('scheduler')

STATE_MACHINE_ARN = os.environ['STATE_MACHINE_ARN']
SCHEDULE_ROLE_ARN = os.environ['SCHEDULE_ROLE_ARN']
SCHEDULE_GROUP = 'citation-analysis-schedules'

# Match the limits enforced by parse-keywords / trigger-keyword-analysis.
# MAX_KEYWORD_LENGTH is the shared cross-route cap (shared.constants).
MAX_SCHEDULE_KEYWORDS = 100


def _normalize_schedule_keywords(keywords: list) -> tuple[list[str], str | None]:
    """
    Normalize the optional keyword subset of a schedule.

    Returns (keywords, error). An empty list means "all active keywords",
    which keeps the schedule input resolved at execution time.
    """
    normalized = []
    for keyword in keywords:
        if not isinstance(keyword, str):
            return [], 'keywords must be an array of strings'
        stripped = keyword.strip()
        if not stripped:
            continue
        if len(stripped) > MAX_KEYWORD_LENGTH:
            return [], f'Each keyword must be at most {MAX_KEYWORD_LENGTH} characters'
        normalized.append(stripped)

    if len(normalized) > MAX_SCHEDULE_KEYWORDS:
        return [], f'Too many keywords (max {MAX_SCHEDULE_KEYWORDS})'

    return normalized, None


def _build_schedule_input(schedule_keywords: list[str]) -> str:
    """
    Build the Step Functions input baked into the schedule target.

    Schedules without a keyword subset keep {'source': 'dynamodb'} so the
    keyword list (and query prompts) are resolved fresh at execution time.
    """
    if schedule_keywords:
        return json.dumps({'keywords': schedule_keywords})
    return json.dumps({'source': 'dynamodb'})


def _extract_schedule_keywords(target: dict[str, Any]) -> list[str]:
    """Read the keyword subset back out of a schedule target input."""
    try:
        target_input = json.loads(target.get('Input') or '{}')
    except (TypeError, ValueError):
        return []

    keywords = target_input.get('keywords')
    if not isinstance(keywords, list):
        return []
    return [kw for kw in keywords if isinstance(kw, str)]


@api_handler
def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """
    GET /api/schedules - List all schedules
    POST /api/schedules - Create a schedule
    DELETE /api/schedules/{name} - Delete a schedule
    """
    method = event.get('httpMethod')

    if method == 'GET':
        return list_schedules(event)
    elif method == 'POST':
        return _create_schedule_handler(event, context)
    elif method == 'DELETE':
        return _delete_schedule_handler(event, context)
    else:
        return validation_error('Method not allowed', event)


def list_schedules(event: dict[str, Any]) -> dict[str, Any]:
    """List all schedules."""
    try:
        # Ensure schedule group exists
        try:
            scheduler.get_schedule_group(Name=SCHEDULE_GROUP)
        except scheduler.exceptions.ResourceNotFoundException:
            scheduler.create_schedule_group(Name=SCHEDULE_GROUP)

        response = scheduler.list_schedules(
            GroupName=SCHEDULE_GROUP,
            MaxResults=50
        )

        schedules = []
        for schedule in response.get('Schedules', []):
            # Get full schedule details
            detail = scheduler.get_schedule(
                Name=schedule['Name'],
                GroupName=SCHEDULE_GROUP
            )

            schedules.append({
                'name': detail['Name'],
                'schedule': detail['ScheduleExpression'],
                'state': detail['State'],
                'timezone': detail.get('ScheduleExpressionTimezone', 'UTC'),
                'description': detail.get('Description', ''),
                # Empty list = schedule runs all active keywords
                'keywords': _extract_schedule_keywords(detail.get('Target') or {})
            })

        return success_response({'schedules': schedules}, event)
    except Exception as e:
        logger.error(f"Error listing schedules: {e!s}")
        return error_response(e, event)


@require_group(ADMIN_GROUP)
@parse_json_body
@validate({
    'name': {'type': str, 'max_length': 100, 'default': 'daily-analysis'},
    'frequency': {'type': str, 'choices': ['daily', 'weekly', 'monthly'], 'default': 'daily'},
    'time': {'type': str, 'default': '09:00'},
    'timezone': {'type': str, 'max_length': 50, 'default': 'UTC'},
    'enabled': {'type': bool, 'default': True},
    'day_of_week': {'type': str, 'choices': ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], 'default': 'MON'},
    'day_of_month': {'type': str, 'default': '1'},
})
def _create_schedule_handler(event: dict[str, Any], context: Any, body: dict[str, Any],
                              name: str, frequency: str, time: str, timezone: str,
                              enabled: bool, day_of_week: str, day_of_month: str) -> dict[str, Any]:
    """Create a new schedule, optionally linked to a subset of keywords."""
    # Validated from the raw body: @validate's list coercion would silently
    # turn a string into a list of characters.
    raw_keywords = body.get('keywords', [])
    if not isinstance(raw_keywords, list):
        return validation_error('keywords must be an array of strings', event, 'keywords')

    schedule_keywords, keywords_error = _normalize_schedule_keywords(raw_keywords)
    if keywords_error:
        return validation_error(keywords_error, event, 'keywords')
    # Validate time format (HH:MM)
    if not time or len(time) != 5 or ':' not in time:
        return validation_error('Invalid time format. Use HH:MM', event, 'time')

    try:
        hour, minute = time.split(':')
        int(hour)  # Validate it's a number
        int(minute)
    except (ValueError, AttributeError):
        return validation_error('Invalid time format. Use HH:MM', event, 'time')

    # Build cron expression based on frequency
    if frequency == 'daily':
        cron_expr = f"cron({minute} {hour} * * ? *)"
    elif frequency == 'weekly':
        cron_expr = f"cron({minute} {hour} ? * {day_of_week} *)"
    elif frequency == 'monthly':
        try:
            dom = int(day_of_month)
            if dom < 1 or dom > 28:
                return validation_error('day_of_month must be between 1 and 28', event, 'day_of_month')
        except ValueError:
            return validation_error('day_of_month must be a number', event, 'day_of_month')
        cron_expr = f"cron({minute} {hour} {day_of_month} * ? *)"
    else:
        # This shouldn't happen due to @validate choices, but kept for safety
        return validation_error('Invalid frequency. Use: daily, weekly, or monthly', event, 'frequency')

    # Ensure schedule group exists
    try:
        scheduler.get_schedule_group(Name=SCHEDULE_GROUP)
    except scheduler.exceptions.ResourceNotFoundException:
        scheduler.create_schedule_group(Name=SCHEDULE_GROUP)

    # Create schedule
    scope = f"{len(schedule_keywords)} keyword(s)" if schedule_keywords else 'all keywords'
    try:
        scheduler.create_schedule(
            Name=name,
            GroupName=SCHEDULE_GROUP,
            ScheduleExpression=cron_expr,
            ScheduleExpressionTimezone=timezone,
            State='ENABLED' if enabled else 'DISABLED',
            Description=f"Automated {frequency} citation analysis ({scope})",
            FlexibleTimeWindow={'Mode': 'OFF'},
            Target={
                'Arn': STATE_MACHINE_ARN,
                'RoleArn': SCHEDULE_ROLE_ARN,
                'Input': _build_schedule_input(schedule_keywords)
            }
        )

        return success_response({
            'message': 'Schedule created successfully',
            'name': name,
            'schedule': cron_expr,
            'timezone': timezone,
            'keywords': schedule_keywords
        }, event, 201)
    except scheduler.exceptions.ConflictException:
        return api_response(409, {'error': 'Schedule with this name already exists'}, event)


@require_group(ADMIN_GROUP)
def _delete_schedule_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """DELETE /api/schedules/{name} - Admin-only entry point.

    `delete_schedule` takes `(schedule_name, event)` rather than the
    `(event, context)` shape every decorator in this codebase expects, so this
    thin adapter is where the authorization gate attaches. Mirrors the existing
    `_create_schedule_handler` split.
    """
    path_params = event.get('pathParameters') or {}
    return delete_schedule(path_params.get('name'), event)


def delete_schedule(schedule_name: str, event: dict[str, Any]) -> dict[str, Any]:
    """Delete a schedule."""
    if not schedule_name:
        return validation_error('Schedule name is required', event, 'name')

    try:
        scheduler.delete_schedule(
            Name=schedule_name,
            GroupName=SCHEDULE_GROUP
        )

        return success_response({'message': 'Schedule deleted successfully'}, event)
    except scheduler.exceptions.ResourceNotFoundException:
        return not_found_response('Schedule', event)
