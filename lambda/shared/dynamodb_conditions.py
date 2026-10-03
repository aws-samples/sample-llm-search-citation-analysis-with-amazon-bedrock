"""
Conditional DynamoDB writes: tell a failed ``ConditionExpression`` apart from
every other error.

A write whose condition no longer holds is an expected outcome (an id already
taken, a row another writer moved, a row that is absent), so callers branch on
it; every other ``ClientError`` propagates unchanged.
"""

from collections.abc import Callable
from typing import Any

from botocore.exceptions import ClientError

CONDITIONAL_CHECK_FAILED = 'ConditionalCheckFailedException'


def is_conditional_check_failure(error: ClientError) -> bool:
    """Whether DynamoDB refused the write because its ``ConditionExpression`` failed."""
    return error.response.get('Error', {}).get('Code') == CONDITIONAL_CHECK_FAILED


def applied_conditionally(write: Callable[[], Any]) -> bool:
    """Run ``write``; ``True`` when it was applied, ``False`` when its condition failed.

    Any other ``ClientError`` propagates unchanged.
    """
    try:
        write()
    except ClientError as error:
        if is_conditional_check_failure(error):
            return False
        raise
    return True


def delete_existing_item(table: Any, item_id: str) -> bool:
    """Delete the row whose ``id`` is ``item_id``; ``False`` when no such row exists.

    The ``attribute_exists`` condition makes the existence check and the delete
    one atomic call, so a missing row is reported instead of silently "deleted".
    Any other ``ClientError`` propagates.
    """
    return applied_conditionally(lambda: table.delete_item(
        Key={'id': item_id},
        ConditionExpression='attribute_exists(#id)',
        ExpressionAttributeNames={'#id': 'id'},
    ))
