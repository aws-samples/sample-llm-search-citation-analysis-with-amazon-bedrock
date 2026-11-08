"""
What a write that changes a scope snapshot's inputs starts (design 2.45.0 §2.3), without ever failing the write.

- ``rebuilds_snapshot(reason)``: the keyword, keyword-group, market and
  promotion writers. A successful write (a 2xx answer to POST, PUT, PATCH or
  DELETE) asks for a scope snapshot rebuild now
  (``shared.scope_snapshot_serve.request_snapshot_rebuild``, debounced with the
  readers' marker), so the build is fresh before anyone reads it stale.
- ``rebuilds_keyword_latest(reason)``: the brand-config saves and the persona
  (query prompt) writes. Every KeywordLatest object was built for the old
  configuration, so a successful write starts the Deduplication Lambda's
  ``latest`` backfill asynchronously (``KEYWORD_LATEST_BACKFILL_FUNCTION``),
  chained until done; its last pass starts the snapshot build.

Both are best effort: a trigger that cannot start is logged and the user's
write still answers as it did; the readers' staleness check requests the
rebuild on the next read anyway.
"""

from __future__ import annotations

import functools
import json
import logging
import os
from collections.abc import Callable
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from shared.keyword_run_kpis_backfill import BACKFILL_ACTION
from shared.scope_snapshot_serve import request_snapshot_rebuild

logger = logging.getLogger(__name__)

#: The methods that write.
WRITE_METHODS = frozenset({'POST', 'PUT', 'PATCH', 'DELETE'})

#: The Deduplication Lambda, which runs the ``latest`` backfill.
BACKFILL_FUNCTION_ENV = 'KEYWORD_LATEST_BACKFILL_FUNCTION'

#: What a trigger may raise; it is logged, never raised into the write.
_TRIGGER_ERRORS = (ClientError, BotoCoreError, KeyError, TypeError, ValueError)

Handler = Callable[..., dict[str, Any]]


def _wrote(event: Any, response: Any) -> bool:
    """Whether ``response`` answers a write that succeeded."""
    method = event.get('httpMethod') if isinstance(event, dict) else None
    status = response.get('statusCode') if isinstance(response, dict) else None
    return method in WRITE_METHODS and isinstance(status, int) and 200 <= status < 300


def request_rebuild(reason: str) -> bool:
    """``request_snapshot_rebuild`` that never raises; whether a rebuild was started."""
    try:
        return request_snapshot_rebuild(reason)
    except _TRIGGER_ERRORS:
        logger.exception('Could not request a scope snapshot rebuild (%s)', reason)
        return False


@functools.cache
def _lambda_client() -> Any:
    return boto3.client('lambda')


#: The most keywords a backfill request names (an asynchronous invoke carries at most 256 KB); more: every keyword.
BACKFILL_KEYWORDS_MAX = 1_000


def start_keyword_latest_backfill(reason: str, lambda_client: Any = None, keywords: list[str] | None = None) -> bool:
    """Start the chained ``latest`` backfill asynchronously, of ``keywords`` only when given; whether it was started (never raises)."""
    function_name = os.environ.get('KEYWORD_LATEST_BACKFILL_FUNCTION')
    if not function_name:
        return False
    payload: dict[str, Any] = {'action': BACKFILL_ACTION, 'latest': True, 'chain': True, 'reason': reason}
    if keywords is not None and len(keywords) <= BACKFILL_KEYWORDS_MAX:
        payload['keywords'] = list(keywords)
    try:
        (lambda_client or _lambda_client()).invoke(
            FunctionName=function_name, InvocationType='Event', Payload=json.dumps(payload).encode('utf-8'),
        )
    except _TRIGGER_ERRORS:
        logger.exception('Could not start the KeywordLatest backfill (%s)', reason)
        return False
    logger.info('KeywordLatest backfill started: %s', reason)
    return True


def _after_write(trigger: Callable[[str], bool], reason: str) -> Callable[[Handler], Handler]:
    def decorate(handler: Handler) -> Handler:
        @functools.wraps(handler)
        def wrapped(event: Any, context: Any, *args: Any, **kwargs: Any) -> dict[str, Any]:
            response = handler(event, context, *args, **kwargs)
            if _wrote(event, response):
                trigger(reason)
            return response

        return wrapped

    return decorate


def rebuilds_snapshot(reason: str) -> Callable[[Handler], Handler]:
    """After a successful write, ask for a scope snapshot rebuild (see the module docstring). The outermost decorator."""
    return _after_write(request_rebuild, reason)


def rebuilds_keyword_latest(reason: str) -> Callable[[Handler], Handler]:
    """After a successful write, start the KeywordLatest backfill (see the module docstring). The outermost decorator."""
    return _after_write(start_keyword_latest_backfill, reason)


__all__ = [
    'BACKFILL_FUNCTION_ENV',
    'BACKFILL_KEYWORDS_MAX',
    'WRITE_METHODS',
    'rebuilds_keyword_latest',
    'rebuilds_snapshot',
    'request_rebuild',
    'start_keyword_latest_backfill',
]
