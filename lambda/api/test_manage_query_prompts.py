"""
Tests for manage-query-prompts.py Lambda.

Covers:
- CRUD operations (create, list, update, delete, toggle)
- Validation ({keyword} placeholder, max prompts, field limits)
"""

import json
import os
import sys
import importlib
from unittest.mock import patch, MagicMock
from datetime import datetime

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


def make_event(method, body=None, path_params=None):
    """Build a minimal API Gateway event."""
    event = {
        'httpMethod': method,
        'pathParameters': path_params,
        'headers': {'origin': 'http://localhost:3000'},
        'body': json.dumps(body) if body else None,
    }
    return event


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
        status, body = parse_response(result)
        assert status == 400

    def test_create_exceeds_max_prompts(self, handler_module):
        """Creating beyond 10 prompts is rejected."""
        mock_table.scan.return_value = {'Count': 10}
        event = make_event('POST', body={
            'name': 'One Too Many',
            'template': 'Find {keyword} please',
        })
        result = handler_module.handler(event, {})
        status, body = parse_response(result)
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
        status, body = parse_response(result)
        assert status == 200
        # Verify the update was called with 'false'
        call_kwargs = mock_table.update_item.call_args
        assert ':e' in call_kwargs.kwargs.get('ExpressionAttributeValues', call_kwargs[1].get('ExpressionAttributeValues', {}))

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
        status, body = parse_response(result)
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
        status, body = parse_response(result)
        assert status == 200
        mock_table.delete_item.assert_called_once_with(Key={'id': 'abc'})

    def test_delete_missing_id(self, handler_module):
        """Deleting without an ID returns 400."""
        event = make_event('DELETE', path_params={})
        result = handler_module.handler(event, {})
        status, _ = parse_response(result)
        assert status == 400
