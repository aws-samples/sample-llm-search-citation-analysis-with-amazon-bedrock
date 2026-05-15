"""
Recommendation Status API

Tracks the action-tracking state of individual recommendations produced
by `get-recommendations.py`. The `recommendations` list itself is
generated on every call (no persistence), so this table is the only
place where a recommendation's lifecycle (`new` -> `in_progress` ->
`done` or `wontfix`) is durable.

Why this exists

The Action Center surfaces recommendations to a user, but without a
status mechanism every refresh shows the same items as if they were
freshly minted. Marking an item "in progress" or "done" in the UI
needs to survive a hard reload, an analysis re-run, and a different
user opening the dashboard.

Routes

  POST /api/recommendations/{id}/status
    Body: { "status": "new"|"in_progress"|"done"|"wontfix",
            "notes": <optional string>,
            "related_keyword": <optional string>,
            "related_content_id": <optional string> }
    Returns: { "id", "status", "updated_at", "notes", ... }

  GET /api/recommendations/{id}/status
    Returns: { "id", "status", "updated_at", ... } or 404 if no record.

The id is the deterministic SHA-1-truncated hash from
`shared.utils.recommendation_id`, computed by `get-recommendations.py`
when it produces the list. Same hash inputs (type, title, sorted
keywords) yield the same id across calls, so status survives list
regeneration.

Storage

  RECOMMENDATION_STATUS_TABLE — DynamoDB
  PK: recommendation_id (string)
  Attributes:
    status            : 'new' | 'in_progress' | 'done' | 'wontfix'
    notes             : optional free text
    related_keyword   : optional pointer to a keyword the action targets
    related_content_id: optional pointer to a Content Studio brief
                        that addresses this recommendation
    updated_at        : ISO timestamp
    completed_at      : ISO timestamp, set when status flips to 'done'

A 90-day TTL is applied so abandoned items eventually self-evict.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

import boto3

# Shared layer path
sys.path.insert(0, '/opt/python')

from shared.api_response import (
    error_response,
    not_found_response,
    success_response,
    validation_error,
)
from shared.decorators import api_handler

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

RECOMMENDATION_STATUS_TABLE = os.environ.get('RECOMMENDATION_STATUS_TABLE')

VALID_STATUSES = {'new', 'in_progress', 'done', 'wontfix'}
TTL_DAYS = 90
MAX_NOTES_LEN = 2000
MAX_RELATED_LEN = 500


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def _ttl_for(now: datetime) -> int:
    return int((now + timedelta(days=TTL_DAYS)).timestamp())


def _table():
    if not RECOMMENDATION_STATUS_TABLE:
        raise RuntimeError(
            'RECOMMENDATION_STATUS_TABLE env var is not set. The status '
            'feature must be deployed via CDK before this handler runs.'
        )
    return dynamodb.Table(RECOMMENDATION_STATUS_TABLE)


def _path_id(event: Dict[str, Any]) -> str:
    """Pull the {id} path parameter from the API Gateway event."""
    params = event.get('pathParameters') or {}
    return (params.get('id') or '').strip()


def _validate_post_body(body: Dict[str, Any]) -> Dict[str, Any] | None:
    """Return a validation error event if the body is bad, else None."""
    status = body.get('status')
    if status not in VALID_STATUSES:
        return {
            'reason': (
                f"status must be one of {sorted(VALID_STATUSES)}, "
                f"got {status!r}"
            ),
            'field': 'status',
        }

    notes = body.get('notes')
    if notes is not None and (not isinstance(notes, str) or len(notes) > MAX_NOTES_LEN):
        return {
            'reason': f'notes must be a string up to {MAX_NOTES_LEN} chars',
            'field': 'notes',
        }

    for key in ('related_keyword', 'related_content_id'):
        value = body.get(key)
        if value is not None and (
            not isinstance(value, str) or len(value) > MAX_RELATED_LEN
        ):
            return {
                'reason': f'{key} must be a string up to {MAX_RELATED_LEN} chars',
                'field': key,
            }

    return None


def _post_status(event: Dict[str, Any]) -> Dict[str, Any]:
    rec_id = _path_id(event)
    if not rec_id:
        return validation_error('Missing recommendation id', event, 'id')

    raw_body = event.get('body') or '{}'
    try:
        body = json.loads(raw_body)
    except json.JSONDecodeError:
        return validation_error('Invalid JSON body', event)

    if not isinstance(body, dict):
        return validation_error('Body must be a JSON object', event)

    err = _validate_post_body(body)
    if err is not None:
        return validation_error(err['reason'], event, err['field'])

    now = datetime.now(timezone.utc)
    item: Dict[str, Any] = {
        'recommendation_id': rec_id,
        'status': body['status'],
        'updated_at': _now_iso(),
        'ttl': _ttl_for(now),
    }
    if body.get('notes'):
        item['notes'] = body['notes']
    if body.get('related_keyword'):
        item['related_keyword'] = body['related_keyword']
    if body.get('related_content_id'):
        item['related_content_id'] = body['related_content_id']
    if body['status'] == 'done':
        item['completed_at'] = item['updated_at']

    _table().put_item(Item=item)
    return success_response(item, event)


def _get_status(event: Dict[str, Any]) -> Dict[str, Any]:
    rec_id = _path_id(event)
    if not rec_id:
        return validation_error('Missing recommendation id', event, 'id')

    response = _table().get_item(Key={'recommendation_id': rec_id})
    item = response.get('Item')
    if not item:
        return not_found_response(resource='Recommendation status', event=event)
    return success_response(item, event)


@api_handler
def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Route by HTTP method.

    POST: upsert the status row for a given recommendation id.
    GET : fetch the current status row, 404 if none.
    """
    method = (event.get('httpMethod') or '').upper()
    if method == 'POST':
        return _post_status(event)
    if method == 'GET':
        return _get_status(event)
    return error_response(
        Exception(f'Method {method} not allowed'),
        event,
        status_code=405,
    )


def list_statuses(rec_ids: list[str]) -> Dict[str, Dict[str, Any]]:
    """
    Bulk look up status rows for many recommendation ids.

    Used by `get-recommendations.py` to left-join status onto each
    recommendation it returns. Falls back to an empty dict if the
    table isn't configured (so the legacy /recommendations response
    keeps working in local dev without the status table). DynamoDB
    BatchGet has a 100-item limit; we chunk to stay under it.
    """
    if not RECOMMENDATION_STATUS_TABLE or not rec_ids:
        return {}
    table = _table()
    deduped = list({rid for rid in rec_ids if rid})
    out: Dict[str, Dict[str, Any]] = {}
    chunk_size = 100
    for i in range(0, len(deduped), chunk_size):
        chunk = deduped[i:i + chunk_size]
        try:
            response = dynamodb.batch_get_item(
                RequestItems={
                    table.name: {
                        'Keys': [{'recommendation_id': r} for r in chunk],
                    },
                },
            )
            for item in response.get('Responses', {}).get(table.name, []):
                rid = item.get('recommendation_id')
                if rid:
                    out[rid] = item
        except Exception as exc:
            # The status feature is auxiliary — if the lookup fails, return
            # what we have and let the caller render recommendations
            # without status. Logged so an operator can investigate.
            logger.warning(f'list_statuses failed for chunk {i}: {exc}')
    return out
