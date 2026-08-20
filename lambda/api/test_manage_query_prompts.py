"""
Tests for manage-query-prompts.py Lambda.

Covers:
- CRUD operations (create, list, update, delete, toggle)
- Validation ({keyword} placeholder, max prompts, field limits)
"""

import importlib
import json
import os
import sys
from unittest.mock import MagicMock, patch

import pytest

# Mock shared modules before importing the handler
# The Lambda layer normally puts shared/ at /opt/python/shared/
# We need the parent of shared/ on the path so `from shared.xxx import` works
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))  # lambda/

# Mock the DynamoDB table at module level
mock_table = MagicMock()
mock_dynamodb = MagicMock()
mock_dynamodb.Table.return_value = mock_table

# Pre-patch boto3 before the handler module imports it
_original_boto3_resource = None

def _mock_boto3_resource(*args, **kwargs):
    return mock_dynamodb

# Import the handler module (has hyphens in filename)
import importlib.util

_handler_spec = importlib.util.spec_from_file_location(
    'manage_query_prompts',
    os.path.join(os.path.dirname(__file__), 'manage-query-prompts.py')
)
_handler_mod = importlib.util.module_from_spec(_handler_spec)

# Patch boto3.resource before exec_module runs module-level code
with patch('boto3.resource', side_effect=_mock_boto3_resource):
    with patch.dict(os.environ, {'QUERY_PROMPTS_TABLE': 'test-table', 'CORS_ORIGIN_PARAM': ''}):
        _handler_spec.loader.exec_module(_handler_mod)

# Point the module's table reference to our mock
_handler_mod.query_prompts_table = mock_table


def make_event(method, body=None, path_params=None, groups='Admin'):
    """Build a minimal API Gateway event.

    Defaults to an Admin caller because every mutating route now requires the
    group (AUDIT-2026-08-19 §0). Pass `groups=None` for an unauthorized caller.
    """
    claims = {'cognito:username': 'admin@example.com', 'email': 'admin@example.com'}
    if groups is not None:
        claims['cognito:groups'] = groups

    return {
        'httpMethod': method,
        'pathParameters': path_params,
        'headers': {'origin': 'http://localhost:3000'},
        'body': json.dumps(body) if body else None,
        'requestContext': {'authorizer': {'claims': claims}},
    }


def parse_response(result):
    """Extract status code and parsed body from Lambda response."""
    status = result.get('statusCode', 200)
    body = json.loads(result['body']) if isinstance(result.get('body'), str) else result.get('body', {})
    return status, body


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


@pytest.fixture()
def handler_module():
    """Provide the handler module with mocked DynamoDB."""
    _handler_mod.query_prompts_table = mock_table
    yield _handler_mod


class TestCreatePrompt:
    """Tests for POST /api/query-prompts."""

    def test_create_valid_prompt(self, handler_module):
        """Creating a prompt with valid name and template succeeds."""
        mock_table.scan.return_value = {'Count': 0}
        event = make_event('POST', body={
            'name': 'Family Traveler',
            'template': 'As a family traveler, find me {keyword}',
        })
        result = handler_module.handler(event, {})
        status, body = parse_response(result)
        assert status == 201
        assert body['name'] == 'Family Traveler'
        assert body['enabled'] == 'true'
        mock_table.put_item.assert_called_once()

    def test_create_missing_keyword_placeholder(self, handler_module):
        """Template without {keyword} is rejected."""
        mock_table.scan.return_value = {'Count': 0}
        event = make_event('POST', body={
            'name': 'Bad Prompt',
            'template': 'Find me the best hotels',
        })
        result = handler_module.handler(event, {})
        status, _ = parse_response(result)
        assert status == 400

    def test_create_exceeds_max_prompts(self, handler_module):
        """Creating beyond 10 prompts is rejected."""
        mock_table.scan.return_value = {'Count': 10}
        event = make_event('POST', body={
            'name': 'One Too Many',
            'template': 'Find {keyword} please',
        })
        result = handler_module.handler(event, {})
        status, _ = parse_response(result)
        assert status == 400


class TestListPrompts:
    """Tests for GET /api/query-prompts."""

    def test_list_returns_items(self, handler_module):
        """Listing prompts returns all items."""
        mock_table.scan.return_value = {
            'Items': [
                {'id': '1', 'name': 'A', 'template': '{keyword}', 'enabled': 'true', 'created_at': '2026-01-01T00:00:00Z'},
                {'id': '2', 'name': 'B', 'template': '{keyword}', 'enabled': 'false', 'created_at': '2026-01-02T00:00:00Z'},
            ]
        }
        event = make_event('GET')
        result = handler_module.handler(event, {})
        status, body = parse_response(result)
        assert status == 200
        assert len(body) == 2

    def test_list_empty(self, handler_module):
        """Listing with no prompts returns empty array."""
        mock_table.scan.return_value = {'Items': []}
        event = make_event('GET')
        result = handler_module.handler(event, {})
        status, body = parse_response(result)
        assert status == 200
        assert body == []


class TestTogglePrompt:
    """Tests for PATCH /api/query-prompts/{id}."""

    def test_toggle_enabled_to_disabled(self, handler_module):
        """Toggling an enabled prompt disables it."""
        mock_table.get_item.return_value = {
            'Item': {'id': 'abc', 'enabled': 'true'}
        }
        mock_table.update_item.return_value = {
            'Attributes': {'id': 'abc', 'enabled': 'false'}
        }
        event = make_event('PATCH', path_params={'id': 'abc'})
        result = handler_module.handler(event, {})
        status, _ = parse_response(result)
        assert status == 200
        # Verify the update was called with 'false'
        call_kwargs = mock_table.update_item.call_args
        assert ':e' in call_kwargs.kwargs.get('ExpressionAttributeValues', {})

    def test_toggle_disabled_to_enabled(self, handler_module):
        """Toggling a disabled prompt enables it."""
        mock_table.get_item.return_value = {
            'Item': {'id': 'abc', 'enabled': 'false'}
        }
        mock_table.update_item.return_value = {
            'Attributes': {'id': 'abc', 'enabled': 'true'}
        }
        event = make_event('PATCH', path_params={'id': 'abc'})
        result = handler_module.handler(event, {})
        status, _ = parse_response(result)
        assert status == 200

    def test_toggle_nonexistent_prompt(self, handler_module):
        """Toggling a prompt that doesn't exist returns 400."""
        mock_table.get_item.return_value = {'Item': None}
        event = make_event('PATCH', path_params={'id': 'nonexistent'})
        result = handler_module.handler(event, {})
        status, _ = parse_response(result)
        assert status == 400


class TestDeletePrompt:
    """Tests for DELETE /api/query-prompts/{id}."""

    def test_delete_prompt(self, handler_module):
        """Deleting a prompt succeeds."""
        event = make_event('DELETE', path_params={'id': 'abc'})
        result = handler_module.handler(event, {})
        status, _ = parse_response(result)
        assert status == 200
        mock_table.delete_item.assert_called_once_with(Key={'id': 'abc'})

    def test_delete_missing_id(self, handler_module):
        """Deleting without an ID returns 400."""
        event = make_event('DELETE', path_params={})
        result = handler_module.handler(event, {})
        status, _ = parse_response(result)
        assert status == 400


class TestQueryPromptAuthorization:
    """
    Admin gate on the mutating routes (AUDIT-2026-08-19 §0).

    Each enabled persona multiplies every analysis run's provider spend, so
    creating and toggling them is an administrative act. `list_prompts` stays
    open because the dashboard renders the active set for all users.
    """

    def test_creating_a_prompt_without_the_admin_group_returns_403(self, handler_module):
        event = make_event(
            'POST', body={'name': 'Persona', 'template': 'about {keyword}'}, groups='Users'
        )

        status, _ = parse_response(handler_module.handler(event, {}))

        assert status == 403

    def test_does_not_write_the_prompt_when_authorization_fails(self, handler_module):
        event = make_event(
            'POST', body={'name': 'Persona', 'template': 'about {keyword}'}, groups='Users'
        )

        handler_module.handler(event, {})

        assert mock_table.put_item.call_count == 0

    def test_updating_a_prompt_without_the_admin_group_returns_403(self, handler_module):
        event = make_event(
            'PUT', body={'name': 'Renamed'}, path_params={'id': 'abc'}, groups='Users'
        )

        status, _ = parse_response(handler_module.handler(event, {}))

        assert status == 403

    def test_deleting_a_prompt_without_the_admin_group_returns_403(self, handler_module):
        event = make_event('DELETE', path_params={'id': 'abc'}, groups='Users')

        status, _ = parse_response(handler_module.handler(event, {}))

        assert status == 403

    def test_does_not_delete_the_prompt_when_authorization_fails(self, handler_module):
        event = make_event('DELETE', path_params={'id': 'abc'}, groups='Users')

        handler_module.handler(event, {})

        assert mock_table.delete_item.call_count == 0

    def test_toggling_a_prompt_without_the_admin_group_returns_403(self, handler_module):
        event = make_event('PATCH', path_params={'id': 'abc'}, groups='Users')

        status, _ = parse_response(handler_module.handler(event, {}))

        assert status == 403

    def test_returns_403_when_the_groups_claim_is_absent(self, handler_module):
        """Fail closed: an invited user in no group is not an administrator."""
        event = make_event('DELETE', path_params={'id': 'abc'}, groups=None)

        status, _ = parse_response(handler_module.handler(event, {}))

        assert status == 403

    def test_listing_prompts_stays_open_to_non_admin_callers(self, handler_module):
        """The gate must not lock non-admins out of read-only dashboard data."""
        event = make_event('GET', groups='Users')

        status, _ = parse_response(handler_module.handler(event, {}))

        assert status == 200


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
        event = make_event('PUT', body={'name': 'Renamed'}, path_params={'id': 'abc'})

        result = handler_module.handler(event, {})
        status, body = parse_response(result)

        assert status == 200
        assert body['name'] == 'Renamed'

    def test_persists_the_update_against_the_path_id(self, handler_module):
        """The positional prompt_id has to survive the whole decorator stack."""
        event = make_event('PUT', body={'name': 'Renamed'}, path_params={'id': 'abc'})

        handler_module.handler(event, {})

        assert mock_table.update_item.call_args.kwargs['Key'] == {'id': 'abc'}

    def test_rejects_a_template_without_the_keyword_placeholder(self, handler_module):
        event = make_event(
            'PUT', body={'template': 'no placeholder here'}, path_params={'id': 'abc'}
        )

        status, body = parse_response(handler_module.handler(event, {}))

        assert status == 400
        assert body['field'] == 'template'

    def test_returns_400_when_the_path_id_is_missing(self, handler_module):
        event = make_event('PUT', body={'name': 'Renamed'}, path_params={})

        status, body = parse_response(handler_module.handler(event, {}))

        assert status == 400
        assert body['field'] == 'id'

    def test_does_not_write_when_the_path_id_is_missing(self, handler_module):
        event = make_event('PUT', body={'name': 'Renamed'}, path_params={})

        handler_module.handler(event, {})

        assert mock_table.update_item.call_count == 0


class TestTogglePromptAdminPath:
    """
    PATCH shares the positional-dispatch shape with PUT but has no
    `parse_json_body` in its stack, so it survived the bug. Pinned so a future
    body-parsing decorator on this route cannot reintroduce it silently.
    """

    def test_toggles_an_enabled_prompt_to_disabled(self, handler_module):
        mock_table.get_item.return_value = {'Item': {'id': 'abc', 'enabled': 'true'}}
        mock_table.update_item.return_value = {
            'Attributes': {'id': 'abc', 'enabled': 'false'}
        }
        event = make_event('PATCH', path_params={'id': 'abc'})

        status, body = parse_response(handler_module.handler(event, {}))

        assert status == 200
        assert body['enabled'] == 'false'

    def test_toggles_against_the_path_id(self, handler_module):
        mock_table.get_item.return_value = {'Item': {'id': 'abc', 'enabled': 'true'}}
        event = make_event('PATCH', path_params={'id': 'abc'})

        handler_module.handler(event, {})

        assert mock_table.update_item.call_args.kwargs['Key'] == {'id': 'abc'}
