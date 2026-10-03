"""
Conditional DynamoDB writes: tell a failed ``ConditionExpression`` apart from
every other error.

A write whose condition no longer holds is an expected outcome (an id already
taken, a row another writer moved), so callers branch on it; every other
``ClientError`` propagates unchanged.
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
