"""
Get Keywords API Lambda

Returns all keywords from the Keywords table.
"""

import logging
import boto3
import os
import sys

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.decorators import api_handler, validate, optional_limit
from shared.api_response import success_response

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
KEYWORDS_TABLE = os.environ['KEYWORDS_TABLE']
keywords_table = dynamodb.Table(KEYWORDS_TABLE)

# Valid values
VALID_STATUSES = ['active', 'inactive', 'paused']
VALID_PRIORITIES = ['high', 'normal', 'low']


@api_handler
@validate({
    'status': {'choices': VALID_STATUSES},
    'priority': {'choices': VALID_PRIORITIES},
    'limit': optional_limit(default=500, max_val=1000)
})
def handler(event, context, status=None, priority=None, limit=500):
    """
    GET /api/keywords
    
    Query params (all optional):
        - status: Filter by status (active, inactive, paused)
        - priority: Filter by priority (high, normal, low)
        - limit: Maximum number of results (default: 500, max: 1000)
    """
    # Build scan parameters with optional filters
    scan_params = {'Limit': limit}
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
    
    # Scan keywords table
    response = keywords_table.scan(**scan_params)
    items = response.get('Items', [])
    
    # Sort by created_at descending
    items.sort(key=lambda x: x.get('created_at', ''), reverse=True)
    
    return success_response({
        'keywords': items,
        'count': len(items)
    }, event)
