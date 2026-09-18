"""
Manage Keywords API Lambda

Handles POST, PUT, DELETE operations for keywords.
"""

import logging
import sys

import boto3
from botocore.exceptions import ClientError

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import api_response, success_response, validation_error
from shared.decorators import api_handler, parse_json_body, route_handler, validate
from shared.env_vars import resolve_table_env
from shared.keyword_groups import (
    KEYWORD_GROUPS_TABLE_ENV,
    MAX_GROUPS_PER_KEYWORD,
    load_existing_group_ids,
    serialize_keyword_item,
    validate_id_list,
)
from shared.keyword_store import (
    ALLOWED_KEYWORD_PRIORITIES,
    ALLOWED_KEYWORD_STATUSES,
    build_keyword_item,
    put_keyword_if_absent,
    validate_keyword_text,
)
from shared.utils import get_timestamp, load_keyword_identities, normalize_keyword

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables (audit #12 canonical naming).
KEYWORDS_TABLE = resolve_table_env('DYNAMODB_TABLE_KEYWORDS', 'KEYWORDS_TABLE')
keywords_table = dynamodb.Table(KEYWORDS_TABLE)
# Optional until every deployment carries the groups table.
GROUPS_TABLE = resolve_table_env(KEYWORD_GROUPS_TABLE_ENV, required=False)
groups_table = dynamodb.Table(GROUPS_TABLE) if GROUPS_TABLE else None


def _validated_group_ids(body, event):
    """Validate an optional ``group_ids`` list and confirm every id exists.

    Returns ``(group_ids, None)`` — ``None`` group_ids when the field was
    omitted — or ``(None, error_response)``.
    """
    if 'group_ids' not in body:
        return None, None
    group_ids, message = validate_id_list(body.get('group_ids'), field='group_ids', limit=MAX_GROUPS_PER_KEYWORD)
    if message:
        return None, validation_error(message, event, 'group_ids')
    if group_ids and groups_table is None:
        return None, validation_error('Keyword groups are not available on this deployment', event, 'group_ids')
    if group_ids:
        unknown = sorted(set(group_ids) - load_existing_group_ids(groups_table, group_ids))
        if unknown:
            return None, validation_error(f"Unknown keyword group ids: {', '.join(unknown)}", event, 'group_ids')
    return group_ids, None


def _validated_keyword(keyword, event):
    """Validate and explicitly trim a keyword without runtime-specific strip.

    Delegates the shared sequence (type → surrogate check → trim → length)
    to ``shared.keyword_store`` — empty-after-trim rejects on this route
    (bugs.md 3.3).
    """
    text, message = validate_keyword_text(keyword)
    if message:
        return None, validation_error(message, event, 'keyword')
    return text, None


def _is_conditional_conflict(error):
    """Return whether a DynamoDB error is a failed write condition."""
    return error.response.get('Error', {}).get('Code') == 'ConditionalCheckFailedException'


def _duplicate_response(event):
    """Return the stable conflict response for an occupied keyword identity."""
    return api_response(409, {'error': 'Keyword already exists'}, event)


@parse_json_body
@validate({
    'keyword': {'required': True, 'source': 'body'},
    'region': {'type': str, 'max_length': 50, 'default': 'global', 'source': 'body'},
    'language': {'type': str, 'max_length': 10, 'default': 'en', 'source': 'body'},
    'category': {'type': str, 'max_length': 100, 'default': '', 'source': 'body'},
    'priority': {'choices': list(ALLOWED_KEYWORD_PRIORITIES), 'default': 'normal', 'source': 'body'},
    'notes': {'type': str, 'max_length': 1000, 'default': '', 'source': 'body'}
})
def create_keyword(event, context, body, keyword, region, language, category, priority, notes):
    """Create a keyword under its canonical deterministic identity."""
    text, error = _validated_keyword(keyword, event)
    if error:
        return error
    group_ids, error = _validated_group_ids(body, event)
    if error:
        return error

    identity = normalize_keyword(text)
    if identity in load_keyword_identities(keywords_table):
        return _duplicate_response(event)

    item = build_keyword_item(
        text,
        timestamp=get_timestamp(),
        region=region,
        language=language,
        category=category,
        priority=priority,
        notes=notes,
    )
    if group_ids:
        item['group_ids'] = set(group_ids)
    if not put_keyword_if_absent(keywords_table, item):
        return _duplicate_response(event)

    return success_response(serialize_keyword_item(item), event, 201)


@parse_json_body
@validate({
    'keyword': {'required': True, 'source': 'body'},
    'status': {'choices': list(ALLOWED_KEYWORD_STATUSES), 'default': 'active', 'source': 'body'},
    'region': {'type': str, 'max_length': 50, 'source': 'body'},
    'language': {'type': str, 'max_length': 10, 'source': 'body'},
    'category': {'type': str, 'max_length': 100, 'source': 'body'},
    'priority': {'choices': list(ALLOWED_KEYWORD_PRIORITIES), 'source': 'body'},
    'notes': {'type': str, 'max_length': 1000, 'source': 'body'}
})
def update_keyword(event, context, body, keyword, status, region, language, category, priority, notes, id=None):
    """Update display text and metadata without changing canonical identity."""
    if not id:
        return validation_error('Keyword ID is required', event, 'id')

    text, error = _validated_keyword(keyword, event)
    if error:
        return error
    group_ids, error = _validated_group_ids(body, event)
    if error:
        return error

    existing = keywords_table.get_item(
        Key={'id': id},
        ConsistentRead=True,
    ).get('Item')
    if not existing:
        return api_response(404, {'error': 'Keyword not found'}, event)

    stored_keyword = existing.get('keyword')
    if (
        not isinstance(stored_keyword, str)
        or normalize_keyword(stored_keyword) != normalize_keyword(text)
    ):
        return api_response(
            409,
            {
                'error': (
                    'Keyword identity cannot be changed; delete it and create '
                    'a new keyword instead'
                )
            },
            event,
        )

    timestamp = get_timestamp()
    update_expr = 'SET #kw = :k, #s = :st, updated_at = :u'
    expr_names = {
        '#id': 'id',
        '#kw': 'keyword',
        '#s': 'status',
    }
    expr_values = {
        ':expected_keyword': stored_keyword,
        ':k': text,
        ':st': status,
        ':u': timestamp
    }

    if region is not None:
        update_expr += ', #r = :r'
        expr_names['#r'] = 'region'
        expr_values[':r'] = region
    if language is not None:
        update_expr += ', #l = :l'
        expr_names['#l'] = 'language'
        expr_values[':l'] = language
    if category is not None:
        update_expr += ', category = :c'
        expr_values[':c'] = category
    if priority is not None:
        update_expr += ', priority = :p'
        expr_values[':p'] = priority
    if notes is not None:
        update_expr += ', notes = :n'
        expr_values[':n'] = notes
    # group_ids: a string set; DynamoDB cannot store an empty set, so an empty
    # list clears the attribute instead.
    if group_ids is not None:
        if group_ids:
            update_expr += ', group_ids = :g'
            expr_values[':g'] = set(group_ids)
        else:
            update_expr += ' REMOVE group_ids'

    try:
        response = keywords_table.update_item(
            Key={'id': id},
            UpdateExpression=update_expr,
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_values,
            ConditionExpression='attribute_exists(#id) AND #kw = :expected_keyword',
            ReturnValues='ALL_NEW'
        )
    except ClientError as write_error:
        if not _is_conditional_conflict(write_error):
            raise
        return api_response(
            409,
            {'error': 'Keyword changed while it was being updated'},
            event,
        )

    return success_response(serialize_keyword_item(response['Attributes']), event)


def delete_keyword(event, context, id=None):
    """Delete a keyword only when its row still exists."""
    if not id:
        return validation_error('Keyword ID is required', event, 'id')

    try:
        keywords_table.delete_item(
            Key={'id': id},
            ConditionExpression='attribute_exists(#id)',
            ExpressionAttributeNames={'#id': 'id'},
        )
    except ClientError as write_error:
        if not _is_conditional_conflict(write_error):
            raise
        return api_response(404, {'error': 'Keyword not found'}, event)

    return success_response({'message': 'Keyword deleted successfully'}, event)


@api_handler
@route_handler({
    'POST': create_keyword,
    'PUT': update_keyword,
    'DELETE': delete_keyword,
}, inject_path_params=True)
def handler(event, context):
    """
    POST /api/keywords - Create new keyword
    PUT /api/keywords/{id} - Update keyword
    DELETE /api/keywords/{id} - Delete keyword

    The ``{id}`` path parameter reaches update/delete as the ``id`` kwarg via
    ``inject_path_params`` — the hand-rolled routing this file used to carry
    (bugs.md 3.4) is gone.
    """
