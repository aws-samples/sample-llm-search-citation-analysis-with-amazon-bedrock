"""
Fire-and-forget Lambda self-invocation.

Async endpoints (keyword expansion, competitor analysis, content generation)
return immediately and re-invoke their own function with
``InvocationType='Event'`` to do the work in the background. The pattern —
read ``AWS_LAMBDA_FUNCTION_NAME``, invoke, run synchronously when the name is
unset (local testing) — was copy-pasted three times (bugs.md 3.4). This is the
single implementation.

Why a dispatch failure is NOT run inline (AUDIT-2026-08-19 §2.9)
---------------------------------------------------------------
This helper used to catch every exception from ``invoke`` and call
``fallback()``, and the fallbacks callers pass in *are the long jobs
themselves* (``_process_generation_async``, ``_process_expand_sync``,
``_process_competitor_sync``). So a failed dispatch silently converted an
API-Gateway request into a full inline LLM job:

- API Gateway's integration timeout is a hard 29s, so the client received a
  504 and lost the response.
- The Lambda kept running to its own much longer timeout (300s for Content
  Studio), finished the work, billed the model call, and wrote the result.
- The only trace was one ERROR line. The endpoint's entire reason for being
  async — not blocking the client on a multi-minute job — was defeated by its
  own error handler.

Dispatch failure now raises ``SelfInvokeDispatchError`` so the caller must
decide what the client sees. Callers mark their job row failed and return 503,
which is honest: the work definitively did not start, and the user can retry.
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Callable
from typing import Any

import boto3

logger = logging.getLogger(__name__)


class SelfInvokeDispatchError(RuntimeError):
    """Raised when the background invocation could not be dispatched.

    Callers must handle this: the background job has NOT started and never
    will. Mark the job record failed and tell the client, rather than letting
    the row sit in a non-terminal state that nothing will ever advance.
    """


def invoke_self_async(
    payload: dict[str, Any],
    fallback: Callable[[], None],
    *,
    description: str,
    success_log: str | None = None,
) -> None:
    """Invoke the current Lambda asynchronously.

    Args:
        payload: Event payload for the async invocation. The dispatch keys
            (``async_expand`` / ``async_competitor`` / ``async_generation``)
            are the caller's contract with its own handler.
        fallback: Zero-argument synchronous fallback, used **only** when no
            function name is available — i.e. outside Lambda, where no async
            path exists at all. It is deliberately not used to paper over a
            failed dispatch; see the module docstring.
        description: Short label for the failure log and error message.
        success_log: Optional message logged after a successful invoke.

    Raises:
        SelfInvokeDispatchError: the invoke call failed, so the background
            job did not start.
    """
    function_name = os.environ.get('AWS_LAMBDA_FUNCTION_NAME', '')
    if not function_name:
        # Not running in Lambda (local runs, tests). There is no async path to
        # dispatch to, so inline execution is the only meaningful behavior.
        fallback()
        return

    lambda_client = boto3.client('lambda')
    try:
        lambda_client.invoke(
            FunctionName=function_name,
            InvocationType='Event',
            Payload=json.dumps(payload),
        )
    except Exception as e:
        # Do NOT fall back to running the job here: this call is on the
        # client's synchronous request and the job outlives the 29s gateway
        # timeout. Fail fast instead.
        logger.error(f"Failed to trigger async {description}: {e}")
        raise SelfInvokeDispatchError(
            f"Could not start background {description}"
        ) from e

    if success_log:
        logger.info(success_log)
