"""
Get Keywords API Lambda

Returns all keywords from the Keywords table.
"""

import logging
import sys

import boto3

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import success_response
from shared.decorators import api_handler, optional_limit, validate
from shared.env_vars import resolve_table_env

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables (audit #12 canonical naming).
KEYWORDS_TABLE = resolve_table_env('DYNAMODB_TABLE_KEYWORDS', 'KEYWORDS_TABLE')
keywords_table = dynamodb.Table(KEYWORDS_TABLE)

# Valid values
VALID_STATUSES = ['active', 'inactive', 'paused']
VALID_PRIORITIES = ['high', 'normal', 'low']


@api_handler
@validate({
    'status': {'choices': VALID_STATUSES},
    'priority': {'choices': VALID_PRIORITIES},
    'limit': optional_limit(default=500, max_val=1000),
    'authoritative': {'type': bool, 'default': False},
})
def handler(event, context, status=None, priority=None, limit=500, authoritative=False):
    """
    GET /api/keywords

    Query params (all optional):
        - status: Filter by status (active, inactive, paused)
        - priority: Filter by priority (high, normal, low)
        - limit: Maximum number of ordinary results (default: 500, max: 1000)
        - authoritative: Read and return every matching keyword when true
    """
    # Authoritative reads are unbounded; DynamoDB controls each scan page size.
    scan_params = {'ConsistentRead': True} if authoritative else {'Limit': limit}
    filter_expressions = []
    expression_values = {}
    expression_names = {}

    if status:
        filter_expressions.append('#status = :status')
        expression_names['#status'] = 'status'
        expression_values[':status'] = status

    if priority:
        filter_expressions.append('priority = :priority')
        expression_values[':priority'] = priority

    if filter_expressions:
        scan_params['FilterExpression'] = ' AND '.join(filter_expressions)
        scan_params['ExpressionAttributeValues'] = expression_values
        if expression_names:
            scan_params['ExpressionAttributeNames'] = expression_names

    items = []
    while True:
        response = keywords_table.scan(**scan_params)
        items.extend(response.get('Items', []))

        last_evaluated_key = response.get('LastEvaluatedKey')
        if not authoritative or not last_evaluated_key:
            break
        scan_params['ExclusiveStartKey'] = last_evaluated_key

    # Sort the complete result, or the ordinary first page, by created_at descending.
    items.sort(key=lambda item: item.get('created_at', ''), reverse=True)

    response_body = {
        'keywords': items,
        'count': len(items),
    }
    if authoritative:
        response_body['complete'] = True

    return success_response(response_body, event)
