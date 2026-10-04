"""
Tests for manage-keyword-groups.py.

Covers the group CRUD routes, the uniqueness rule on names, detaching members
when a group is deleted, and the bulk membership route, all against mocked
DynamoDB tables.
"""

import time
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from testing.dynamodb_stubs import conditional_check_failure
from testing.events import api_gateway_event, parse_response
from testing.keyword_groups_fixtures import (
    SIGNED_IN_CLAIMS,
    load_with_groups_table,
    membership_update,
    reset_with_no_keywords,
)

mock_keywords_table = MagicMock()
mock_groups_table = MagicMock()
_mod = load_with_groups_table('manage-keyword-groups.py', 'manage_keyword_groups', mock_keywords_table, mock_groups_table)

# The group the update / delete / membership routes act on.
_CORUNA = {'id': 'g1', 'name': 'Coruna'}
_OLD = {'id': 'g1', 'name': 'Old', 'name_key': 'old'}


def _request(method, body=None, group_id=None, suffix=''):
    """``<method> /api/keyword-groups[/<group_id><suffix>]``; returns ``(status, body)``."""
    path = '/api/keyword-groups' if group_id is None else f'/api/keyword-groups/{group_id}{suffix}'
    path_params = None if group_id is None else {'id': group_id}
    event = api_gateway_event(method, path, resource=path, body=body, path_params=path_params, claims=SIGNED_IN_CLAIMS)
    return parse_response(_mod.handler(event, None))


def _stored_group(group_id, name):
    """A group row as the list scan returns it."""
    return {'id': group_id, 'name': name, 'description': '', 'created_at': 't', 'updated_at': 't'}


def _store_groups(*groups):
    mock_groups_table.scan.return_value = {'Items': list(groups)}


def _store_members(*keywords):
    mock_keywords_table.scan.return_value = {'Items': list(keywords)}


@pytest.fixture(autouse=True)
def _reset_mocks():
    reset_with_no_keywords(mock_keywords_table, mock_groups_table)
    mock_groups_table.scan.return_value = {'Items': []}
    mock_groups_table.get_item.return_value = {}


@pytest.fixture
def coruna_exists():
    mock_groups_table.get_item.return_value = {'Item': _CORUNA}


class TestListGroups:
    def test_returns_groups_sorted_by_name_with_member_counts(self):
        _store_groups(_stored_group('g2', 'Marino'), {**_stored_group('g1', 'coruna'), 'description': 'Galicia'})
        _store_members(
            {'group_ids': {'g1', 'g2'}, 'status': 'active'},
            {'group_ids': {'g1'}, 'status': 'active'},
            {},
        )

        status, body = _request('GET')

        assert status == 200
        assert body['count'] == 2
        assert [(g['name'], g['keyword_count']) for g in body['groups']] == [('coruna', 2), ('Marino', 1)]

    def test_counts_only_active_members_so_the_number_matches_what_a_run_resolves(self):
        """REGRESSION: a group of paused keywords looked runnable and then failed.

        `resolve_scope` returns active keywords in every mode, so a count that
        included paused members promised work the scope could not resolve: the
        Run Analysis button stayed enabled on a group whose members were all
        paused, and the run came back "No active keywords match the selected
        scope (1 group(s))".
        """
        _store_groups(_stored_group('g1', 'Branson'), _stored_group('g2', 'St Louis'))
        _store_members(
            # Every Branson member is paused; St Louis keeps one active member.
            {'group_ids': {'g1'}, 'status': 'inactive'},
            {'group_ids': {'g1'}, 'status': 'paused'},
            {'group_ids': {'g1', 'g2'}, 'status': 'inactive'},
            {'group_ids': {'g2'}, 'status': 'active'},
        )

        status, body = _request('GET')

        assert status == 200
        counts = {group['name']: group['keyword_count'] for group in body['groups']}
        assert counts == {'Branson': 0, 'St Louis': 1}

    def test_excludes_a_member_without_a_status_because_no_run_can_resolve_it(self):
        """Rows predating the status field are absent from the sparse StatusIndex.

        `resolve_scope` queries that index, so such a row can never be resolved
        by a run. Counting it would promise work the scope cannot deliver — the
        same mismatch the active-only count exists to remove.
        """
        _store_groups(_stored_group('g1', 'Legacy'))
        _store_members({'group_ids': {'g1'}}, {'group_ids': {'g1'}, 'status': 'active'})

        status, body = _request('GET')

        assert status == 200
        assert body['groups'][0]['keyword_count'] == 1

    def test_returns_an_empty_list_when_no_groups_exist(self):
        assert _request('GET') == (200, {'groups': [], 'count': 0})


class TestCreateGroup:
    def test_creates_a_group_with_a_trimmed_name_and_returns_201(self):
        status, body = _request('POST', {'name': '  Hotel  Coruña ', 'description': 'Galicia'})

        assert status == 201
        assert (body['name'], body['description'], body['keyword_count']) == ('Hotel Coruña', 'Galicia', 0)
        written = mock_groups_table.put_item.call_args.kwargs['Item']
        assert written['name_key'] == 'hotel coruña'

    def test_rejects_a_duplicate_name_case_insensitively_with_409(self):
        _store_groups({'id': 'g1', 'name_key': 'hotel coruña'})

        status, body = _request('POST', {'name': 'HOTEL CORUÑA'})

        assert status == 409
        assert body['error'] == 'A keyword group with this name already exists'
        mock_groups_table.put_item.assert_not_called()

    def test_rejects_a_missing_name_with_400(self):
        status, body = _request('POST', {'description': 'x'})

        assert status == 400
        assert 'name' in body['error']

    @pytest.mark.parametrize(
        ('name', 'error'),
        [('   ', 'name must not be empty'), ('x' * 101, 'name exceeds maximum length of 100 characters')],
        ids=['blank-name', 'name-over-100-characters'],
    )
    def test_rejects_an_invalid_name_with_400(self, name, error):
        assert _request('POST', {'name': name}) == (400, {'error': error, 'field': 'name'})


class TestUpdateGroup:
    def test_renames_an_existing_group(self):
        mock_groups_table.get_item.return_value = {'Item': _OLD}
        mock_groups_table.update_item.return_value = {'Attributes': {
            'id': 'g1', 'name': 'New Name', 'description': '', 'created_at': 't', 'updated_at': 't2',
        }}

        status, body = _request('PUT', {'name': 'New Name'}, 'g1')

        assert status == 200
        assert body['name'] == 'New Name'
        values = mock_groups_table.update_item.call_args.kwargs['ExpressionAttributeValues']
        assert 'New Name' in values.values()
        assert 'new name' in values.values()

    def test_returns_404_for_an_unknown_group(self):
        assert _request('PUT', {'name': 'x'}, 'missing') == (404, {'error': 'Keyword group not found'})

    def test_rejects_renaming_onto_another_groups_name(self):
        mock_groups_table.get_item.return_value = {'Item': _OLD}
        _store_groups({'id': 'g2', 'name_key': 'taken'})

        status, _ = _request('PUT', {'name': 'Taken'}, 'g1')

        assert status == 409
        mock_groups_table.update_item.assert_not_called()

    def test_rejects_an_update_without_any_field(self):
        mock_groups_table.get_item.return_value = {'Item': _OLD}

        status, body = _request('PUT', {}, 'g1')

        assert status == 400
        assert body['error'] == 'Provide a name or a description to update'


class TestDeleteGroup:
    @pytest.mark.usefixtures('coruna_exists')
    def test_deletes_the_group_and_detaches_every_member_keyword(self):
        _store_members({'id': 'k1'}, {'id': 'k2'})

        status, body = _request('DELETE', None, 'g1')

        assert (status, body) == (200, {'message': 'Keyword group deleted', 'detached_keywords': 2})
        detach_calls = mock_keywords_table.update_item.call_args_list
        assert sorted(call.kwargs['Key']['id'] for call in detach_calls) == ['k1', 'k2']
        assert all(call.kwargs['UpdateExpression'] == 'DELETE group_ids :gids' for call in detach_calls)
        assert all(call.kwargs['ExpressionAttributeValues'] == {':gids': {'g1'}} for call in detach_calls)
        mock_groups_table.delete_item.assert_called_once_with(Key={'id': 'g1'})

    def test_returns_404_for_an_unknown_group(self):
        status, _ = _request('DELETE', None, 'missing')

        assert status == 404
        mock_groups_table.delete_item.assert_not_called()

    @pytest.mark.usefixtures('coruna_exists')
    @pytest.mark.parametrize(('member_count', 'expected_workers'), [(25, 10), (3, 3)])
    def test_detaches_members_with_bounded_parallel_writes_when_group_is_deleted(self, member_count, expected_workers):
        _store_members(*({'id': f'k{index}'} for index in range(member_count)))

        with patch.object(_mod, 'ThreadPoolExecutor', wraps=ThreadPoolExecutor) as executor:
            _request('DELETE', None, 'g1')

        assert executor.call_args.kwargs == {'max_workers': expected_workers}
        assert mock_keywords_table.update_item.call_count == member_count

    @pytest.mark.usefixtures('coruna_exists')
    def test_keeps_the_group_when_detaching_a_member_fails(self):
        _store_members({'id': 'k1'})
        mock_keywords_table.update_item.side_effect = ClientError(
            {'Error': {'Code': 'ThrottlingException', 'Message': 'Rate exceeded'}}, 'UpdateItem'
        )

        status, _ = _request('DELETE', None, 'g1')

        assert status == 500
        mock_groups_table.delete_item.assert_not_called()


def _change_members(body):
    """``PUT /api/keyword-groups/g1/keywords``; returns ``(status, body)``."""
    return _request('PUT', body, 'g1', '/keywords')


@pytest.mark.usefixtures('coruna_exists')
class TestUpdateMemberships:
    def test_adds_and_removes_memberships_and_returns_the_updated_keywords(self):
        mock_keywords_table.update_item.side_effect = [
            {'Attributes': {'id': 'k1', 'keyword': 'a', 'group_ids': {'g1'}}},
            {'Attributes': {'id': 'k2', 'keyword': 'b'}},
        ]

        status, body = _change_members({'add': ['k1'], 'remove': ['k2']})

        assert status == 200
        assert (body['added'], body['removed'], body['missing']) == (['k1'], ['k2'], [])
        assert body['keywords'] == [
            {'id': 'k1', 'keyword': 'a', 'group_ids': ['g1']},
            {'id': 'k2', 'keyword': 'b'},
        ]

    def test_adds_fifty_first_membership_when_keyword_has_fifty_groups(self):
        existing_group_ids = {f'existing-{index}' for index in range(50)}
        mock_keywords_table.update_item.return_value = {'Attributes': {
            'id': 'k1',
            'keyword': 'a',
            'group_ids': existing_group_ids,
        }}

        status, body = _change_members({'add': ['k1']})

        assert (status, body['added']) == (200, ['k1'])
        assert body['keywords'] == [{
            'id': 'k1',
            'keyword': 'a',
            'group_ids': sorted(existing_group_ids | {'g1'}),
        }]
        mock_keywords_table.update_item.assert_called_once_with(**membership_update('k1', {'g1'}, 'ADD', 'ALL_OLD'))

    def test_uses_set_delete_when_membership_is_removed(self):
        mock_keywords_table.update_item.return_value = {'Attributes': {'id': 'k2', 'keyword': 'b'}}

        _change_members({'remove': ['k2']})

        mock_keywords_table.update_item.assert_called_once_with(**membership_update('k2', {'g1'}, 'DELETE', 'ALL_NEW'))

    @pytest.mark.parametrize(('change', 'applied'), [('add', 'added'), ('remove', 'removed')])
    def test_reports_unknown_keyword_ids_as_missing_instead_of_failing(self, change, applied):
        mock_keywords_table.update_item.side_effect = conditional_check_failure()

        status, body = _change_members({change: ['ghost']})

        assert (status, body[applied], body['missing']) == (200, [], ['ghost'])

    def test_rejects_a_body_without_changes(self):
        assert _change_members({}) == (400, {'error': 'Provide keyword ids to add or remove'})

    def test_reports_added_ids_in_request_order_when_parallel_writes_finish_out_of_order(self):
        keyword_ids = [f'k{index}' for index in range(12)]

        def finish_earlier_ids_last(**kwargs):
            index = int(kwargs['Key']['id'][1:])
            time.sleep((len(keyword_ids) - index) * 0.002)
            return {'Attributes': {'id': kwargs['Key']['id'], 'keyword': 'a'}}

        mock_keywords_table.update_item.side_effect = finish_earlier_ids_last

        _status, body = _change_members({'add': keyword_ids})

        assert body['added'] == keyword_ids

    def test_writes_memberships_with_at_most_ten_threads_when_a_request_changes_many_keywords(self):
        mock_keywords_table.update_item.return_value = {'Attributes': {'id': 'k', 'keyword': 'a'}}

        with patch.object(_mod, 'ThreadPoolExecutor', wraps=ThreadPoolExecutor) as executor:
            _change_members({'add': [f'k{index}' for index in range(_mod.MAX_MEMBERSHIP_CHANGES)]})

        assert executor.call_args.kwargs == {'max_workers': 10}

    def test_rejects_more_than_500_additions_in_one_request(self):
        status, body = _change_members({'add': [f'k{index}' for index in range(501)]})

        assert (status, body) == (400, {'error': 'add accepts at most 500 entries', 'field': 'add'})
        mock_keywords_table.update_item.assert_not_called()


def test_returns_404_for_membership_changes_when_the_group_does_not_exist():
    status, _ = _change_members({'add': ['k1']})

    assert status == 404
    mock_keywords_table.update_item.assert_not_called()


class TestRouting:
    def test_rejects_unsupported_methods(self):
        status, body = _request('PATCH', {})

        assert status == 400
        assert body['error'] == 'Method PATCH not allowed'
