"""
Trigger Keyword Analysis API Lambda

Starts a Step Functions execution with specific keywords.
"""

import json
import boto3
import sys
import logging
from typing import Dict, Any, List
import os
from datetime import datetime

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.decorators import api_handler, parse_json_body, validate
from shared.api_response import success_response, validation_error
from boto3.dynamodb.conditions import Key

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

stepfunctions = boto3.client('stepfunctions')
dynamodb = boto3.resource('dynamodb')

STATE_MACHINE_ARN = os.environ['STATE_MACHINE_ARN']
QUERY_PROMPTS_TABLE = os.environ.get('QUERY_PROMPTS_TABLE', 'CitationAnalysis-QueryPrompts')

query_prompts_table = dynamodb.Table(QUERY_PROMPTS_TABLE)


@api_handler
@parse_json_body
@validate({
    'keywords': {'required': True, 'source': 'body'}
})
def handler(event: Dict[str, Any], context: Any, body: Dict, keywords) -> Dict[str, Any]:
    """
    POST /api/trigger-keyword-analysis
    
    Body: {
        "keywords": ["keyword1", "keyword2"]  // Array of keyword strings
    }
    
    Starts a Step Functions execution with the specified keywords.
    """
    keywords_input = keywords
    
    if not keywords_input:
        return validation_error('No keywords provided. Please provide a "keywords" array in the request body.', event, 'keywords')
    
    # Ensure keywords is a list
    if isinstance(keywords_input, str):
        keywords_input = [keywords_input]
    
    # Input validation - limit number of keywords
    if len(keywords_input) > 100:
        return validation_error('Too many keywords (max 100)', event, 'keywords')
    
    # Format keywords for Step Functions
    keyword_list = []
    for kw in keywords_input:
        keyword_text = kw if isinstance(kw, str) else kw.get('keyword', '')
        # Validate each keyword length
        if keyword_text and len(keyword_text) <= 500:
            keyword_list.append({
                'keyword': keyword_text,
                'timestamp': datetime.utcnow().isoformat() + 'Z'
            })
    
    if not keyword_list:
        return validation_error('No valid keywords provided.', event, 'keywords')
    
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
    except Exception as e:
        logger.warning(f"Could not fetch query prompts, proceeding without them: {e}")
    
    # Start Step Functions execution
    execution_name = f"keyword-analysis-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}"
    
    execution_response = stepfunctions.start_execution(
        stateMachineArn=STATE_MACHINE_ARN,
        name=execution_name,
        input=json.dumps({
            'keywords': keyword_list,
            'query_prompts': query_prompts
        })
    )
    
    return success_response({
        'execution_arn': execution_response['executionArn'],
        'execution_name': execution_name,
        'start_date': execution_response['startDate'].isoformat(),
        'keywords_count': len(keyword_list),
        'query_prompts_count': len(query_prompts),
        'keywords': [kw['keyword'] for kw in keyword_list],
        'message': f'Analysis started for {len(keyword_list)} keyword(s) with {len(query_prompts)} query prompts'
    }, event)
