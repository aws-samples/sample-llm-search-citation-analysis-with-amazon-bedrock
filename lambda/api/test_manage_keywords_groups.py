"""
Tests for the `group_ids` handling added to manage-keywords.py.

Loads the handler with the groups table configured so membership can be set on
create and update; the identity/rename behaviour is covered by
test_manage_keywords_identity.py.
"""

from unittest.mock import MagicMock

import pytest

from testing.events import api_gateway_event, parse_response
from testing.keyword_groups_fixtures import SIGNED_IN_CLAIMS, load_with_groups_table, reset_with_no_keywords

mock_keywords_table = MagicMock()
mock_groups_table = MagicMock()
# The identity suite loads the same handler without a groups table; here the
# table is configured so membership can be set on create and update.
_mod = load_with_groups_table('manage-keywords.py', 'manage_keywords_with_groups', mock_keywords_table, mock_groups_table)


def _send(method, body, keyword_id=None):
    """``<method> /api/keywords[/<keyword_id>]`` as a signed-in user; returns ``(status, body)``."""
    path = '/api/keywords' if keyword_id is None else f'/api/keywords/{keyword_id}'
    path_params = None if keyword_id is None else {'id': keyword_id}
    event = api_gateway_event(method, path, body=body, path_params=path_params, claims=SIGNED_IN_CLAIMS)
    return parse_response(_mod.handler(event, None))


def _groups_exist(*ids):
    mock_groups_table.get_item.side_effect = lambda Key: {'Item': {'id': Key['id']}} if Key['id'] in ids else {}


@pytest.fixture(autouse=True)
def _reset_mocks():
    # No pre-existing keywords: the identity scan is empty and puts succeed.
    reset_with_no_keywords(mock_keywords_table, mock_groups_table)
    mock_groups_table.get_item.return_value = {}


class TestCreateWithGroups:
    def test_stores_memberships_as_a_string_set_and_returns_them_as_a_sorted_list(self):
        _groups_exist('g1', 'g2')

        status, body = _send('POST', {'keyword': 'hotel coruña', 'group_ids': ['g2', 'g1']})

        assert status == 201
        assert body['group_ids'] == ['g1', 'g2']
        written = mock_keywords_table.put_item.call_args.kwargs['Item']
        assert written['group_ids'] == {'g1', 'g2'}

    def test_creates_without_memberships_when_group_ids_is_omitted(self):
        status, body = _send('POST', {'keyword': 'hotel coruña'})

        assert status == 201
        assert 'group_ids' not in body
        assert 'group_ids' not in mock_keywords_table.put_item.call_args.kwargs['Item']

    def test_accepts_more_than_fifty_memberships_when_keyword_is_created(self):
        group_ids = [f'group-{index}' for index in range(51)]
        _groups_exist(*group_ids)

        status, body = _send('POST', {'keyword': 'hotel coruña', 'group_ids': group_ids})

        assert status == 201
        assert body['group_ids'] == sorted(group_ids)
        assert mock_keywords_table.put_item.call_args.kwargs['Item']['group_ids'] == set(group_ids)

    def test_rejects_unknown_group_ids_with_400_before_writing(self):
        _groups_exist('g1')

        status, body = _send('POST', {'keyword': 'hotel coruña', 'group_ids': ['g1', 'ghost']})

        assert status == 400
        assert body['error'] == 'Unknown keyword group ids: ghost'
        mock_keywords_table.put_item.assert_not_called()

    def test_rejects_a_non_array_group_ids_value(self):
        status, body = _send('POST', {'keyword': 'hotel coruña', 'group_ids': 'g1'})

        assert status == 400
        assert body['error'] == 'group_ids must be an array of strings'


class TestUpdateWithGroups:
    def _existing(self, text='hotel coruña'):
        mock_keywords_table.get_item.return_value = {'Item': {'id': 'k1', 'keyword': text}}
        mock_keywords_table.update_item.return_value = {'Attributes': {'id': 'k1', 'keyword': text, 'group_ids': {'g1'}}}

    def test_replaces_memberships_with_the_given_set(self):
        self._existing()
        _groups_exist('g1')

        status, body = _send('PUT', {'keyword': 'hotel coruña', 'group_ids': ['g1']}, 'k1')

        assert status == 200
        assert body['group_ids'] == ['g1']
        kwargs = mock_keywords_table.update_item.call_args.kwargs
        assert 'group_ids = :g' in kwargs['UpdateExpression']
        assert kwargs['ExpressionAttributeValues'][':g'] == {'g1'}

    def test_clears_memberships_when_an_empty_list_is_sent(self):
        self._existing()
        mock_keywords_table.update_item.return_value = {'Attributes': {'id': 'k1', 'keyword': 'hotel coruña'}}

        status, body = _send('PUT', {'keyword': 'hotel coruña', 'group_ids': []}, 'k1')

        assert status == 200
        assert 'group_ids' not in body
        kwargs = mock_keywords_table.update_item.call_args.kwargs
        assert kwargs['UpdateExpression'].endswith(' REMOVE group_ids')
        assert ':g' not in kwargs['ExpressionAttributeValues']

    def test_leaves_memberships_untouched_when_group_ids_is_omitted(self):
        self._existing()

        _send('PUT', {'keyword': 'hotel coruña'}, 'k1')

        expression = mock_keywords_table.update_item.call_args.kwargs['UpdateExpression']
        assert 'group_ids' not in expression
