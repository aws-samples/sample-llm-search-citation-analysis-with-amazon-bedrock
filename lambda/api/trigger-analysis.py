"""
Trigger Analysis API Lambda

Starts a Step Functions execution with keywords from DynamoDB.
Uses efficient query with StatusIndex GSI instead of scan with filter.
"""

import json
import boto3
from boto3.dynamodb.conditions import Key
from typing import Dict, Any
import os
from datetime import datetime
import logging
import sys

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.decorators import api_handler
from shared.api_response import success_response, validation_error

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

stepfunctions = boto3.client('stepfunctions')
dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
STATE_MACHINE_ARN = os.environ['STATE_MACHINE_ARN']
KEYWORDS_TABLE = os.environ['KEYWORDS_TABLE']
QUERY_PROMPTS_TABLE = os.environ.get('QUERY_PROMPTS_TABLE', 'CitationAnalysis-QueryPrompts')

keywords_table = dynamodb.Table(KEYWORDS_TABLE)
query_prompts_table = dynamodb.Table(QUERY_PROMPTS_TABLE)


@api_handler
def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    POST /api/trigger-analysis
    
    Starts a Step Functions execution with active keywords from DynamoDB.
    Uses StatusIndex GSI for efficient querying of active keywords.
    """
    # Get active keywords using StatusIndex GSI (more efficient than scan with filter)
    try:
        response = keywords_table.query(
            IndexName='StatusIndex',
            KeyConditionExpression=Key('status').eq('active'),
            Limit=500  # Cap to prevent runaway queries
        )
        keywords = response.get('Items', [])
    except Exception as gsi_error:
        # Fallback to scan if GSI doesn't exist (for backwards compatibility)
        logger.warning(f"StatusIndex GSI not available, falling back to scan: {gsi_error}")
        response = keywords_table.scan(
            FilterExpression='#status = :status',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues={':status': 'active'},
            Limit=500
        )
        keywords = response.get('Items', [])
    
    if not keywords:
        return validation_error('No active keywords found. Please add keywords first.', event)
    
    # Format keywords for Step Functions
    keyword_list = [
        {
            'keyword': kw['keyword'],
            'timestamp': datetime.utcnow().isoformat() + 'Z'
        }
        for kw in keywords
    ]
    
    # Fetch enabled query prompts
    query_prompts = []
    try:
        prompts_response = query_prompts_table.query(
            IndexName='EnabledIndex',
            KeyConditionExpression=Key('enabled').eq('true'),
            Limit=10
        )
        for p in prompts_response.get('Items', []):
            query_prompts.append({
                'id': p['id'],
                'name': p.get('name', ''),
                'template': p.get('template', ''),
            })
        logger.info(f"Found {len(query_prompts)} enabled query prompts")
    except Exception as e:
        logger.warning(f"Could not fetch query prompts, proceeding without them: {e}")
    
    # Start Step Functions execution
    execution_name = f"analysis-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}"
    
    execution_response = stepfunctions.start_execution(
        stateMachineArn=STATE_MACHINE_ARN,
        name=execution_name,
        input=json.dumps({
            'keywords': keyword_list,
            'query_prompts': query_prompts
        })
    )
    
    prompt_count = len(query_prompts)
    result = {
        'execution_arn': execution_response['executionArn'],
        'execution_name': execution_name,
        'start_date': execution_response['startDate'].isoformat(),
        'keywords_count': len(keyword_list),
        'query_prompts_count': prompt_count,
        'message': f'Analysis started with {len(keyword_list)} keywords and {prompt_count} query prompts'
    }
    
    return success_response(result, event)
