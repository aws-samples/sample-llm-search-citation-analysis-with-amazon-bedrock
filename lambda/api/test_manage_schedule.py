"""
Tests for manage-schedule.py Lambda (Schedules v2).

Covers:
- Creation: generated ``sch-<hex>`` ids, display name in Description, the v2
  descriptor in Target.Input, cron building, validation (time ranges, IANA
  timezones, day of month, scope, unknown group ids), conflict retry
- Listing and GET by id: v2 descriptors returned as stored, legacy inputs
  translated (``source: dynamodb`` → scope all; keyword texts → no scope),
  pagination
- Update: partial merge over the current definition, full-replace write,
  legacy keyword schedules require a scope
- Delete and run-now (execution input mirrors what EventBridge sends)
"""

import importlib.util
import json
import os
import sys
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest

# Make `from shared.xxx import` resolve (layer puts shared/ at /opt/python/shared/)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))  # lambda/


class SchedulerResourceNotFound(Exception):
    """Stands in for scheduler.exceptions.ResourceNotFoundException."""


class SchedulerConflict(Exception):
    """Stands in for scheduler.exceptions.ConflictException."""


class SchedulerValidation(Exception):
    """Stands in for scheduler.exceptions.ValidationException."""


mock_scheduler = MagicMock(name='scheduler')
mock_stepfunctions = MagicMock(name='stepfunctions')
mock_groups_table = MagicMock(name='groups_table')
mock_dynamodb = MagicMock(name='dynamodb')
mock_dynamodb.Table.return_value = mock_groups_table


def _mock_boto3_client(service, *args, **kwargs):
    return mock_stepfunctions if service == 'stepfunctions' else mock_scheduler


_handler_spec = importlib.util.spec_from_file_location(
    'manage_schedule',
    os.path.join(os.path.dirname(__file__), 'manage-schedule.py')
)
_handler_mod = importlib.util.module_from_spec(_handler_spec)

_test_env = {
    'STATE_MACHINE_ARN': 'arn:aws:states:us-east-1:123456789012:stateMachine:test',
    'SCHEDULE_ROLE_ARN': 'arn:aws:iam::123456789012:role/test-scheduler-role',
    'DYNAMODB_TABLE_KEYWORD_GROUPS': 'test-keyword-groups',
    'CORS_ORIGIN_PARAM': '',
}

with (
    patch('boto3.client', side_effect=_mock_boto3_client),
    patch('boto3.resource', return_value=mock_dynamodb),
    patch.dict(os.environ, _test_env),
):
    _handler_spec.loader.exec_module(_handler_mod)

GROUP_ID = 'a3f9c2d1-0000-4000-8000-000000000001'
STATE_MACHINE_ARN = _test_env['STATE_MACHINE_ARN']


def make_event(method, body=None, path_params=None, groups='Admin', path='/api/schedules'):
    """Build a minimal API Gateway event; defaults to an Admin caller."""
    claims = {'cognito:username': 'admin@example.com', 'email': 'admin@example.com'}
    if groups is not None:
        claims['cognito:groups'] = groups
    return {
        'httpMethod': method,
        'path': path,
        'resource': path,
        'pathParameters': path_params,
        'headers': {'origin': 'http://localhost:3000'},
        'body': json.dumps(body) if body is not None else None,
        'requestContext': {'authorizer': {'claims': claims}},
    }


def id_event(method, schedule_id, body=None, suffix=''):
    return make_event(method, body=body, path_params={'id': schedule_id}, path=f'/api/schedules/{schedule_id}{suffix}')


def parse_response(result):
    status = result.get('statusCode', 200)
    body = json.loads(result['body']) if isinstance(result.get('body'), str) else result.get('body', {})
    return status, body


def created_kwargs():
    return mock_scheduler.create_schedule.call_args.kwargs


def created_target_input():
    return json.loads(created_kwargs()['Target']['Input'])


def v2_detail(schedule_id='sch-1a2b3c4d', display_name='Hotel Coruña — weekly', scope=None, form=None, state='ENABLED'):
    """A GetSchedule response for a v2 schedule."""
    form = form or {'frequency': 'weekly', 'time': '09:00', 'timezone': 'Europe/Madrid', 'day_of_week': 'MON', 'day_of_month': 1}
    scope = scope or {'mode': 'groups', 'group_ids': [GROUP_ID]}
    return {
        'Name': schedule_id,
        'Description': display_name,
        'ScheduleExpression': _handler_mod.build_cron(form),
        'ScheduleExpressionTimezone': form['timezone'],
        'State': state,
        'CreationDate': datetime(2026, 9, 18, 10, 0, tzinfo=UTC),
        'LastModificationDate': datetime(2026, 9, 18, 11, 0, tzinfo=UTC),
        'Target': {
            'Arn': STATE_MACHINE_ARN,
            'RoleArn': _test_env['SCHEDULE_ROLE_ARN'],
            'Input': json.dumps({'schedule_id': schedule_id, 'display_name': display_name, 'form': form, 'scope': scope}),
        },
    }


def legacy_detail(name, target_input, expression='cron(0 9 * * ? *)'):
    return {
        'Name': name,
        'Description': 'Automated daily citation analysis (all keywords)',
        'ScheduleExpression': expression,
        'ScheduleExpressionTimezone': 'UTC',
        'State': 'ENABLED',
        'Target': {'Arn': STATE_MACHINE_ARN, 'Input': target_input},
    }


@pytest.fixture(autouse=True)
def _reset_mocks():
    mock_scheduler.reset_mock()
    mock_stepfunctions.reset_mock()
    mock_groups_table.reset_mock()
    mock_scheduler.exceptions.ResourceNotFoundException = SchedulerResourceNotFound
    mock_scheduler.exceptions.ConflictException = SchedulerConflict
    mock_scheduler.exceptions.ValidationException = SchedulerValidation
    # reset_mock() keeps side effects; clear them so one test's failure mode
    # cannot leak into the next.
    for method in (
        mock_scheduler.get_schedule_group, mock_scheduler.create_schedule, mock_scheduler.update_schedule,
        mock_scheduler.delete_schedule, mock_scheduler.list_schedules, mock_scheduler.get_schedule,
        mock_stepfunctions.start_execution, mock_groups_table.get_item,
    ):
        method.side_effect = None
    mock_scheduler.get_schedule_group.return_value = {'Name': 'citation-analysis-schedules'}
    mock_scheduler.create_schedule.return_value = {}
    mock_scheduler.update_schedule.return_value = {}
    mock_scheduler.delete_schedule.return_value = {}
    mock_scheduler.list_schedules.return_value = {'Schedules': []}
    mock_scheduler.get_schedule.return_value = v2_detail()
    mock_groups_table.get_item.return_value = {'Item': {'id': GROUP_ID, 'name': 'Hotel Coruña'}}
    mock_stepfunctions.start_execution.return_value = {'executionArn': 'arn:aws:states:us-east-1:123456789012:execution:test:run-1'}


@pytest.fixture()
def handler_module():
    _handler_mod.scheduler = mock_scheduler
    _handler_mod.stepfunctions = mock_stepfunctions
    _handler_mod.dynamodb = mock_dynamodb
    yield _handler_mod


class TestFormValidation:
    def test_normalises_time_and_day_fields(self, handler_module):
        form, error, _ = handler_module.validate_form({'frequency': 'Weekly', 'time': '9:05', 'day_of_week': 'fri', 'day_of_month': '7'})

        assert error is None
        assert form == {'frequency': 'weekly', 'time': '09:05', 'timezone': 'UTC', 'day_of_week': 'FRI', 'day_of_month': 7}

    @pytest.mark.parametrize('time', ['9am', '24:00', '12:60', '', '1:2'])
    def test_rejects_times_outside_the_clock(self, handler_module, time):
        _, error, field = handler_module.validate_form({'time': time})

        assert field == 'time'
        assert error is not None

    def test_rejects_an_unknown_timezone(self, handler_module):
        _, error, field = handler_module.validate_form({'timezone': 'Mars/Olympus_Mons'})

        assert field == 'timezone'
        assert 'Unknown timezone' in error

    def test_accepts_europe_madrid(self, handler_module):
        form, error, _ = handler_module.validate_form({'timezone': 'Europe/Madrid'})

        assert error is None
        assert form['timezone'] == 'Europe/Madrid'

    @pytest.mark.parametrize('day', ['0', '29', '31', 'first'])
    def test_rejects_days_of_month_that_not_every_month_has(self, handler_module, day):
        _, error, field = handler_module.validate_form({'frequency': 'monthly', 'day_of_month': day})

        assert field == 'day_of_month'
        assert error is not None

    def test_partial_update_keeps_the_base_values_it_does_not_mention(self, handler_module):
        base = {'frequency': 'weekly', 'time': '09:00', 'timezone': 'Europe/Madrid', 'day_of_week': 'MON', 'day_of_month': 1}

        form, error, _ = handler_module.validate_form({'time': '18:30'}, base=base)

        assert error is None
        assert form == {**base, 'time': '18:30'}


class TestCron:
    @pytest.mark.parametrize(('form', 'expected'), [
        ({'frequency': 'daily', 'time': '09:30', 'day_of_week': 'MON', 'day_of_month': 1}, 'cron(30 9 * * ? *)'),
        ({'frequency': 'weekly', 'time': '10:00', 'day_of_week': 'FRI', 'day_of_month': 1}, 'cron(0 10 ? * FRI *)'),
        ({'frequency': 'monthly', 'time': '00:05', 'day_of_week': 'MON', 'day_of_month': 15}, 'cron(5 0 15 * ? *)'),
    ])
    def test_builds_the_expression_for_each_frequency(self, handler_module, form, expected):
        assert handler_module.build_cron(form) == expected

    @pytest.mark.parametrize(('expression', 'expected'), [
        ('cron(30 09 * * ? *)', {'frequency': 'daily', 'time': '09:30', 'day_of_week': 'MON', 'day_of_month': 1}),
        ('cron(0 10 ? * FRI *)', {'frequency': 'weekly', 'time': '10:00', 'day_of_week': 'FRI', 'day_of_month': 1}),
        ('cron(5 0 15 * ? *)', {'frequency': 'monthly', 'time': '00:05', 'day_of_week': 'MON', 'day_of_month': 15}),
    ])
    def test_recovers_the_form_from_a_generated_expression(self, handler_module, expression, expected):
        assert handler_module.parse_cron(expression, 'Europe/London') == {**expected, 'timezone': 'Europe/London'}

    def test_returns_none_for_a_hand_written_expression(self, handler_module):
        assert handler_module.parse_cron('rate(2 hours)', 'UTC') is None


class TestCreateSchedule:
    """Tests for POST /api/schedules."""

    def _create(self, handler_module, body):
        return parse_response(handler_module.handler(make_event('POST', body=body), {}))

    def test_generates_an_sch_id_and_stores_the_display_name_in_the_description(self, handler_module):
        status, body = self._create(handler_module, {'display_name': 'Hotel Coruña — weekly', 'frequency': 'weekly', 'time': '09:00', 'day_of_week': 'MON'})

        assert status == 201
        assert body['id'].startswith('sch-') and len(body['id']) == 12
        assert created_kwargs()['Name'] == body['id']
        assert created_kwargs()['Description'] == 'Hotel Coruña — weekly'
        assert body['display_name'] == 'Hotel Coruña — weekly'

    def test_bakes_the_v2_descriptor_into_the_target_input(self, handler_module):
        _, body = self._create(handler_module, {
            'display_name': 'Coruña', 'frequency': 'weekly', 'time': '09:00', 'timezone': 'Europe/Madrid', 'day_of_week': 'MON',
            'scope': {'mode': 'groups', 'group_ids': [GROUP_ID]},
        })

        assert created_target_input() == {
            'schedule_id': body['id'],
            'display_name': 'Coruña',
            'form': {'frequency': 'weekly', 'time': '09:00', 'timezone': 'Europe/Madrid', 'day_of_week': 'MON', 'day_of_month': 1},
            'scope': {'mode': 'groups', 'group_ids': [GROUP_ID]},
        }

    def test_defaults_to_all_keywords_and_a_daily_nine_oclock_utc_run(self, handler_module):
        status, body = self._create(handler_module, {})

        assert status == 201
        assert created_target_input()['scope'] == {'mode': 'all'}
        assert created_kwargs()['ScheduleExpression'] == 'cron(0 9 * * ? *)'
        assert created_kwargs()['ScheduleExpressionTimezone'] == 'UTC'
        assert body['display_name'] == 'Scheduled analysis'

    def test_targets_the_state_machine_through_the_scheduler_role(self, handler_module):
        self._create(handler_module, {})

        target = created_kwargs()['Target']
        assert (target['Arn'], target['RoleArn']) == (STATE_MACHINE_ARN, _test_env['SCHEDULE_ROLE_ARN'])
        assert created_kwargs()['FlexibleTimeWindow'] == {'Mode': 'OFF'}

    def test_accepts_the_form_nested_under_form(self, handler_module):
        self._create(handler_module, {'form': {'frequency': 'monthly', 'time': '07:15', 'day_of_month': 3}})

        assert created_kwargs()['ScheduleExpression'] == 'cron(15 7 3 * ? *)'

    def test_disabled_schedules_are_created_disabled(self, handler_module):
        _, body = self._create(handler_module, {'enabled': False})

        assert created_kwargs()['State'] == 'DISABLED'
        assert (body['state'], body['enabled']) == ('DISABLED', False)

    def test_describes_the_scope_in_the_response(self, handler_module):
        _, body = self._create(handler_module, {'scope': {'mode': 'groups', 'group_ids': [GROUP_ID]}})

        assert body['scope_summary'] == '1 group(s)'
        assert body['legacy'] is False

    def test_rejects_the_retired_keywords_field(self, handler_module):
        status, body = self._create(handler_module, {'keywords': ['best hotels malaga']})

        assert status == 400
        assert body['field'] == 'keywords'
        mock_scheduler.create_schedule.assert_not_called()

    def test_rejects_a_scope_naming_an_unknown_group(self, handler_module):
        mock_groups_table.get_item.return_value = {}

        status, body = self._create(handler_module, {'scope': {'mode': 'groups', 'group_ids': ['missing-group']}})

        assert status == 400
        assert 'missing-group' in body['error']
        mock_scheduler.create_schedule.assert_not_called()

    def test_rejects_a_malformed_scope(self, handler_module):
        status, body = self._create(handler_module, {'scope': {'mode': 'keywords', 'keyword_ids': []}})

        assert status == 400
        assert body['field'] == 'scope'

    @pytest.mark.parametrize(('body', 'field'), [
        ({'time': '9am'}, 'time'),
        ({'time': '25:00'}, 'time'),
        ({'timezone': 'Nowhere/Land'}, 'timezone'),
        ({'frequency': 'monthly', 'day_of_month': '29'}, 'day_of_month'),
        ({'frequency': 'hourly'}, 'frequency'),
        ({'day_of_week': 'FUNDAY'}, 'day_of_week'),
        ({'display_name': ''}, 'display_name'),
        ({'display_name': 'x' * 101}, 'display_name'),
        ({'enabled': 'maybe'}, 'enabled'),
    ])
    def test_rejects_invalid_fields_with_the_offending_field_named(self, handler_module, body, field):
        status, response = self._create(handler_module, body)

        assert status == 400
        assert response['field'] == field
        mock_scheduler.create_schedule.assert_not_called()

    def test_retries_with_a_fresh_id_on_a_name_collision(self, handler_module):
        mock_scheduler.create_schedule.side_effect = [SchedulerConflict(), {}]

        status, body = self._create(handler_module, {})

        assert status == 201
        names = [call.kwargs['Name'] for call in mock_scheduler.create_schedule.call_args_list]
        assert len(names) == 2 and names[0] != names[1]
        assert body['id'] == names[1]

    def test_maps_a_scheduler_validation_error_to_400(self, handler_module):
        mock_scheduler.create_schedule.side_effect = SchedulerValidation('Invalid Schedule Expression')

        status, body = self._create(handler_module, {})

        assert status == 400
        assert 'Invalid Schedule Expression' in body['error']

    def test_denies_non_admins_before_touching_the_scheduler(self, handler_module):
        status, _ = parse_response(handler_module.handler(make_event('POST', body={}, groups='Users'), {}))

        assert status == 403
        assert mock_scheduler.method_calls == []


class TestListSchedules:
    """Tests for GET /api/schedules."""

    def _list(self, handler_module):
        return parse_response(handler_module.handler(make_event('GET'), {}))

    def test_returns_v2_schedules_with_their_descriptor(self, handler_module):
        mock_scheduler.list_schedules.return_value = {'Schedules': [{'Name': 'sch-1a2b3c4d'}]}

        _, body = self._list(handler_module)

        item = body['schedules'][0]
        assert (item['id'], item['display_name'], item['legacy']) == ('sch-1a2b3c4d', 'Hotel Coruña — weekly', False)
        assert item['form']['frequency'] == 'weekly'
        assert item['scope'] == {'mode': 'groups', 'group_ids': [GROUP_ID]}
        assert (item['created_at'], item['updated_at']) == ('2026-09-18T10:00:00+00:00', '2026-09-18T11:00:00+00:00')

    def test_translates_a_legacy_all_keywords_schedule(self, handler_module):
        mock_scheduler.list_schedules.return_value = {'Schedules': [{'Name': 'daily-analysis'}]}
        mock_scheduler.get_schedule.return_value = legacy_detail('daily-analysis', json.dumps({'source': 'dynamodb'}))

        _, body = self._list(handler_module)

        item = body['schedules'][0]
        assert (item['legacy'], item['display_name'], item['scope']) == (True, 'daily-analysis', {'mode': 'all'})
        assert item['form'] == {'frequency': 'daily', 'time': '09:00', 'timezone': 'UTC', 'day_of_week': 'MON', 'day_of_month': 1}

    def test_translates_a_legacy_keyword_text_schedule_without_inventing_a_scope(self, handler_module):
        mock_scheduler.list_schedules.return_value = {'Schedules': [{'Name': 'priority-daily'}]}
        mock_scheduler.get_schedule.return_value = legacy_detail(
            'priority-daily', json.dumps({'keywords': ['best hotels malaga']}), 'cron(0 7 ? * FRI *)'
        )

        _, body = self._list(handler_module)

        item = body['schedules'][0]
        assert item['scope'] is None
        assert item['keywords'] == ['best hotels malaga']
        assert item['scope_summary'] == '1 keyword(s)'
        assert item['form']['frequency'] == 'weekly'

    def test_tolerates_malformed_target_input(self, handler_module):
        mock_scheduler.list_schedules.return_value = {'Schedules': [{'Name': 'legacy'}]}
        mock_scheduler.get_schedule.return_value = legacy_detail('legacy', 'not-json')

        status, body = self._list(handler_module)

        assert status == 200
        assert (body['schedules'][0]['legacy'], body['schedules'][0]['scope']) == (True, None)

    def test_follows_pagination_tokens(self, handler_module):
        mock_scheduler.list_schedules.side_effect = [
            {'Schedules': [{'Name': 'sch-1'}], 'NextToken': 'page-2'},
            {'Schedules': [{'Name': 'sch-2'}]},
        ]

        _, body = self._list(handler_module)

        assert body['count'] == 2
        assert mock_scheduler.list_schedules.call_args_list[1].kwargs['NextToken'] == 'page-2'

    def test_skips_schedules_deleted_between_list_and_get(self, handler_module):
        mock_scheduler.list_schedules.return_value = {'Schedules': [{'Name': 'gone'}]}
        mock_scheduler.get_schedule.side_effect = SchedulerResourceNotFound()

        status, body = self._list(handler_module)

        assert status == 200
        assert body['schedules'] == []


class TestGetSchedule:
    def test_returns_one_schedule_by_id(self, handler_module):
        status, body = parse_response(handler_module.handler(id_event('GET', 'sch-1a2b3c4d'), {}))

        assert status == 200
        assert body['id'] == 'sch-1a2b3c4d'
        mock_scheduler.get_schedule.assert_called_once_with(Name='sch-1a2b3c4d', GroupName='citation-analysis-schedules')

    def test_returns_404_for_an_unknown_id(self, handler_module):
        mock_scheduler.get_schedule.side_effect = SchedulerResourceNotFound()

        status, _ = parse_response(handler_module.handler(id_event('GET', 'sch-missing'), {}))

        assert status == 404


class TestUpdateSchedule:
    """Tests for PUT /api/schedules/{id}."""

    def _update(self, handler_module, body, schedule_id='sch-1a2b3c4d'):
        return parse_response(handler_module.handler(id_event('PUT', schedule_id, body=body), {}))

    def test_replaces_the_whole_definition_keeping_unmentioned_fields(self, handler_module):
        status, body = self._update(handler_module, {'time': '18:30', 'enabled': False})

        assert status == 200
        kwargs = mock_scheduler.update_schedule.call_args.kwargs
        assert kwargs['Name'] == 'sch-1a2b3c4d'
        assert kwargs['ScheduleExpression'] == 'cron(30 18 ? * MON *)'
        assert kwargs['ScheduleExpressionTimezone'] == 'Europe/Madrid'
        assert kwargs['State'] == 'DISABLED'
        assert kwargs['Description'] == 'Hotel Coruña — weekly'
        assert json.loads(kwargs['Target']['Input'])['scope'] == {'mode': 'groups', 'group_ids': [GROUP_ID]}
        assert body['form']['time'] == '18:30'

    def test_renames_and_rescopes(self, handler_module):
        _, body = self._update(handler_module, {'display_name': 'All hotels', 'scope': {'mode': 'all'}})

        kwargs = mock_scheduler.update_schedule.call_args.kwargs
        assert kwargs['Description'] == 'All hotels'
        assert json.loads(kwargs['Target']['Input'])['display_name'] == 'All hotels'
        assert body['scope'] == {'mode': 'all'}

    def test_writes_the_full_target_on_update(self, handler_module):
        """UpdateSchedule is a full replace: Arn and RoleArn must be resent."""
        self._update(handler_module, {'time': '10:00'})

        target = mock_scheduler.update_schedule.call_args.kwargs['Target']
        assert (target['Arn'], target['RoleArn']) == (STATE_MACHINE_ARN, _test_env['SCHEDULE_ROLE_ARN'])

    def test_upgrades_a_legacy_all_keywords_schedule_to_v2_under_the_same_name(self, handler_module):
        mock_scheduler.get_schedule.return_value = legacy_detail('daily-analysis', json.dumps({'source': 'dynamodb'}))

        status, body = self._update(handler_module, {'display_name': 'Daily — all hotels'}, schedule_id='daily-analysis')

        assert status == 200
        kwargs = mock_scheduler.update_schedule.call_args.kwargs
        assert kwargs['Name'] == 'daily-analysis'
        assert json.loads(kwargs['Target']['Input']) == {
            'schedule_id': 'daily-analysis',
            'display_name': 'Daily — all hotels',
            'form': {'frequency': 'daily', 'time': '09:00', 'timezone': 'UTC', 'day_of_week': 'MON', 'day_of_month': 1},
            'scope': {'mode': 'all'},
        }
        assert body['legacy'] is False

    def test_requires_a_scope_to_edit_a_legacy_keyword_text_schedule(self, handler_module):
        mock_scheduler.get_schedule.return_value = legacy_detail('priority-daily', json.dumps({'keywords': ['best hotels']}))

        status, body = self._update(handler_module, {'time': '10:00'}, schedule_id='priority-daily')

        assert status == 400
        assert body['field'] == 'scope'
        mock_scheduler.update_schedule.assert_not_called()

    def test_returns_404_for_an_unknown_id(self, handler_module):
        mock_scheduler.get_schedule.side_effect = SchedulerResourceNotFound()

        status, _ = self._update(handler_module, {'time': '10:00'}, schedule_id='sch-missing')

        assert status == 404
        mock_scheduler.update_schedule.assert_not_called()

    def test_rejects_invalid_fields_without_writing(self, handler_module):
        status, body = self._update(handler_module, {'time': '99:00'})

        assert status == 400
        assert body['field'] == 'time'
        mock_scheduler.update_schedule.assert_not_called()

    def test_denies_non_admins_before_touching_the_scheduler(self, handler_module):
        event = id_event('PUT', 'sch-1a2b3c4d', body={'time': '10:00'})
        event['requestContext']['authorizer']['claims']['cognito:groups'] = 'Users'

        status, _ = parse_response(handler_module.handler(event, {}))

        assert status == 403
        assert mock_scheduler.method_calls == []


class TestDeleteSchedule:
    def test_deletes_by_id(self, handler_module):
        status, body = parse_response(handler_module.handler(id_event('DELETE', 'sch-1a2b3c4d'), {}))

        assert status == 200
        assert body['message'] == 'Schedule deleted successfully'
        mock_scheduler.delete_schedule.assert_called_once_with(Name='sch-1a2b3c4d', GroupName='citation-analysis-schedules')

    def test_returns_404_for_an_unknown_id(self, handler_module):
        mock_scheduler.delete_schedule.side_effect = SchedulerResourceNotFound()

        status, _ = parse_response(handler_module.handler(id_event('DELETE', 'sch-missing'), {}))

        assert status == 404

    def test_still_accepts_the_legacy_name_path_parameter(self, handler_module):
        event = make_event('DELETE', path_params={'name': 'daily-analysis'}, path='/api/schedules/daily-analysis')

        status, _ = parse_response(handler_module.handler(event, {}))

        assert status == 200
        mock_scheduler.delete_schedule.assert_called_once_with(Name='daily-analysis', GroupName='citation-analysis-schedules')


class TestRunNow:
    """Tests for POST /api/schedules/{id}/run."""

    def _run(self, handler_module, schedule_id='sch-1a2b3c4d'):
        return parse_response(handler_module.handler(id_event('POST', schedule_id, body={}, suffix='/run'), {}))

    def test_starts_an_execution_with_the_schedules_scope(self, handler_module):
        status, body = self._run(handler_module)

        assert status == 202
        kwargs = mock_stepfunctions.start_execution.call_args.kwargs
        assert kwargs['stateMachineArn'] == STATE_MACHINE_ARN
        assert kwargs['name'].startswith('schedule-run-')
        payload = json.loads(kwargs['input'])
        assert payload['scope'] == {'mode': 'groups', 'group_ids': [GROUP_ID]}
        assert (payload['schedule_id'], payload['triggered_by']) == ('sch-1a2b3c4d', 'schedule-run-now')
        assert body['execution_name'] == kwargs['name']

    def test_runs_a_legacy_keyword_text_schedule_with_its_keywords(self, handler_module):
        mock_scheduler.get_schedule.return_value = legacy_detail('priority-daily', json.dumps({'keywords': ['best hotels']}))

        status, _ = self._run(handler_module, 'priority-daily')

        assert status == 202
        assert json.loads(mock_stepfunctions.start_execution.call_args.kwargs['input'])['keywords'] == ['best hotels']

    def test_runs_a_legacy_all_keywords_schedule_with_scope_all(self, handler_module):
        mock_scheduler.get_schedule.return_value = legacy_detail('daily-analysis', json.dumps({'source': 'dynamodb'}))

        self._run(handler_module, 'daily-analysis')

        assert json.loads(mock_stepfunctions.start_execution.call_args.kwargs['input'])['scope'] == {'mode': 'all'}

    def test_refuses_a_schedule_with_no_usable_scope(self, handler_module):
        mock_scheduler.get_schedule.return_value = legacy_detail('broken', 'not-json')

        status, body = self._run(handler_module, 'broken')

        assert status == 400
        assert body['field'] == 'scope'
        mock_stepfunctions.start_execution.assert_not_called()

    def test_returns_404_for_an_unknown_id(self, handler_module):
        mock_scheduler.get_schedule.side_effect = SchedulerResourceNotFound()

        status, _ = self._run(handler_module, 'sch-missing')

        assert status == 404
        mock_stepfunctions.start_execution.assert_not_called()

    def test_denies_non_admins_before_touching_aws(self, handler_module):
        event = id_event('POST', 'sch-1a2b3c4d', body={}, suffix='/run')
        event['requestContext']['authorizer']['claims']['cognito:groups'] = 'Users'

        status, _ = parse_response(handler_module.handler(event, {}))

        assert status == 403
        assert mock_scheduler.method_calls == []
        assert mock_stepfunctions.method_calls == []
