"""
Tests for manage-schedule.py Lambda.

Covers:
- Schedule creation (cron building, target input, keyword linking)
- Keyword subset validation (type, count, length)
- Listing schedules with their keyword scope
- Deletion and conflict handling
"""

import importlib.util
import json
import os
import sys
from unittest.mock import MagicMock, patch

import pytest

# Make `from shared.xxx import` resolve (layer puts shared/ at /opt/python/shared/)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))  # lambda/


class SchedulerResourceNotFound(Exception):
    """Stands in for scheduler.exceptions.ResourceNotFoundException."""


class SchedulerConflict(Exception):
    """Stands in for scheduler.exceptions.ConflictException."""


# Mock the EventBridge Scheduler client at module level
mock_scheduler = MagicMock()
mock_scheduler.exceptions.ResourceNotFoundException = SchedulerResourceNotFound
mock_scheduler.exceptions.ConflictException = SchedulerConflict


def _mock_boto3_client(*args, **kwargs):
    return mock_scheduler


# Import the handler module (has hyphens in filename)
_handler_spec = importlib.util.spec_from_file_location(
    'manage_schedule',
    os.path.join(os.path.dirname(__file__), 'manage-schedule.py')
)
_handler_mod = importlib.util.module_from_spec(_handler_spec)

_test_env = {
    'STATE_MACHINE_ARN': 'arn:aws:states:us-east-1:123456789012:stateMachine:test',
    'SCHEDULE_ROLE_ARN': 'arn:aws:iam::123456789012:role/test-scheduler-role',
    'CORS_ORIGIN_PARAM': '',
}

with patch('boto3.client', side_effect=_mock_boto3_client):
    with patch.dict(os.environ, _test_env):
        _handler_spec.loader.exec_module(_handler_mod)

_handler_mod.scheduler = mock_scheduler


def make_event(method, body=None, path_params=None):
    """Build a minimal API Gateway event."""
    return {
        'httpMethod': method,
        'pathParameters': path_params,
        'headers': {'origin': 'http://localhost:3000'},
        'body': json.dumps(body) if body else None,
    }


def parse_response(result):
    """Extract status code and parsed body from Lambda response."""
    status = result.get('statusCode', 200)
    body = json.loads(result['body']) if isinstance(result.get('body'), str) else result.get('body', {})
    return status, body


def created_target_input():
    """Return the parsed Target.Input of the last create_schedule call."""
    kwargs = mock_scheduler.create_schedule.call_args.kwargs
    return json.loads(kwargs['Target']['Input'])


@pytest.fixture(autouse=True)
def _reset_mocks():
    """Reset scheduler mocks before each test."""
    mock_scheduler.reset_mock()
    mock_scheduler.exceptions.ResourceNotFoundException = SchedulerResourceNotFound
    mock_scheduler.exceptions.ConflictException = SchedulerConflict
    mock_scheduler.get_schedule_group.return_value = {'Name': 'citation-analysis-schedules'}
    mock_scheduler.create_schedule.return_value = {}
    mock_scheduler.list_schedules.return_value = {'Schedules': []}
    mock_scheduler.delete_schedule.return_value = {}


@pytest.fixture()
def handler_module():
    """Provide the handler module with the mocked scheduler client."""
    _handler_mod.scheduler = mock_scheduler
    yield _handler_mod


class TestCreateSchedule:
    """Tests for POST /api/schedules."""

    def test_create_without_keywords_targets_all_keywords(self, handler_module):
        """Schedules without a keyword subset keep the dynamodb source input."""
        event = make_event('POST', body={'name': 'biweekly', 'frequency': 'daily', 'time': '09:00'})
        result = handler_module.handler(event, {})
        status, body = parse_response(result)
        assert status == 201
        assert created_target_input() == {'source': 'dynamodb'}
        assert body['keywords'] == []

    def test_create_daily_schedule_builds_daily_cron(self, handler_module):
        """Daily frequency at 09:30 produces the matching cron expression."""
        event = make_event('POST', body={'name': 'daily-am', 'frequency': 'daily', 'time': '09:30'})
        result = handler_module.handler(event, {})
        _, body = parse_response(result)
        assert body['schedule'] == 'cron(30 09 * * ? *)'

    def test_create_with_keywords_bakes_keyword_subset_into_target(self, handler_module):
        """A keyword subset is stored as direct keywords input for the workflow."""
        event = make_event('POST', body={
            'name': 'priority-daily',
            'frequency': 'daily',
            'time': '07:00',
            'keywords': ['best hotels malaga', 'boutique hotels madrid'],
        })
        result = handler_module.handler(event, {})
        status, body = parse_response(result)
        assert status == 201
        assert created_target_input() == {'keywords': ['best hotels malaga', 'boutique hotels madrid']}
        assert body['keywords'] == ['best hotels malaga', 'boutique hotels madrid']

    def test_create_with_keywords_notes_scope_in_description(self, handler_module):
        """The schedule description reflects the keyword scope."""
        event = make_event('POST', body={
            'name': 'priority-daily',
            'keywords': ['best hotels malaga'],
        })
        handler_module.handler(event, {})
        kwargs = mock_scheduler.create_schedule.call_args.kwargs
        assert '1 keyword(s)' in kwargs['Description']

    def test_create_strips_whitespace_and_drops_empty_keywords(self, handler_module):
        """Blank keyword entries are dropped and whitespace is trimmed."""
        event = make_event('POST', body={
            'name': 'trimmed',
            'keywords': ['  best hotels  ', '', '   '],
        })
        result = handler_module.handler(event, {})
        status, _ = parse_response(result)
        assert status == 201
        assert created_target_input() == {'keywords': ['best hotels']}

    def test_create_rejects_non_string_keywords(self, handler_module):
        """Keyword entries that are not strings return a validation error."""
        event = make_event('POST', body={'name': 'bad', 'keywords': ['ok', 42]})
        result = handler_module.handler(event, {})
        status, _ = parse_response(result)
        assert status == 400

    def test_create_rejects_more_than_100_keywords(self, handler_module):
        """Keyword subsets above the pipeline cap of 100 are rejected."""
        event = make_event('POST', body={'name': 'too-many', 'keywords': [f'kw-{i}' for i in range(101)]})
        result = handler_module.handler(event, {})
        status, _ = parse_response(result)
        assert status == 400

    def test_create_rejects_keyword_longer_than_500_chars(self, handler_module):
        """Keywords beyond 500 characters are rejected like the trigger API."""
        event = make_event('POST', body={'name': 'long', 'keywords': ['x' * 501]})
        result = handler_module.handler(event, {})
        status, _ = parse_response(result)
        assert status == 400

    def test_create_rejects_non_list_keywords(self, handler_module):
        """A keywords value that is not an array returns a validation error."""
        event = make_event('POST', body={'name': 'bad-type', 'keywords': 'hotels'})
        result = handler_module.handler(event, {})
        status, _ = parse_response(result)
        assert status == 400

    def test_create_weekly_schedule_uses_day_of_week(self, handler_module):
        """Weekly frequency builds a cron bound to the selected weekday."""
        event = make_event('POST', body={
            'name': 'weekly',
            'frequency': 'weekly',
            'time': '10:00',
            'day_of_week': 'FRI',
        })
        result = handler_module.handler(event, {})
        _, body = parse_response(result)
        assert body['schedule'] == 'cron(00 10 ? * FRI *)'

    def test_create_monthly_rejects_day_of_month_over_28(self, handler_module):
        """day_of_month beyond 28 is rejected to keep schedules valid every month."""
        event = make_event('POST', body={
            'name': 'monthly',
            'frequency': 'monthly',
            'day_of_month': '29',
        })
        result = handler_module.handler(event, {})
        status, _ = parse_response(result)
        assert status == 400

    def test_create_rejects_invalid_time_format(self, handler_module):
        """A time value that is not HH:MM returns a validation error."""
        event = make_event('POST', body={'name': 'bad-time', 'time': '9am'})
        result = handler_module.handler(event, {})
        status, _ = parse_response(result)
        assert status == 400

    def test_create_returns_409_when_name_exists(self, handler_module):
        """A duplicate schedule name maps to a 409 conflict."""
        mock_scheduler.create_schedule.side_effect = SchedulerConflict()
        event = make_event('POST', body={'name': 'daily-analysis'})
        result = handler_module.handler(event, {})
        status, body = parse_response(result)
        assert status == 409
        assert body['error'] == 'Schedule with this name already exists'


class TestListSchedules:
    """Tests for GET /api/schedules."""

    def test_list_exposes_keyword_subset_from_target_input(self, handler_module):
        """Keyword-linked schedules report their keywords."""
        mock_scheduler.list_schedules.return_value = {'Schedules': [{'Name': 'priority-daily'}]}
        mock_scheduler.get_schedule.return_value = {
            'Name': 'priority-daily',
            'ScheduleExpression': 'cron(0 7 * * ? *)',
            'State': 'ENABLED',
            'Target': {'Input': json.dumps({'keywords': ['best hotels malaga']})},
        }
        result = handler_module.handler(make_event('GET'), {})
        _, body = parse_response(result)
        assert body['schedules'][0]['keywords'] == ['best hotels malaga']

    def test_list_reports_empty_keywords_for_all_keyword_schedules(self, handler_module):
        """Schedules with the dynamodb source input report an empty subset."""
        mock_scheduler.list_schedules.return_value = {'Schedules': [{'Name': 'daily-analysis'}]}
        mock_scheduler.get_schedule.return_value = {
            'Name': 'daily-analysis',
            'ScheduleExpression': 'cron(0 9 * * ? *)',
            'State': 'ENABLED',
            'Target': {'Input': json.dumps({'source': 'dynamodb'})},
        }
        result = handler_module.handler(make_event('GET'), {})
        _, body = parse_response(result)
        assert body['schedules'][0]['keywords'] == []

    def test_list_reports_empty_keywords_when_target_input_is_invalid(self, handler_module):
        """Malformed target input degrades to an empty keyword subset."""
        mock_scheduler.list_schedules.return_value = {'Schedules': [{'Name': 'legacy'}]}
        mock_scheduler.get_schedule.return_value = {
            'Name': 'legacy',
            'ScheduleExpression': 'cron(0 9 * * ? *)',
            'State': 'ENABLED',
            'Target': {'Input': 'not-json'},
        }
        result = handler_module.handler(make_event('GET'), {})
        status, body = parse_response(result)
        assert status == 200
        assert body['schedules'][0]['keywords'] == []


class TestDeleteSchedule:
    """Tests for DELETE /api/schedules/{name}."""

    def test_delete_existing_schedule_succeeds(self, handler_module):
        """Deleting an existing schedule returns a success message."""
        event = make_event('DELETE', path_params={'name': 'daily-analysis'})
        result = handler_module.handler(event, {})
        status, body = parse_response(result)
        assert status == 200
        assert body['message'] == 'Schedule deleted successfully'

    def test_delete_missing_schedule_returns_404(self, handler_module):
        """Deleting an unknown schedule name returns 404."""
        mock_scheduler.delete_schedule.side_effect = SchedulerResourceNotFound()
        event = make_event('DELETE', path_params={'name': 'ghost'})
        result = handler_module.handler(event, {})
        status, _ = parse_response(result)
        assert status == 404
