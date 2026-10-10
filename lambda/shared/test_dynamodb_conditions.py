"""Tests for shared.dynamodb_conditions."""

from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError

from shared.dynamodb_conditions import (
    applied_conditionally,
    delete_existing_item,
    is_conditional_check_failure,
    set_update_expression,
)
from testing.dynamodb_stubs import conditional_check_failure

_THROTTLED = ClientError({'Error': {'Code': 'ThrottlingException', 'Message': 'slow down'}}, 'PutItem')
_STAMP = '2026-10-07T09:00:00Z'


class TestSetUpdateExpression:
    def test_aliases_every_attribute_so_reserved_words_need_no_special_case(self):
        kwargs = set_update_expression({'name': 'Aurora Airways', 'status': 'active'}, timestamp=_STAMP)

        assert kwargs == {
            'UpdateExpression': 'SET #f0 = :v0, #f1 = :v1, #f2 = :v2',
            'ExpressionAttributeNames': {'#f0': 'name', '#f1': 'status', '#f2': 'updated_at'},
            'ExpressionAttributeValues': {':v0': 'Aurora Airways', ':v1': 'active', ':v2': _STAMP},
        }

    def test_keeps_insertion_order_so_the_same_changes_build_the_same_write(self):
        first = set_update_expression({'b': 2, 'a': 1}, timestamp=_STAMP)
        second = set_update_expression({'b': 2, 'a': 1}, timestamp=_STAMP)

        assert first == second
        assert list(first['ExpressionAttributeNames'].values()) == ['b', 'a', 'updated_at']

    def test_stamps_the_requested_timestamp_field_over_a_same_named_change(self):
        kwargs = set_update_expression({'modified_at': 'stale', 'size': 3}, timestamp=_STAMP, timestamp_field='modified_at')

        assert kwargs['ExpressionAttributeNames'] == {'#f0': 'modified_at', '#f1': 'size'}
        assert kwargs['ExpressionAttributeValues'] == {':v0': _STAMP, ':v1': 3}

    def test_refuses_an_empty_change_set(self):
        with pytest.raises(ValueError, match='at least one attribute'):
            set_update_expression({}, timestamp=_STAMP)


@pytest.mark.parametrize(('error', 'expected'), [
    pytest.param(conditional_check_failure('PutItem'), True, id='conditional-check-failed'),
    pytest.param(_THROTTLED, False, id='other-error-code'),
    pytest.param(ClientError({}, 'PutItem'), False, id='no-error-block'),
])
def test_is_conditional_check_failure_matches_only_the_condition_error_code(error, expected):
    assert is_conditional_check_failure(error) is expected


class TestAppliedConditionally:
    def test_returns_true_when_the_write_succeeds(self):
        assert applied_conditionally(MagicMock(return_value={})) is True

    def test_returns_false_when_the_condition_fails(self):
        assert applied_conditionally(MagicMock(side_effect=conditional_check_failure())) is False

    def test_propagates_any_other_client_error_unchanged(self):
        with pytest.raises(ClientError) as raised:
            applied_conditionally(MagicMock(side_effect=_THROTTLED))

        assert raised.value is _THROTTLED


class TestDeleteExistingItem:
    def test_deletes_under_an_attribute_exists_condition(self):
        table = MagicMock()

        assert delete_existing_item(table, 'row-1') is True
        table.delete_item.assert_called_once_with(
            Key={'id': 'row-1'},
            ConditionExpression='attribute_exists(#id)',
            ExpressionAttributeNames={'#id': 'id'},
        )

    def test_returns_false_when_the_row_is_missing(self):
        table = MagicMock()
        table.delete_item.side_effect = conditional_check_failure('DeleteItem')

        assert delete_existing_item(table, 'missing') is False

    def test_propagates_other_client_errors(self):
        table = MagicMock()
        table.delete_item.side_effect = _THROTTLED

        with pytest.raises(ClientError, match='ThrottlingException'):
            delete_existing_item(table, 'row-1')
