"""Fail-closed asynchronous Lambda invocation.

Dispatch failures raise; they never run paid work inline.
"""

from __future__ import annotations

import logging
from typing import Any

from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger(__name__)


class SelfInvokeDispatchError(RuntimeError):
    """Raised when an asynchronous Lambda event was not accepted."""


def invoke_self_async(
    function_name: str,
    payload: bytes,
    *,
    description: str,
    lambda_client: Any,
) -> dict[str, Any]:
    """Invoke ``function_name`` asynchronously with an encoded ``payload``.

    Raises ``SelfInvokeDispatchError`` when the invoke call fails; the caller
    never runs the work inline instead.
    """
    try:
        response = lambda_client.invoke(
            FunctionName=function_name,
            InvocationType="Event",
            Payload=payload,
        )
    except (BotoCoreError, ClientError, TypeError, ValueError) as error:
        logger.exception("Failed to trigger async %s: %s", description, error)
        raise SelfInvokeDispatchError(
            f"Could not start background {description}"
        ) from error
    return dict(response)
