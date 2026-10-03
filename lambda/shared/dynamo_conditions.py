"""DynamoDB conditional writes: recognising a rejected condition, and deleting a row that must exist."""

from __future__ import annotations

from typing import Any

from botocore.exceptions import ClientError


def is_conditional_check_failure(error: ClientError) -> bool:
    """The write's ``ConditionExpression`` rejected it (a lost race, or a row that is absent or present)."""
    return error.response.get('Error', {}).get('Code') == 'ConditionalCheckFailedException'


def delete_existing_item(table: Any, item_id: str) -> bool:
    """Delete the row whose ``id`` is ``item_id``; ``False`` when no such row exists.

    The ``attribute_exists`` condition makes the existence check and the delete
    one atomic call, so a missing row is reported instead of silently "deleted".
    Any other ``ClientError`` propagates.
    """
    try:
        table.delete_item(
            Key={'id': item_id},
            ConditionExpression='attribute_exists(#id)',
            ExpressionAttributeNames={'#id': 'id'},
        )
    except ClientError as error:
        if not is_conditional_check_failure(error):
            raise
        return False
    return True
