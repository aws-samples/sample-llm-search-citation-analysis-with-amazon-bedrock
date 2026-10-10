"""
DynamoDB write helpers: build ``SET`` updates and tell a failed
``ConditionExpression`` apart from every other error.

A write whose condition no longer holds is an expected outcome (an id already
taken, a row another writer moved, a row that is absent), so callers branch on
it; every other ``ClientError`` propagates unchanged.
"""

from collections.abc import Callable, Mapping
from typing import Any

from botocore.exceptions import ClientError

CONDITIONAL_CHECK_FAILED = 'ConditionalCheckFailedException'


def set_update_expression(changes: Mapping[str, Any], *, timestamp: str, timestamp_field: str = 'updated_at') -> dict[str, Any]:
    """``update_item`` kwargs that ``SET`` every attribute in ``changes`` and stamp ``timestamp_field``.

    Every attribute is aliased (``#f0 = :v0`` …), so reserved words such as
    ``name`` or ``status`` need no special case, and tokens follow insertion
    order, so the expression is deterministic. ``timestamp_field`` is always
    stamped with ``timestamp``, even when ``changes`` names it. Callers refuse
    "nothing to update" before building the write, so an empty mapping is an error.
    """
    if not changes:
        raise ValueError('set_update_expression needs at least one attribute to set')
    assignments = {**changes, timestamp_field: timestamp}
    names: dict[str, str] = {}
    values: dict[str, Any] = {}
    for index, (field, value) in enumerate(assignments.items()):
        names[f'#f{index}'] = field
        values[f':v{index}'] = value
    return {
        'UpdateExpression': 'SET ' + ', '.join(f'#f{index} = :v{index}' for index in range(len(assignments))),
        'ExpressionAttributeNames': names,
        'ExpressionAttributeValues': values,
    }


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
