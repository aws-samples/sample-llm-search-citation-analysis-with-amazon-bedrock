"""Tests for shared.dynamo_conditions."""

from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError

from shared.dynamo_conditions import delete_existing_item, is_conditional_check_failure
from testing.dynamodb_stubs import conditional_check_failure

THROTTLED = ClientError({'Error': {'Code': 'ThrottlingException', 'Message': 'slow down'}}, 'DeleteItem')


@pytest.mark.parametrize(('error', 'expected'), [
    pytest.param(conditional_check_failure('PutItem'), True, id='conditional-check-failed'),
    pytest.param(THROTTLED, False, id='other-error-code'),
    pytest.param(ClientError({}, 'PutItem'), False, id='no-error-block'),
])
def test_is_conditional_check_failure_matches_only_the_condition_error_code(error, expected):
    assert is_conditional_check_failure(error) is expected


def test_delete_existing_item_deletes_under_an_attribute_exists_condition():
    table = MagicMock()

    assert delete_existing_item(table, 'row-1') is True
    table.delete_item.assert_called_once_with(
        Key={'id': 'row-1'},
        ConditionExpression='attribute_exists(#id)',
        ExpressionAttributeNames={'#id': 'id'},
    )


def test_delete_existing_item_returns_false_when_the_row_is_missing():
    table = MagicMock()
    table.delete_item.side_effect = conditional_check_failure('DeleteItem')

    assert delete_existing_item(table, 'missing') is False


def test_delete_existing_item_propagates_other_client_errors():
    table = MagicMock()
    table.delete_item.side_effect = THROTTLED

    with pytest.raises(ClientError, match='ThrottlingException'):
        delete_existing_item(table, 'row-1')
