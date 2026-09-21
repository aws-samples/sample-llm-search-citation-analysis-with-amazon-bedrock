"""Fail-closed asynchronous Lambda invocation with rollout compatibility.

``invoke_self_async`` remains available while pre-rollout Content Studio code can
still run against a newly built shared layer. New Content Studio code supplies
an explicit worker target; old callers continue to resolve their own function
name from the Lambda environment. Dispatch failures never run paid work inline.
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Callable
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger(__name__)


class SelfInvokeDispatchError(RuntimeError):
    """Raised when an asynchronous Lambda event was not accepted."""


def invoke_self_async(
    payload: dict[str, Any],
    fallback: Callable[[], None] | None,
    *,
    description: str,
    success_log: str | None = None,
    function_name: str | None = None,
    payload_bytes: bytes | str | None = None,
    lambda_client: Any | None = None,
) -> dict[str, Any] | None:
    """Invoke one Lambda asynchronously without falling back after failure.

    The optional target, encoded payload, and client preserve the legacy helper
    contract while allowing a new handler to forward old events to a dedicated
    worker. When no target exists outside Lambda, an explicitly supplied local
    fallback remains the only meaningful execution path.
    """
    target = function_name if function_name is not None else os.environ.get(
        "AWS_LAMBDA_FUNCTION_NAME", ""
    )
    if not target:
        if fallback is None:
            raise SelfInvokeDispatchError(f"Could not resolve async {description} target")
        fallback()
        return None

    client = lambda_client if lambda_client is not None else boto3.client("lambda")
    encoded = payload_bytes if payload_bytes is not None else json.dumps(payload)
    try:
        response = client.invoke(
            FunctionName=target,
            InvocationType="Event",
            Payload=encoded,
        )
    except (BotoCoreError, ClientError, TypeError, ValueError) as error:
        logger.exception("Failed to trigger async %s: %s", description, error)
        raise SelfInvokeDispatchError(
            f"Could not start background {description}"
        ) from error

    if success_log:
        logger.info(success_log)
    return dict(response)
