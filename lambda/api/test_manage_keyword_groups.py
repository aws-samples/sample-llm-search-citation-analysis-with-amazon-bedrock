"""
Tests for manage-keyword-groups.py.

Covers the group CRUD routes, the uniqueness rule on names, detaching members
when a group is deleted, and the bulk membership route, all against mocked
DynamoDB tables.
"""

import os
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from testing.dynamodb_stubs import fake_dynamodb_resource
from testing.events import api_gateway_event, parse_response
from testing.module_loader import load_handler_module

mock_keywords_table = MagicMock()
mock_groups_table = MagicMock()
mock_dynamodb = fake_dynamodb_resource(mock_keywords_table, by_name={'test-groups': mock_groups_table})

with patch('boto3.resource', return_value=mock_dynamodb), patch.dict(os.environ, {
    'DYNAMODB_TABLE_KEYWORDS': 'test-keywords',
    'DYNAMODB_TABLE_KEYWORD_GROUPS': 'test-groups',
    'CORS_ORIGIN_PARAM': '',
}):
    _mod = load_handler_module(os.path.dirname(__file__), 'manage-keyword-groups.py', 'manage_keyword_groups')


def make_event(method, body=None, path_params=None, path='/api/keyword-groups'):
    return api_gateway_event(
        method, path, resource=path, body=body, path_params=path_params,
        claims={'cognito:username': 'user@example.com'},
    )


def _conditional_failure():
    return ClientError({'Error': {'Code': 'ConditionalCheckFailedException'}}, 'UpdateItem')


@pytest.fixture(autouse=True)
def _reset_mocks():
    mock_keywords_table.reset_mock(side_effect=True, return_value=True)
    mock_groups_table.reset_mock(side_effect=True, return_value=True)
    mock_keywords_table.scan.return_value = {'Items': []}
    mock_groups_table.scan.return_value = {'Items': []}
    mock_groups_table.get_item.return_value = {}


class TestListGroups:
    def test_returns_groups_sorted_by_name_with_member_counts(self):
        mock_groups_table.scan.return_value = {'Items': [
            {'id': 'g2', 'name': 'Marino', 'description': '', 'created_at': 't', 'updated_at': 't'},
            {'id': 'g1', 'name': 'coruna', 'description': 'Galicia', 'created_at': 't', 'updated_at': 't'},
        ]}
        mock_keywords_table.scan.return_value = {'Items': [
            {'group_ids': {'g1', 'g2'}},
            {'group_ids': {'g1'}},
            {},
        ]}

        status, body = parse_response(_mod.handler(make_event('GET'), None))

        assert status == 200
        assert body['count'] == 2
        assert [(g['name'], g['keyword_count']) for g in body['groups']] == [('coruna', 2), ('Marino', 1)]

    def test_returns_an_empty_list_when_no_groups_exist(self):
        status, body = parse_response(_mod.handler(make_event('GET'), None))

        assert status == 200
        assert body == {'groups': [], 'count': 0}


class TestCreateGroup:
    def test_creates_a_group_with_a_trimmed_name_and_returns_201(self):
        status, body = parse_response(_mod.handler(make_event('POST', {'name': '  Hotel  Coruña ', 'description': 'Galicia'}), None))

        assert status == 201
        assert body['name'] == 'Hotel Coruña'
        assert body['description'] == 'Galicia'
        assert body['keyword_count'] == 0
        written = mock_groups_table.put_item.call_args.kwargs['Item']
        assert written['name_key'] == 'hotel coruña'

    def test_rejects_a_duplicate_name_case_insensitively_with_409(self):
        mock_groups_table.scan.return_value = {'Items': [{'id': 'g1', 'name_key': 'hotel coruña'}]}

        status, body = parse_response(_mod.handler(make_event('POST', {'name': 'HOTEL CORUÑA'}), None))

        assert status == 409
        assert body['error'] == 'A keyword group with this name already exists'
        mock_groups_table.put_item.assert_not_called()

    def test_rejects_a_missing_name_with_400(self):
        status, body = parse_response(_mod.handler(make_event('POST', {'description': 'x'}), None))

        assert status == 400
        assert 'name' in body['error']

    def test_rejects_a_blank_name_with_400(self):
        status, body = parse_response(_mod.handler(make_event('POST', {'name': '   '}), None))

        assert status == 400
        assert body['error'] == 'name must not be empty'

    def test_rejects_a_name_over_100_characters(self):
        status, body = parse_response(_mod.handler(make_event('POST', {'name': 'x' * 101}), None))

        assert status == 400
        assert body['error'] == 'name exceeds maximum length of 100 characters'


class TestUpdateGroup:
    def test_renames_an_existing_group(self):
        mock_groups_table.get_item.return_value = {'Item': {'id': 'g1', 'name': 'Old', 'name_key': 'old'}}
        mock_groups_table.update_item.return_value = {'Attributes': {
            'id': 'g1', 'name': 'New Name', 'description': '', 'created_at': 't', 'updated_at': 't2',
        }}

        status, body = parse_response(_mod.handler(
            make_event('PUT', {'name': 'New Name'}, {'id': 'g1'}, path='/api/keyword-groups/g1'), None
        ))

        assert status == 200
        assert body['name'] == 'New Name'
        values = mock_groups_table.update_item.call_args.kwargs['ExpressionAttributeValues']
        assert 'New Name' in values.values()
        assert 'new name' in values.values()

    def test_returns_404_for_an_unknown_group(self):
        status, body = parse_response(_mod.handler(
            make_event('PUT', {'name': 'x'}, {'id': 'missing'}, path='/api/keyword-groups/missing'), None
        ))

        assert status == 404
        assert body['error'] == 'Keyword group not found'

    def test_rejects_renaming_onto_another_groups_name(self):
        mock_groups_table.get_item.return_value = {'Item': {'id': 'g1', 'name': 'Old', 'name_key': 'old'}}
        mock_groups_table.scan.return_value = {'Items': [{'id': 'g2', 'name_key': 'taken'}]}

        status, _ = parse_response(_mod.handler(
            make_event('PUT', {'name': 'Taken'}, {'id': 'g1'}, path='/api/keyword-groups/g1'), None
        ))

        assert status == 409
        mock_groups_table.update_item.assert_not_called()

    def test_rejects_an_update_without_any_field(self):
        mock_groups_table.get_item.return_value = {'Item': {'id': 'g1', 'name': 'Old', 'name_key': 'old'}}

        status, body = parse_response(_mod.handler(
            make_event('PUT', {}, {'id': 'g1'}, path='/api/keyword-groups/g1'), None
        ))

        assert status == 400
        assert body['error'] == 'Provide a name or a description to update'


class TestDeleteGroup:
    def test_deletes_the_group_and_detaches_every_member_keyword(self):
        mock_groups_table.get_item.return_value = {'Item': {'id': 'g1', 'name': 'Coruna'}}
        mock_keywords_table.scan.return_value = {'Items': [{'id': 'k1'}, {'id': 'k2'}]}

        status, body = parse_response(_mod.handler(
            make_event('DELETE', None, {'id': 'g1'}, path='/api/keyword-groups/g1'), None
        ))

        assert status == 200
        assert body == {'message': 'Keyword group deleted', 'detached_keywords': 2}
        detach_calls = mock_keywords_table.update_item.call_args_list
        assert [call.kwargs['Key'] for call in detach_calls] == [{'id': 'k1'}, {'id': 'k2'}]
        assert all(call.kwargs['UpdateExpression'] == 'DELETE group_ids :gids' for call in detach_calls)
        assert all(call.kwargs['ExpressionAttributeValues'] == {':gids': {'g1'}} for call in detach_calls)
        mock_groups_table.delete_item.assert_called_once_with(Key={'id': 'g1'})

    def test_returns_404_for_an_unknown_group(self):
        status, _ = parse_response(_mod.handler(
            make_event('DELETE', None, {'id': 'missing'}, path='/api/keyword-groups/missing'), None
        ))

        assert status == 404
        mock_groups_table.delete_item.assert_not_called()


class TestUpdateMemberships:
    def _event(self, body):
        return make_event('PUT', body, {'id': 'g1'}, path='/api/keyword-groups/g1/keywords')

    def test_adds_and_removes_memberships_and_returns_the_updated_keywords(self):
        mock_groups_table.get_item.return_value = {'Item': {'id': 'g1', 'name': 'Coruna'}}
        mock_keywords_table.update_item.side_effect = [
            {'Attributes': {'id': 'k1', 'keyword': 'a', 'group_ids': {'g1'}}},
            {'Attributes': {'id': 'k2', 'keyword': 'b'}},
        ]

        status, body = parse_response(_mod.handler(self._event({'add': ['k1'], 'remove': ['k2']}), None))

        assert status == 200
        assert body['added'] == ['k1']
        assert body['removed'] == ['k2']
        assert body['missing'] == []
        assert body['keywords'] == [
            {'id': 'k1', 'keyword': 'a', 'group_ids': ['g1']},
            {'id': 'k2', 'keyword': 'b'},
        ]

    def test_uses_a_set_add_with_the_membership_cap_and_a_set_delete(self):
        mock_groups_table.get_item.return_value = {'Item': {'id': 'g1'}}
        mock_keywords_table.update_item.return_value = {'Attributes': {'id': 'k1', 'keyword': 'a'}}

        _mod.handler(self._event({'add': ['k1'], 'remove': ['k2']}), None)

        add_call, remove_call = mock_keywords_table.update_item.call_args_list
        assert add_call.kwargs['UpdateExpression'] == 'ADD group_ids :gids'
        assert add_call.kwargs['ExpressionAttributeValues'][':max'] == 50
        assert remove_call.kwargs['UpdateExpression'] == 'DELETE group_ids :gids'

    def test_reports_unknown_keyword_ids_as_missing_instead_of_failing(self):
        mock_groups_table.get_item.return_value = {'Item': {'id': 'g1'}}
        mock_keywords_table.update_item.side_effect = _conditional_failure()

        status, body = parse_response(_mod.handler(self._event({'add': ['ghost']}), None))

        assert status == 200
        assert body['added'] == []
        assert body['missing'] == ['ghost']

    def test_rejects_a_body_without_changes(self):
        mock_groups_table.get_item.return_value = {'Item': {'id': 'g1'}}

        status, body = parse_response(_mod.handler(self._event({}), None))

        assert status == 400
        assert body['error'] == 'Provide keyword ids to add or remove'

    def test_returns_404_when_the_group_does_not_exist(self):
        status, _ = parse_response(_mod.handler(self._event({'add': ['k1']}), None))

        assert status == 404
        mock_keywords_table.update_item.assert_not_called()


class TestRouting:
    def test_rejects_unsupported_methods(self):
        status, body = parse_response(_mod.handler(make_event('PATCH', {}), None))

        assert status == 400
        assert body['error'] == 'Method PATCH not allowed'
