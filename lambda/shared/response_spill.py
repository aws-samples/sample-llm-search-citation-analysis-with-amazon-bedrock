"""
The last line of defence against Lambda's 6 MiB response cap.

``shared.api_response.api_response`` passes every proxy response through
``guard_response``. Responses under ``SPILL_THRESHOLD_BYTES`` (measured on the
whole envelope, as the runtime measures it) pass unchanged. A larger one is
written to S3 under ``SPILL_PREFIX`` and replaced by a small pointer with the
original status code::

    {"spilled_response": {"url": "<presigned GET>", "size_bytes": 7340032, "expires_in": 300}}

with the header ``X-Spilled-Response: true``. The dashboard's
``authenticatedFetch`` and the MCP server's ``invoke_route`` follow the
pointer, so callers see the original body. Without the guard the runtime
fails the invocation with RequestEntityTooLarge and API Gateway answers a bare
502.

Every route is bounded by design (``shared.response_budget``); reaching the
threshold means one outgrew it, so each spill is logged as an error with its
route and size, and every response over ``LARGE_RESPONSE_BYTES`` as a warning.
Find them with CloudWatch Logs Insights over the API log groups::

    filter @message like /large_api_response|spilled_api_response/

The spilled object is the response the caller was already authorized to
read. It is reachable only through the presigned URL (the bucket blocks all
public access), which expires after ``SPILL_URL_TTL_SECONDS``, and a
lifecycle rule deletes the prefix after a day.
"""

from __future__ import annotations

import functools
import json
import logging
import os
import uuid
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from shared.response_budget import LARGE_RESPONSE_BYTES, SPILL_THRESHOLD_BYTES, envelope_bytes

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

SPILL_KEY = 'spilled_response'
SPILL_HEADER = 'X-Spilled-Response'
SPILL_PREFIX = 'api-responses/'
SPILL_URL_TTL_SECONDS = 300

# The bucket spilled bodies are written to (the keywords bucket; CDK sets it on every API Lambda).
BUCKET_ENV = 'API_RESPONSE_BUCKET'

TOO_LARGE_MESSAGE = 'The response is too large to return. Narrow the request (a smaller scope or page) and retry.'


@functools.cache
def _s3() -> Any:
    """The S3 client, created on the first spill (most containers never spill)."""
    return boto3.client('s3')


def _route(event: dict[str, Any] | None) -> str:
    """``METHOD /resource`` of the request, for the log line."""
    if not event:
        return 'unknown'
    return f"{event.get('httpMethod', '')} {event.get('resource') or event.get('path') or ''}".strip()


def _too_large(response: dict[str, Any]) -> dict[str, Any]:
    """A 500 that says what happened, instead of the runtime's opaque failure."""
    return {
        'statusCode': 500,
        'headers': response.get('headers', {}),
        'body': json.dumps({'error': TOO_LARGE_MESSAGE, 'code': 'response_too_large'}),
    }


def _spill(response: dict[str, Any], bucket: str, size: int) -> dict[str, Any]:
    """``response`` with its body moved to S3 and replaced by the pointer."""
    key = f'{SPILL_PREFIX}{uuid.uuid4()}.json'
    _s3().put_object(
        Bucket=bucket,
        Key=key,
        Body=str(response.get('body', '')).encode('utf-8'),
        ContentType='application/json',
    )
    url = _s3().generate_presigned_url(
        'get_object',
        Params={'Bucket': bucket, 'Key': key},
        ExpiresIn=SPILL_URL_TTL_SECONDS,
    )
    return {
        'statusCode': response.get('statusCode', 200),
        'headers': {**response.get('headers', {}), SPILL_HEADER: 'true'},
        'body': json.dumps({SPILL_KEY: {'url': url, 'size_bytes': size, 'expires_in': SPILL_URL_TTL_SECONDS}}),
    }


def guard_response(response: dict[str, Any], event: dict[str, Any] | None = None) -> dict[str, Any]:
    """``response`` as it is when it fits; otherwise spilled to S3, or a clear 500 when that fails."""
    size = envelope_bytes(response)
    if size < LARGE_RESPONSE_BYTES:
        return response
    route = _route(event)
    if size < SPILL_THRESHOLD_BYTES:
        logger.warning('large_api_response route=%s bytes=%d', route, size)
        return response

    bucket = os.environ.get(BUCKET_ENV)
    if not bucket:
        logger.error('spilled_api_response failed route=%s bytes=%d: %s is not set', route, size, BUCKET_ENV)
        return _too_large(response)
    try:
        spilled = _spill(response, bucket, size)
    except (ClientError, BotoCoreError):
        logger.exception('spilled_api_response failed route=%s bytes=%d', route, size)
        return _too_large(response)
    logger.error('spilled_api_response route=%s bytes=%d', route, size)
    return spilled


def spilled_location(body: Any) -> str | None:
    """The presigned URL when ``body`` (a decoded response body) is a spill pointer, else ``None``."""
    if not isinstance(body, dict) or set(body) != {SPILL_KEY}:
        return None
    pointer = body[SPILL_KEY]
    url = pointer.get('url') if isinstance(pointer, dict) else None
    return url if isinstance(url, str) and url.startswith('https://') else None
