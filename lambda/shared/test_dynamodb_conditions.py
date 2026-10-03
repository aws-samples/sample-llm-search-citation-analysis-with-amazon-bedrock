"""Tests for shared.dynamodb_conditions."""

from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError

from shared.dynamodb_conditions import applied_conditionally, delete_existing_item, is_conditional_check_failure
from testing.dynamodb_stubs import conditional_check_failure

_THROTTLED = ClientError({'Error': {'Code': 'ThrottlingException', 'Message': 'slow down'}}, 'PutItem')


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
