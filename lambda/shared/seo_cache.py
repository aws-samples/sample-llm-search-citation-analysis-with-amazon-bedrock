"""Read-through cache for paid DataForSEO answers (DynamoDB, with an S3 spill for large payloads).

A read-through cache for paid DataForSEO answers, one DynamoDB item per key in ``CitationAnalysis-SeoCache``
(env ``DYNAMODB_TABLE_SEO_CACHE``): ``{cache_key, payload (JSON string) | s3_key, expires_at, ttl, empty}``.
Payloads over 350 KB go to S3 (``RAW_RESPONSES_BUCKET``, key ``seo/cache/<key>.json``) and the item keeps
only the pointer.

Rules: the key is ``<namespace>#v<version>#sha256(canonical params)``, with keys sorted at every depth and
``None`` values dropped, so equivalent nested params share an entry; an expired or
unparsable entry is a miss; an entry written with ``ttl_seconds=None`` is kept (no ``expires_at`` or
``ttl``, ``permanent: true``): measured results stored here, such as Lighthouse runs, are records, not cache, and
never expire (TENETS.md, D2 and D5); a write never replaces an unexpired non-empty payload with an empty one (enforced
with a conditional put, so it also holds under concurrent writers); the write is synchronous, because a Lambda
freezes after it returns and a background write could be lost. A failing cache read or write is
logged and never fails the paid call around it.
"""

from __future__ import annotations

import functools
import hashlib
import json
import logging
import os
import time
from collections.abc import Mapping
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from shared.env_vars import resolve_table_env
from shared.log_safety import log_text

logger = logging.getLogger(__name__)

BUCKET_ENV = 'RAW_RESPONSES_BUCKET'
S3_PREFIX = 'seo/cache/'
MAX_INLINE_PAYLOAD_BYTES = 350_000
"""DynamoDB items cap at 400 KB; leave room for the other attributes."""

_EMPTY_LIST_FIELDS = ('rows', 'items')


@functools.cache
def _table() -> Any:
    """The cache table (one per warm container; tests replace this function)."""
    return boto3.resource('dynamodb').Table(resolve_table_env('DYNAMODB_TABLE_SEO_CACHE'))


@functools.cache
def _s3() -> Any:
    """The S3 client for oversized payloads (tests replace this function)."""
    return boto3.client('s3')


def _now() -> int:
    return int(time.time())


def _without_none(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _without_none(item) for key, item in value.items() if item is not None}
    if isinstance(value, list | tuple):
        return [_without_none(item) for item in value]
    return value


def cache_key(namespace: str, version: int, params: Mapping[str, Any]) -> str:
    """``f'{namespace}#v{version}#{sha256}'`` of the canonical JSON of ``params`` (sorted keys, no ``None``)."""
    canonical = json.dumps(_without_none(params), sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    digest = hashlib.sha256(canonical.encode('utf-8')).hexdigest()
    return f'{namespace}#v{version}#{digest}'


def is_empty_payload(payload: Any) -> bool:
    """``None``, ``[]``, ``{}``, or a dict whose ``rows`` / ``items`` list is empty."""
    if payload is None or payload == [] or payload == {}:
        return True
    if isinstance(payload, Mapping):
        return any(field in payload and not payload[field] for field in _EMPTY_LIST_FIELDS)
    return False


def _s3_key(key: str) -> str:
    return f"{S3_PREFIX}{key.replace('#', '_')}.json"


def _read_body(item: Mapping[str, Any]) -> str | None:
    payload = item.get('payload')
    if isinstance(payload, str):
        return payload
    s3_key = item.get('s3_key')
    bucket = os.environ.get(BUCKET_ENV)
    if not isinstance(s3_key, str) or not bucket:
        return None
    response = _s3().get_object(Bucket=bucket, Key=s3_key)
    return response['Body'].read().decode('utf-8')


def _expires_at(item: Mapping[str, Any]) -> int | None:
    value = item.get('expires_at')
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def get_cached(namespace: str, version: int, params: Mapping[str, Any]) -> Any | None:
    """The cached payload, or ``None`` on a miss (absent, expired, unparsable or unreadable)."""
    key = cache_key(namespace, version, params)
    try:
        item = _table().get_item(Key={'cache_key': key}).get('Item')
        if not item:
            return None
        expires_at = _expires_at(item)
        if item.get('permanent') is not True and (expires_at is None or expires_at <= _now()):
            return None
        body = _read_body(item)
    except (ClientError, BotoCoreError, KeyError) as exc:
        logger.warning('seo_cache.read-failed key=%s error=%s', log_text(key), type(exc).__name__)
        return None
    if body is None:
        return None
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        logger.warning('seo_cache.unparsable key=%s', log_text(key))
        return None


def _stored_body(key: str, body: str) -> dict[str, str] | None:
    """The item attribute that carries ``body``: inline, or a pointer to the S3 copy written here."""
    if len(body.encode('utf-8')) <= MAX_INLINE_PAYLOAD_BYTES:
        return {'payload': body}
    bucket = os.environ.get(BUCKET_ENV)
    if not bucket:
        logger.warning('seo_cache.oversized-without-bucket key=%s', log_text(key))
        return None
    s3_key = _s3_key(key)
    _s3().put_object(Bucket=bucket, Key=s3_key, Body=body.encode('utf-8'), ContentType='application/json')
    return {'s3_key': s3_key}


def _write(key: str, payload: Any, ttl_seconds: int | None) -> None:
    empty = is_empty_payload(payload)
    now = _now()
    stored = _stored_body(key, json.dumps(payload, ensure_ascii=False))
    if stored is None:
        return
    if ttl_seconds is None:
        expiry: dict[str, Any] = {'permanent': True}
    else:
        expires_at = now + ttl_seconds
        expiry = {'expires_at': expires_at, 'ttl': expires_at}
    item = {'cache_key': key, **stored, **expiry, 'empty': empty}
    if not empty:
        _table().put_item(Item=item)
        return
    _table().put_item(
        Item=item,
        ConditionExpression='attribute_not_exists(cache_key) OR expires_at <= :now OR #empty = :true',
        ExpressionAttributeNames={'#empty': 'empty'},
        ExpressionAttributeValues={':now': now, ':true': True},
    )


def put_cached(namespace: str, version: int, params: Mapping[str, Any], payload: Any, ttl_seconds: int | None) -> None:
    """Store ``payload`` for ``ttl_seconds`` (``None``: keep it); an empty payload never replaces an unexpired non-empty one."""
    key = cache_key(namespace, version, params)
    try:
        _write(key, payload, ttl_seconds)
    except ClientError as exc:
        if exc.response.get('Error', {}).get('Code') == 'ConditionalCheckFailedException':
            logger.info('seo_cache.kept-non-empty key=%s', log_text(key))
            return
        logger.warning('seo_cache.write-failed key=%s error=%s', log_text(key), type(exc).__name__)
    except BotoCoreError as exc:
        logger.warning('seo_cache.write-failed key=%s error=%s', log_text(key), type(exc).__name__)


__all__ = ['cache_key', 'get_cached', 'is_empty_payload', 'put_cached']
