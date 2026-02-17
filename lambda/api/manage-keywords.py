"""
Manage Keywords API Lambda

Handles POST, PUT, DELETE operations for keywords.
"""

import boto3
import os
import sys
import logging
from datetime import datetime
import uuid

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.decorators import api_handler, parse_json_body, validate
from shared.api_response import success_response, validation_error

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
KEYWORDS_TABLE = os.environ['KEYWORDS_TABLE']
keywords_table = dynamodb.Table(KEYWORDS_TABLE)


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
    elif method == 'PUT':
        return update_keyword(event, context, path_params.get('id'))
    elif method == 'DELETE':
        return delete_keyword(event, context, path_params.get('id'))
    else:
        return validation_error('Method not allowed', event)


@parse_json_body
@validate({
    'keyword': {'required': True, 'type': str, 'max_length': 500, 'source': 'body'},
    'region': {'type': str, 'max_length': 50, 'default': 'global', 'source': 'body'},
    'language': {'type': str, 'max_length': 10, 'default': 'en', 'source': 'body'},
    'category': {'type': str, 'max_length': 100, 'default': '', 'source': 'body'},
    'priority': {'choices': ['high', 'normal', 'low'], 'default': 'normal', 'source': 'body'},
    'notes': {'type': str, 'max_length': 1000, 'default': '', 'source': 'body'}
})
def create_keyword(event, context, body, keyword, region, language, category, priority, notes):
    """Create a new keyword with optional region/language support."""
    keyword_id = str(uuid.uuid4())
    timestamp = datetime.utcnow().isoformat() + 'Z'
    
    item = {
        'id': keyword_id,
        'keyword': keyword,
        'status': 'active',
        'created_at': timestamp,
        'updated_at': timestamp,
        'region': region,
        'language': language,
        'category': category,
        'priority': priority,
        'notes': notes
    }
    
    keywords_table.put_item(Item=item)
    
    return success_response(item, event, 201)


@parse_json_body
@validate({
    'keyword': {'required': True, 'type': str, 'max_length': 500, 'source': 'body'},
    'status': {'choices': ['active', 'inactive', 'paused'], 'default': 'active', 'source': 'body'},
    'region': {'type': str, 'max_length': 50, 'source': 'body'},
    'language': {'type': str, 'max_length': 10, 'source': 'body'},
    'category': {'type': str, 'max_length': 100, 'source': 'body'},
    'priority': {'choices': ['high', 'normal', 'low'], 'source': 'body'},
    'notes': {'type': str, 'max_length': 1000, 'source': 'body'}
})
def update_keyword(event, context, keyword_id, body, keyword, status, region, language, category, priority, notes):
    """Update an existing keyword with region/language support."""
    if not keyword_id:
        return validation_error('Keyword ID is required', event, 'id')
    
    timestamp = datetime.utcnow().isoformat() + 'Z'
    
    # Build update expression dynamically for optional fields
    update_expr = 'SET keyword = :k, #s = :st, updated_at = :u'
    expr_names = {'#s': 'status'}
    expr_values = {
        ':k': keyword,
        ':st': status,
        ':u': timestamp
    }
    
    # Add optional fields if provided
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
    
    # Update the item
    response = keywords_table.update_item(
        Key={'id': keyword_id},
        UpdateExpression=update_expr,
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
        ReturnValues='ALL_NEW'
    )
    
    return success_response(response['Attributes'], event)


def delete_keyword(event, context, keyword_id):
    """Delete a keyword."""
    if not keyword_id:
        return validation_error('Keyword ID is required', event, 'id')
    
    keywords_table.delete_item(Key={'id': keyword_id})
    
    return success_response({'message': 'Keyword deleted successfully'}, event)
