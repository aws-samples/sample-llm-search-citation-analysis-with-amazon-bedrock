"""
Manage Schedule API Lambda

Create, update, delete EventBridge schedules for automated analysis runs.
"""

import json
import boto3
import sys
import logging
from typing import Dict, Any
import os

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.decorators import api_handler, parse_json_body, validate
from shared.api_response import success_response, validation_error, api_response, not_found_response, error_response

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

scheduler = boto3.client('scheduler')

STATE_MACHINE_ARN = os.environ['STATE_MACHINE_ARN']
SCHEDULE_ROLE_ARN = os.environ['SCHEDULE_ROLE_ARN']
SCHEDULE_GROUP = 'citation-analysis-schedules'


@api_handler
def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    GET /api/schedules - List all schedules
    POST /api/schedules - Create a schedule
    DELETE /api/schedules/{name} - Delete a schedule
    """
    method = event.get('httpMethod')
    path_params = event.get('pathParameters') or {}
    
    if method == 'GET':
        return list_schedules(event)
    elif method == 'POST':
        return _create_schedule_handler(event, context)
    elif method == 'DELETE':
        schedule_name = path_params.get('name')
        return delete_schedule(schedule_name, event)
    else:
        return validation_error('Method not allowed', event)


def list_schedules(event: Dict[str, Any]) -> Dict[str, Any]:
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
                'description': detail.get('Description', '')
            })
        
        return success_response({'schedules': schedules}, event)
    except Exception as e:
        logger.error(f"Error listing schedules: {str(e)}")
        return error_response(e, event)


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
def _create_schedule_handler(event: Dict[str, Any], context: Any, body: Dict[str, Any],
                              name: str, frequency: str, time: str, timezone: str,
                              enabled: bool, day_of_week: str, day_of_month: str) -> Dict[str, Any]:
    """Create a new schedule."""
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
    try:
        scheduler.create_schedule(
            Name=name,
            GroupName=SCHEDULE_GROUP,
            ScheduleExpression=cron_expr,
            ScheduleExpressionTimezone=timezone,
            State='ENABLED' if enabled else 'DISABLED',
            Description=f"Automated {frequency} citation analysis",
            FlexibleTimeWindow={'Mode': 'OFF'},
            Target={
                'Arn': STATE_MACHINE_ARN,
                'RoleArn': SCHEDULE_ROLE_ARN,
                'Input': json.dumps({'source': 'dynamodb'})
            }
        )
        
        return success_response({
            'message': 'Schedule created successfully',
            'name': name,
            'schedule': cron_expr,
            'timezone': timezone
        }, event, 201)
    except scheduler.exceptions.ConflictException:
        return api_response(409, {'error': 'Schedule with this name already exists'}, event)


def delete_schedule(schedule_name: str, event: Dict[str, Any]) -> Dict[str, Any]:
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
