"""
Tests for the `group_ids` handling added to manage-keywords.py.

Loads the handler with the groups table configured so membership can be set on
create and update; the identity/rename behaviour is covered by
test_manage_keywords_identity.py.
"""

import os
from unittest.mock import MagicMock, patch

import pytest

from testing.dynamodb_stubs import fake_dynamodb_resource
from testing.env import KEYWORDS_TABLE_ENV
from testing.events import api_gateway_event, parse_response
from testing.module_loader import load_handler_module

mock_keywords_table = MagicMock()
mock_groups_table = MagicMock()
mock_dynamodb = fake_dynamodb_resource(mock_keywords_table, by_name={'test-groups': mock_groups_table})

# The identity suite loads the same handler without a groups table; here the
# table is configured so membership can be set on create and update.
with patch('boto3.resource', return_value=mock_dynamodb), patch.dict(os.environ, {
    **KEYWORDS_TABLE_ENV,
    'DYNAMODB_TABLE_KEYWORD_GROUPS': 'test-groups',
    'CORS_ORIGIN_PARAM': '',
}):
    _mod = load_handler_module(os.path.dirname(__file__), 'manage-keywords.py', 'manage_keywords_with_groups')


def make_event(method, body, path_params=None):
    path = '/api/keywords' if not path_params else f"/api/keywords/{path_params['id']}"
    return api_gateway_event(
        method, path, body=body, path_params=path_params,
        claims={'cognito:username': 'user@example.com'},
    )


def _groups_exist(*ids):
    mock_groups_table.get_item.side_effect = lambda Key: {'Item': {'id': Key['id']}} if Key['id'] in ids else {}


@pytest.fixture(autouse=True)
def _reset_mocks():
    mock_keywords_table.reset_mock(side_effect=True, return_value=True)
    mock_groups_table.reset_mock(side_effect=True, return_value=True)
    # No pre-existing keywords: the identity scan is empty and puts succeed.
    mock_keywords_table.scan.return_value = {'Items': []}
    mock_keywords_table.put_item.return_value = {}
    mock_groups_table.get_item.return_value = {}


class TestCreateWithGroups:
    def test_stores_memberships_as_a_string_set_and_returns_them_as_a_sorted_list(self):
        _groups_exist('g1', 'g2')

        status, body = parse_response(_mod.handler(make_event('POST', {'keyword': 'hotel coruña', 'group_ids': ['g2', 'g1']}), None))

        assert status == 201
        assert body['group_ids'] == ['g1', 'g2']
        written = mock_keywords_table.put_item.call_args.kwargs['Item']
        assert written['group_ids'] == {'g1', 'g2'}

    def test_creates_without_memberships_when_group_ids_is_omitted(self):
        status, body = parse_response(_mod.handler(make_event('POST', {'keyword': 'hotel coruña'}), None))

        assert status == 201
        assert 'group_ids' not in body
        assert 'group_ids' not in mock_keywords_table.put_item.call_args.kwargs['Item']

    def test_rejects_unknown_group_ids_with_400_before_writing(self):
        _groups_exist('g1')

        status, body = parse_response(_mod.handler(make_event('POST', {'keyword': 'hotel coruña', 'group_ids': ['g1', 'ghost']}), None))

        assert status == 400
        assert body['error'] == 'Unknown keyword group ids: ghost'
        mock_keywords_table.put_item.assert_not_called()

    def test_rejects_a_non_array_group_ids_value(self):
        status, body = parse_response(_mod.handler(make_event('POST', {'keyword': 'hotel coruña', 'group_ids': 'g1'}), None))

        assert status == 400
        assert body['error'] == 'group_ids must be an array of strings'


class TestUpdateWithGroups:
    def _existing(self, text='hotel coruña'):
        mock_keywords_table.get_item.return_value = {'Item': {'id': 'k1', 'keyword': text}}
        mock_keywords_table.update_item.return_value = {'Attributes': {'id': 'k1', 'keyword': text, 'group_ids': {'g1'}}}

    def test_replaces_memberships_with_the_given_set(self):
        self._existing()
        _groups_exist('g1')

        status, body = parse_response(_mod.handler(make_event('PUT', {'keyword': 'hotel coruña', 'group_ids': ['g1']}, {'id': 'k1'}), None))

        assert status == 200
        assert body['group_ids'] == ['g1']
        kwargs = mock_keywords_table.update_item.call_args.kwargs
        assert 'group_ids = :g' in kwargs['UpdateExpression']
        assert kwargs['ExpressionAttributeValues'][':g'] == {'g1'}

    def test_clears_memberships_when_an_empty_list_is_sent(self):
        self._existing()
        mock_keywords_table.update_item.return_value = {'Attributes': {'id': 'k1', 'keyword': 'hotel coruña'}}

        status, body = parse_response(_mod.handler(make_event('PUT', {'keyword': 'hotel coruña', 'group_ids': []}, {'id': 'k1'}), None))

        assert status == 200
        assert 'group_ids' not in body
        kwargs = mock_keywords_table.update_item.call_args.kwargs
        assert kwargs['UpdateExpression'].endswith(' REMOVE group_ids')
        assert ':g' not in kwargs['ExpressionAttributeValues']

    def test_leaves_memberships_untouched_when_group_ids_is_omitted(self):
        self._existing()

        _mod.handler(make_event('PUT', {'keyword': 'hotel coruña'}, {'id': 'k1'}), None)

        expression = mock_keywords_table.update_item.call_args.kwargs['UpdateExpression']
        assert 'group_ids' not in expression
