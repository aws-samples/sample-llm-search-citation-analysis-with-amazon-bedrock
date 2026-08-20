"""
Manage Query Prompts API Lambda

CRUD operations for query prompt templates with persona modifiers.
Each prompt contains a {keyword} placeholder that gets substituted during analysis.
"""

import logging
import os
import sys
import uuid

import boto3

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import success_response, validation_error
from shared.auth import ADMIN_GROUP, require_group
from shared.constants import MAX_QUERY_PROMPTS_DEFAULT
from shared.decorators import api_handler, parse_json_body, validate
from shared.env_vars import resolve_table_env
from shared.utils import get_timestamp

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables (audit #12 canonical naming).
QUERY_PROMPTS_TABLE = resolve_table_env(
    'DYNAMODB_TABLE_QUERY_PROMPTS', 'QUERY_PROMPTS_TABLE',
)
query_prompts_table = dynamodb.Table(QUERY_PROMPTS_TABLE)

# Soft business cap — bounded per-user prompts. Override with
# `MAX_QUERY_PROMPTS` env var at deploy time. Must be <= the scan Limit in
# `list_prompts` below; bumping this without also raising the scan limit
# would silently truncate the UI.
MAX_PROMPTS = int(os.environ.get('MAX_QUERY_PROMPTS', MAX_QUERY_PROMPTS_DEFAULT))


@api_handler
def handler(event, context):
    """
    GET    /api/query-prompts           - List all prompts
    POST   /api/query-prompts           - Create prompt
    PUT    /api/query-prompts/{id}      - Update prompt
    DELETE /api/query-prompts/{id}      - Delete prompt
    PATCH  /api/query-prompts/{id}      - Toggle enabled/disabled
    """
    method = event.get('httpMethod')
    path_params = event.get('pathParameters') or {}
    prompt_id = path_params.get('id')

    if method == 'GET':
        return list_prompts(event, context)
    elif method == 'POST':
        return create_prompt(event, context)
    elif method == 'PUT':
        return update_prompt(event, context, prompt_id)
    elif method == 'DELETE':
        return delete_prompt(event, context, prompt_id)
    elif method == 'PATCH':
        return toggle_prompt(event, context, prompt_id)
    else:
        return validation_error('Method not allowed', event)


def list_prompts(event, context):
    """GET /api/query-prompts - List all query prompts."""
    # Scan with headroom over MAX_PROMPTS so tuning the cap upward doesn't
    # silently truncate the UI. 5x buffer is arbitrary but comfortable for
    # the business-soft-cap scale.
    response = query_prompts_table.scan(Limit=max(50, MAX_PROMPTS * 5))
    items = response.get('Items', [])
    # Sort by created_at descending
    items.sort(key=lambda x: x.get('created_at', ''), reverse=True)
    return success_response(items, event)


@require_group(ADMIN_GROUP)
@parse_json_body
@validate({
    'name': {'required': True, 'type': str, 'max_length': 100, 'source': 'body'},
    'template': {'required': True, 'type': str, 'max_length': 2000, 'source': 'body'},
    'description': {'type': str, 'max_length': 1000, 'source': 'body'},
})
def create_prompt(event, context, body, name, template, description):
    """POST /api/query-prompts - Create a new query prompt (persona).

    Admin-only: every persona multiplies each analysis run's provider spend by
    one. `list_prompts` stays open so the dashboard can show the active set.
    """
    # Validate template contains {keyword}
    if '{keyword}' not in template:
        return validation_error(
            'Template must contain {keyword} placeholder', event, 'template'
        )

    # Enforce max prompts limit
    existing = query_prompts_table.scan(Select='COUNT')
    if existing.get('Count', 0) >= MAX_PROMPTS:
        return validation_error(
            f'Maximum of {MAX_PROMPTS} query prompts allowed', event
        )

    prompt_id = str(uuid.uuid4())
    timestamp = get_timestamp()

    item = {
        'id': prompt_id,
        'name': name,
        'template': template,
        'enabled': 'true',
        'created_at': timestamp,
        'updated_at': timestamp,
    }

    if description:
        item['description'] = description

    query_prompts_table.put_item(Item=item)
    return success_response(item, event, 201)


@require_group(ADMIN_GROUP)
@parse_json_body
@validate({
    'name': {'type': str, 'max_length': 100, 'source': 'body'},
    'template': {'type': str, 'max_length': 2000, 'source': 'body'},
    'description': {'type': str, 'max_length': 1000, 'source': 'body'},
})
def update_prompt(event, context, prompt_id, body, name, template, description):
    """PUT /api/query-prompts/{id} - Update a query prompt (persona)."""
    if not prompt_id:
        return validation_error('Prompt ID is required', event, 'id')

    # Validate template if provided
    if template and '{keyword}' not in template:
        return validation_error(
            'Template must contain {keyword} placeholder', event, 'template'
        )

    timestamp = get_timestamp()

    update_expr = 'SET updated_at = :u'
    expr_values = {':u': timestamp}

    if name is not None:
        update_expr += ', #n = :n'
        expr_values[':n'] = name
    if template is not None:
        update_expr += ', template = :t'
        expr_values[':t'] = template
    if description is not None:
        update_expr += ', description = :d'
        expr_values[':d'] = description

    expr_names = {'#n': 'name'} if name is not None else {}

    update_kwargs = {
        'Key': {'id': prompt_id},
        'UpdateExpression': update_expr,
        'ExpressionAttributeValues': expr_values,
        'ReturnValues': 'ALL_NEW',
    }
    if expr_names:
        update_kwargs['ExpressionAttributeNames'] = expr_names

    response = query_prompts_table.update_item(**update_kwargs)

    return success_response(response['Attributes'], event)


@require_group(ADMIN_GROUP)
def delete_prompt(event, context, prompt_id):
    """DELETE /api/query-prompts/{id} - Delete a query prompt."""
    if not prompt_id:
        return validation_error('Prompt ID is required', event, 'id')

    query_prompts_table.delete_item(Key={'id': prompt_id})
    return success_response({'message': 'Query prompt deleted successfully'}, event)


@require_group(ADMIN_GROUP)
def toggle_prompt(event, context, prompt_id):
    """PATCH /api/query-prompts/{id} - Toggle enabled/disabled."""
    if not prompt_id:
        return validation_error('Prompt ID is required', event, 'id')

    # Get current state
    response = query_prompts_table.get_item(Key={'id': prompt_id})
    item = response.get('Item')
    if not item:
        return validation_error('Query prompt not found', event, 'id')

    new_enabled = 'false' if item.get('enabled') == 'true' else 'true'
    timestamp = get_timestamp()

    result = query_prompts_table.update_item(
        Key={'id': prompt_id},
        UpdateExpression='SET enabled = :e, updated_at = :u',
        ExpressionAttributeValues={':e': new_enabled, ':u': timestamp},
        ReturnValues='ALL_NEW',
    )

    return success_response(result['Attributes'], event)
