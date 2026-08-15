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
from shared.decorators import api_handler, parse_json_body, validate
from shared.env_vars import resolve_table_env
from shared.utils import (
    get_timestamp,
    is_unicode_scalar_text,
    keyword_id,
    load_keyword_identities,
    normalize_keyword,
    trim_keyword,
)

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables (audit #12 canonical naming).
KEYWORDS_TABLE = resolve_table_env('DYNAMODB_TABLE_KEYWORDS', 'KEYWORDS_TABLE')
keywords_table = dynamodb.Table(KEYWORDS_TABLE)

MAX_KEYWORD_LENGTH = 500


@api_handler
def handler(event, context):
    """
    POST /api/keywords - Create new keyword
    PUT /api/keywords/{id} - Update keyword
    DELETE /api/keywords/{id} - Delete keyword
    """
    # Manual routing preferred here: PUT/DELETE need path param extraction
    # which @route_handler doesn't handle automatically
    method = event.get('httpMethod')
    path_params = event.get('pathParameters') or {}

    if method == 'POST':
        return create_keyword(event, context)
    if method == 'PUT':
        return update_keyword(event, context, keyword_id=path_params.get('id'))
    if method == 'DELETE':
        return delete_keyword(event, context, path_params.get('id'))
    return validation_error('Method not allowed', event)


def _validated_keyword(keyword, event):
    """Validate and explicitly trim a keyword without runtime-specific strip."""
    if not isinstance(keyword, str):
        return None, validation_error('Keyword must be a string', event, 'keyword')
    if not is_unicode_scalar_text(keyword):
        return None, validation_error(
            'Keyword must contain valid Unicode scalar values', event, 'keyword'
        )

    text = trim_keyword(keyword)
    if not text:
        return None, validation_error('Keyword must not be empty', event, 'keyword')
    if len(text) > MAX_KEYWORD_LENGTH:
        return None, validation_error(
            f'Keyword exceeds maximum length of {MAX_KEYWORD_LENGTH} characters',
            event,
            'keyword',
        )
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
    'priority': {'choices': ['high', 'normal', 'low'], 'default': 'normal', 'source': 'body'},
    'notes': {'type': str, 'max_length': 1000, 'default': '', 'source': 'body'}
})
def create_keyword(event, context, body, keyword, region, language, category, priority, notes):
    """Create a keyword under its canonical deterministic identity."""
    text, error = _validated_keyword(keyword, event)
    if error:
        return error

    identity = normalize_keyword(text)
    if identity in load_keyword_identities(keywords_table):
        return _duplicate_response(event)

    item_id = keyword_id(text)
    timestamp = get_timestamp()
    item = {
        'id': item_id,
        'keyword': text,
        'status': 'active',
        'created_at': timestamp,
        'updated_at': timestamp,
        'region': region,
        'language': language,
        'category': category,
        'priority': priority,
        'notes': notes
    }

    try:
        keywords_table.put_item(
            Item=item,
            ConditionExpression='attribute_not_exists(#id)',
            ExpressionAttributeNames={'#id': 'id'},
        )
    except ClientError as write_error:
        if not _is_conditional_conflict(write_error):
            raise
        return _duplicate_response(event)

    return success_response(item, event, 201)


@parse_json_body
@validate({
    'keyword': {'required': True, 'source': 'body'},
    'status': {'choices': ['active', 'inactive', 'paused'], 'default': 'active', 'source': 'body'},
    'region': {'type': str, 'max_length': 50, 'source': 'body'},
    'language': {'type': str, 'max_length': 10, 'source': 'body'},
    'category': {'type': str, 'max_length': 100, 'source': 'body'},
    'priority': {'choices': ['high', 'normal', 'low'], 'source': 'body'},
    'notes': {'type': str, 'max_length': 1000, 'source': 'body'}
})
def update_keyword(event, context, keyword_id, body, keyword, status, region, language, category, priority, notes):
    """Update display text and metadata without changing canonical identity."""
    if not keyword_id:
        return validation_error('Keyword ID is required', event, 'id')

    text, error = _validated_keyword(keyword, event)
    if error:
        return error

    existing = keywords_table.get_item(
        Key={'id': keyword_id},
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

    try:
        response = keywords_table.update_item(
            Key={'id': keyword_id},
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

    return success_response(response['Attributes'], event)


def delete_keyword(event, context, keyword_id):
    """Delete a keyword only when its row still exists."""
    if not keyword_id:
        return validation_error('Keyword ID is required', event, 'id')

    try:
        keywords_table.delete_item(
            Key={'id': keyword_id},
            ConditionExpression='attribute_exists(#id)',
            ExpressionAttributeNames={'#id': 'id'},
        )
    except ClientError as write_error:
        if not _is_conditional_conflict(write_error):
            raise
        return api_response(404, {'error': 'Keyword not found'}, event)

    return success_response({'message': 'Keyword deleted successfully'}, event)
