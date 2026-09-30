"""
Get Keywords API Lambda

Returns the Keywords table one scan page at a time with an opaque
continuation token, so clients can read every keyword however large the table
grows without a single response approaching the Lambda payload cap.
"""

import base64
import json
import sys
from typing import Any

import boto3

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import success_response, validation_error
from shared.decorators import api_handler, optional_limit, validate
from shared.env_vars import resolve_table_env
from shared.keyword_groups import serialize_keyword_item

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables (audit #12 canonical naming).
KEYWORDS_TABLE = resolve_table_env('DYNAMODB_TABLE_KEYWORDS', 'KEYWORDS_TABLE')
keywords_table = dynamodb.Table(KEYWORDS_TABLE)

# Valid values
VALID_STATUSES = ['active', 'inactive', 'paused']
VALID_PRIORITIES = ['high', 'normal', 'low']

# A token encodes {"id": "<keyword id>"}; ids are at most 64 characters, so
# even a fully JSON-escaped id stays far below this bound.
MAX_NEXT_TOKEN_LENGTH = 1024
_MALFORMED_CURSOR_MESSAGE = 'Invalid next_token'


def encode_next_token(last_evaluated_key: dict[str, Any] | None) -> str | None:
    """Opaque, URL-safe continuation token for a scan's ``LastEvaluatedKey``."""
    if not last_evaluated_key:
        return None
    raw = json.dumps(last_evaluated_key, separators=(',', ':'), sort_keys=True, default=str)
    return base64.urlsafe_b64encode(raw.encode('utf-8')).decode('ascii').rstrip('=')


def decode_next_token(token: str) -> dict[str, str] | None:
    """The ``ExclusiveStartKey`` a token encodes, or ``None`` when it is malformed.

    The Keywords table's only key attribute is ``id``, so a valid token decodes
    to exactly ``{"id": <non-empty string>}``.
    """
    padded = token + '=' * (-len(token) % 4)
    try:
        raw = base64.b64decode(padded.encode('ascii'), altchars=b'-_', validate=True)
        decoded = json.loads(raw.decode('utf-8'))
    # binascii.Error, UnicodeError and JSONDecodeError are all ValueErrors.
    except ValueError:
        return None
    if not isinstance(decoded, dict) or set(decoded) != {'id'}:
        return None
    key_value = decoded['id']
    if not isinstance(key_value, str) or not key_value:
        return None
    return {'id': key_value}


def build_scan_params(
    *,
    limit: int,
    authoritative: bool,
    status: str | None,
    priority: str | None,
    group_id: str | None,
) -> dict[str, Any]:
    """Keyword arguments for one Keywords-table scan page."""
    scan_params: dict[str, Any] = {'Limit': limit}
    if authoritative:
        scan_params['ConsistentRead'] = True

    filter_expressions = []
    expression_values: dict[str, Any] = {}
    expression_names: dict[str, str] = {}

    if status:
        filter_expressions.append('#status = :status')
        expression_names['#status'] = 'status'
        expression_values[':status'] = status

    if priority:
        filter_expressions.append('priority = :priority')
        expression_values[':priority'] = priority

    if group_id:
        filter_expressions.append('contains(group_ids, :group_id)')
        expression_values[':group_id'] = group_id

    if filter_expressions:
        scan_params['FilterExpression'] = ' AND '.join(filter_expressions)
        scan_params['ExpressionAttributeValues'] = expression_values
        if expression_names:
            scan_params['ExpressionAttributeNames'] = expression_names
    return scan_params


@api_handler
@validate({
    'status': {'choices': VALID_STATUSES},
    'priority': {'choices': VALID_PRIORITIES},
    'group_id': {'type': str, 'max_length': 64},
    'limit': optional_limit(default=1000, max_val=1000),
    'authoritative': {'type': bool, 'default': False},
    'next_token': {'type': str, 'max_length': MAX_NEXT_TOKEN_LENGTH},
})
def handler(
    event,
    context,
    status=None,
    priority=None,
    group_id=None,
    limit=1000,
    authoritative=False,
    next_token=None,
):
    """
    GET /api/keywords

    Returns ONE scan page: ``{"keywords": [...], "count": n, "next_token": str | null}``.
    Pages come back in table scan order; a client that wants every keyword
    follows ``next_token`` until it is null and sorts the assembled list.

    Query params (all optional):
        - status: Filter by status (active, inactive, paused)
        - priority: Filter by priority (high, normal, low)
        - group_id: Only keywords that belong to this keyword group
        - limit: Items DynamoDB evaluates for this page, before the filters
          (default: 1000, max: 1000); a filtered page can be short or empty
          while ``next_token`` is still set
        - authoritative: Strongly consistent read of this page when true
        - next_token: Continuation token from the previous page
    """
    scan_params = build_scan_params(
        limit=limit,
        authoritative=authoritative,
        status=status,
        priority=priority,
        group_id=group_id,
    )
    if next_token is not None:
        exclusive_start_key = decode_next_token(next_token)
        if exclusive_start_key is None:
            return validation_error(_MALFORMED_CURSOR_MESSAGE, event, 'next_token')
        scan_params['ExclusiveStartKey'] = exclusive_start_key

    response = keywords_table.scan(**scan_params)
    items = [serialize_keyword_item(item) for item in response.get('Items', [])]

    return success_response({
        'keywords': items,
        'count': len(items),
        'next_token': encode_next_token(response.get('LastEvaluatedKey')),
    }, event)
