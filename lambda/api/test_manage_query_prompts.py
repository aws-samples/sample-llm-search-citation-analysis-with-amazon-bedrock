"""
Tests for manage-query-prompts.py Lambda.

Covers:
- CRUD operations (create, list, update, delete, toggle)
- Validation ({keyword} placeholder, max prompts, field limits)
"""

import os
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from testing.admin_authz_fixtures import caller_event, invoke, status_of
from testing.dynamodb_stubs import fake_dynamodb_resource
from testing.module_loader import load_handler_module

# Mock the DynamoDB table at module level; boto3.resource is patched before
# the handler module's import-time code runs, so the module's table IS the mock.
mock_table = MagicMock()
mock_dynamodb = fake_dynamodb_resource(mock_table)

with patch('boto3.resource', return_value=mock_dynamodb):
    with patch.dict(os.environ, {'QUERY_PROMPTS_TABLE': 'test-table', 'CORS_ORIGIN_PARAM': ''}):
        _handler_mod = load_handler_module(os.path.dirname(__file__), 'manage-query-prompts.py', 'manage_query_prompts')

PERSONA = {'name': 'Persona', 'template': 'about {keyword}'}
RENAME = {'name': 'Renamed'}


def make_event(method, body=None, path_params=None, groups: str | None = 'Admin'):
    """Build a minimal API Gateway event.

    Defaults to an Admin caller because every mutating route now requires the
    group (AUDIT-2026-08-19 §0). Pass `groups=None` for an unauthorized caller.
    """
    return caller_event(method, '/api/query-prompts', body=body, path_params=path_params, groups=groups)


def prompt_event(method, body=None, groups: str | None = 'Admin'):
    """An event addressing prompt `abc`."""
    return make_event(method, body=body, path_params={'id': 'abc'}, groups=groups)


@pytest.fixture(autouse=True)
def _reset_mocks():
    """Reset mocks before each test."""
    mock_table.reset_mock()
    mock_table.scan.return_value = {'Items': [], 'Count': 0}
    mock_table.query.return_value = {'Items': []}
    mock_table.get_item.return_value = {'Item': None}
    mock_table.put_item.return_value = {}
    mock_table.update_item.return_value = {'Attributes': {}}
    mock_table.delete_item.return_value = {}


@pytest.fixture
def handler_module(monkeypatch):
    """Provide the handler module with mocked DynamoDB."""
    monkeypatch.setattr(_handler_mod, 'query_prompts_table', mock_table)
    return _handler_mod


def _stored_prompt(enabled, toggled_to=None):
    """Stage prompt `abc` as stored with `enabled`, and the row a toggle would return."""
    mock_table.get_item.return_value = {'Item': {'id': 'abc', 'enabled': enabled}}
    if toggled_to is not None:
        mock_table.update_item.return_value = {'Attributes': {'id': 'abc', 'enabled': toggled_to}}


class TestCreatePrompt:
    """Tests for POST /api/query-prompts."""

    def test_create_valid_prompt(self, handler_module):
        """Creating a prompt with valid name and template succeeds."""
        mock_table.scan.return_value = {'Count': 0}
        event = make_event('POST', body={
            'name': 'Family Traveler',
            'template': 'As a family traveler, find me {keyword}',
        })
        status, body = invoke(handler_module, event)
        assert status == 201
        assert body['name'] == 'Family Traveler'
        assert body['enabled'] == 'true'
        mock_table.put_item.assert_called_once()

    @pytest.mark.parametrize(('stored_count', 'body'), [
        pytest.param(0, {'name': 'Bad Prompt', 'template': 'Find me the best hotels'}, id='template-without-keyword-placeholder'),
        pytest.param(10, {'name': 'One Too Many', 'template': 'Find {keyword} please'}, id='more-than-ten-prompts'),
    ])
    def test_create_is_rejected_with_400(self, handler_module, stored_count, body):
        mock_table.scan.return_value = {'Count': stored_count}

        status, _ = invoke(handler_module, make_event('POST', body=body))

        assert status == 400

    @pytest.mark.parametrize(('body', 'field'), [
        pytest.param({'template': 'about {keyword}'}, 'name', id='name'),
        pytest.param({'name': 'Persona'}, 'template', id='template'),
    ])
    def test_create_without_a_required_field_returns_400_naming_it(self, handler_module, body, field):
        status, response = invoke(handler_module, make_event('POST', body=body))

        assert (status, response) == (400, {'error': f'Missing required field: {field}', 'field': field})
        assert mock_table.put_item.call_count == 0

    def test_create_stores_the_trimmed_name_template_and_description(self, handler_module, monkeypatch):
        monkeypatch.setattr(handler_module, 'uuid', SimpleNamespace(uuid4=lambda: 'prompt-1'))
        monkeypatch.setattr(handler_module, 'get_timestamp', lambda: '2026-10-03T12:00:00Z')
        event = make_event('POST', body={
            'name': '  Family Traveler  ',
            'template': '  As a family traveler, find me {keyword}  ',
            'description': '  Parents with young children  ',
        })

        handler_module.handler(event, {})

        mock_table.put_item.assert_called_once_with(Item={
            'id': 'prompt-1',
            'name': 'Family Traveler',
            'template': 'As a family traveler, find me {keyword}',
            'enabled': 'true',
            'created_at': '2026-10-03T12:00:00Z',
            'updated_at': '2026-10-03T12:00:00Z',
            'description': 'Parents with young children',
        })

    @pytest.mark.parametrize(('field', 'value', 'limit'), [
        pytest.param('name', 'n' * 101, 100, id='name'),
        pytest.param('template', '{keyword}' + 't' * 1992, 2000, id='template'),
        pytest.param('description', 'd' * 1001, 1000, id='description'),
    ])
    def test_create_rejects_a_field_one_character_over_its_limit(self, handler_module, field, value, limit):
        body = {**PERSONA, field: value}

        status, response = invoke(handler_module, make_event('POST', body=body))

        assert (status, response) == (400, {'error': f'{field} too long (max {limit} characters)', 'field': field})


class TestListPrompts:
    """Tests for GET /api/query-prompts."""

    @pytest.mark.parametrize(('items', 'expected_ids'), [
        pytest.param([
            {'id': '1', 'name': 'A', 'template': '{keyword}', 'enabled': 'true', 'created_at': '2026-01-01T00:00:00Z'},
            {'id': '2', 'name': 'B', 'template': '{keyword}', 'enabled': 'false', 'created_at': '2026-01-02T00:00:00Z'},
        ], ['2', '1'], id='all-prompts-newest-first'),
        pytest.param([], [], id='empty-array-without-prompts'),
    ])
    def test_list_returns_the_stored_prompts(self, handler_module, items, expected_ids):
        mock_table.scan.return_value = {'Items': items}

        status, body = invoke(handler_module, make_event('GET'))

        assert status == 200
        assert [prompt['id'] for prompt in body] == expected_ids


class TestTogglePrompt:
    """Tests for PATCH /api/query-prompts/{id}."""

    @pytest.mark.parametrize(('stored', 'toggled'), [
        pytest.param('true', 'false', id='enabled-to-disabled'),
        pytest.param('false', 'true', id='disabled-to-enabled'),
    ])
    def test_toggle_flips_the_stored_flag(self, handler_module, stored, toggled):
        _stored_prompt(stored, toggled_to=toggled)

        status, body = invoke(handler_module, prompt_event('PATCH'))

        assert (status, body['enabled']) == (200, toggled)
        assert ':e' in mock_table.update_item.call_args.kwargs['ExpressionAttributeValues']

    def test_toggle_nonexistent_prompt(self, handler_module):
        """Toggling a prompt that doesn't exist returns 400."""
        mock_table.get_item.return_value = {'Item': None}
        event = make_event('PATCH', path_params={'id': 'nonexistent'})
        status, _ = invoke(handler_module, event)
        assert status == 400


class TestDeletePrompt:
    """Tests for DELETE /api/query-prompts/{id}."""

    def test_delete_prompt(self, handler_module):
        """Deleting a prompt succeeds."""
        status, _ = invoke(handler_module, prompt_event('DELETE'))
        assert status == 200
        mock_table.delete_item.assert_called_once_with(Key={'id': 'abc'})

    def test_delete_missing_id(self, handler_module):
        """Deleting without an ID returns 400."""
        status, _ = invoke(handler_module, make_event('DELETE', path_params={}))
        assert status == 400


class TestQueryPromptAuthorization:
    """
    Admin gate on the mutating routes (AUDIT-2026-08-19 §0).

    Each enabled persona multiplies every analysis run's provider spend, so
    creating and toggling them is an administrative act. `list_prompts` stays
    open because the dashboard renders the active set for all users.
    """

    @pytest.mark.parametrize(('event', 'write'), [
        pytest.param(make_event('POST', body=PERSONA, groups='Users'), 'put_item', id='creating'),
        pytest.param(prompt_event('PUT', body=RENAME, groups='Users'), 'update_item', id='updating'),
        pytest.param(prompt_event('DELETE', groups='Users'), 'delete_item', id='deleting'),
        pytest.param(prompt_event('PATCH', groups='Users'), 'update_item', id='toggling'),
        # Fail closed: an invited user in no group is not an administrator.
        pytest.param(prompt_event('DELETE', groups=None), 'delete_item', id='deleting-without-a-groups-claim'),
    ])
    def test_mutating_a_prompt_without_the_admin_group_returns_403_before_writing(self, handler_module, event, write):
        status = status_of(handler_module, event)

        assert (status, getattr(mock_table, write).call_count) == (403, 0)

    def test_listing_prompts_stays_open_to_non_admin_callers(self, handler_module):
        """The gate must not lock non-admins out of read-only dashboard data."""
        assert status_of(handler_module, make_event('GET', groups='Users')) == 200


class TestUpdatePrompt:
    """
    Tests for PUT /api/query-prompts/{id}.

    REGRESSION: this route returned 500 for every caller, admins included. The
    handler dispatches `update_prompt(event, context, prompt_id)` positionally
    and `parse_json_body` dropped `*args`, so the call raised TypeError before
    reaching the body. There were no update tests, so the suite stayed green.
    See `lambda/shared/test_decorators.py` for the contract these depend on.
    """

    def test_renames_a_prompt(self, handler_module):
        mock_table.update_item.return_value = {
            'Attributes': {
                'id': 'abc',
                'name': 'Renamed',
                'template': 'about {keyword}',
            }
        }

        status, body = invoke(handler_module, prompt_event('PUT', body=RENAME))

        assert status == 200
        assert body['name'] == 'Renamed'

    @pytest.mark.parametrize(('event', 'field'), [
        pytest.param(prompt_event('PUT', body={'template': 'no placeholder here'}), 'template', id='template-without-keyword-placeholder'),
        pytest.param(make_event('PUT', body=RENAME, path_params={}), 'id', id='missing-path-id'),
    ])
    def test_returns_400_naming_the_invalid_field(self, handler_module, event, field):
        status, body = invoke(handler_module, event)

        assert status == 400
        assert body['field'] == field

    def test_does_not_write_when_the_path_id_is_missing(self, handler_module):
        handler_module.handler(make_event('PUT', body=RENAME, path_params={}), {})

        assert mock_table.update_item.call_count == 0


class TestPositionalPromptIdDispatch:
    """
    PUT and PATCH both receive the prompt id positionally. PATCH has no
    `parse_json_body` in its stack, so it survived the PUT bug; it is pinned
    here so a future body-parsing decorator on that route cannot reintroduce
    it silently. The positional prompt_id has to survive the whole decorator
    stack on both.
    """

    @pytest.mark.parametrize('event', [
        pytest.param(prompt_event('PUT', body=RENAME), id='update'),
        pytest.param(prompt_event('PATCH'), id='toggle'),
    ])
    def test_writes_against_the_path_id(self, handler_module, event):
        _stored_prompt('true')

        handler_module.handler(event, {})

        assert mock_table.update_item.call_args.kwargs['Key'] == {'id': 'abc'}
