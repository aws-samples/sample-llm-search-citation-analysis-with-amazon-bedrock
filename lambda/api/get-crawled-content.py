"""
Get Crawled Content API

Retrieves crawled content including screenshots and SEO analysis.
"""

import os
import sys
import logging
import boto3
from boto3.dynamodb.conditions import Key

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.decorators import api_handler, validate, optional_limit
from shared.api_response import success_response

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')

# Fail-fast: Required environment variables
CRAWLED_CONTENT_TABLE = os.environ['CRAWLED_CONTENT_TABLE']


def generate_presigned_url(s3_uri: str, expiration: int = 900) -> str:
    """Generate a presigned URL for S3 object.
    
    Args:
        s3_uri: S3 URI (s3://bucket/key)
        expiration: URL expiration in seconds (default: 900 = 15 minutes)
    """
    try:
        if not s3_uri or not s3_uri.startswith('s3://'):
            return None
        
        parts = s3_uri.replace('s3://', '').split('/', 1)
        bucket = parts[0]
        key = parts[1] if len(parts) > 1 else ''
        
        url = s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': bucket, 'Key': key},
            ExpiresIn=expiration
        )
        return url
    except Exception as e:
        logger.error(f"Error generating presigned URL: {str(e)}")
        return None


@api_handler
@validate({
    'url': {'type': str, 'max_length': 2048},
    'keyword': {'type': str, 'max_length': 500},
    'limit': optional_limit(default=50, max_val=500),
    'include_screenshot_url': {'type': bool, 'default': True},
    'include_history': {'type': bool, 'default': False}
})
def handler(event, context, url=None, keyword=None, limit=50, include_screenshot_url=True, include_history=False):
    """
    API handler to get crawled content with screenshots and SEO analysis.
    
    Query params:
        - url: Specific URL (optional)
        - keyword: Filter by keyword (optional)
        - limit: Number of results (default: 50)
        - include_screenshot_url: Generate presigned URLs for screenshots (default: true)
        - include_history: Include all historical crawls for the URL (default: false)
    """
    table = dynamodb.Table(CRAWLED_CONTENT_TABLE)
    
    # Query by URL or scan with filters
    if url:
        # If include_history, get all crawls for this URL; otherwise just the latest
        query_limit = limit if include_history else 1
        response = table.query(
            KeyConditionExpression=Key('normalized_url').eq(url),
            Limit=query_limit,
            ScanIndexForward=False  # Most recent first
        )
        items = response.get('Items', [])
    elif keyword:
        response = table.query(
            IndexName='KeywordIndex',
            KeyConditionExpression=Key('keyword').eq(keyword),
            ScanIndexForward=False,
            Limit=limit
        )
        items = response.get('Items', [])
    else:
        response = table.scan(Limit=limit)
        items = response.get('Items', [])
    
    # Generate presigned URLs for screenshots
    if include_screenshot_url:
        for item in items:
            if 'screenshot_s3_uri' in item and item['screenshot_s3_uri']:
                screenshot_url = generate_presigned_url(item['screenshot_s3_uri'])
                if screenshot_url:
                    item['screenshot_url'] = screenshot_url
    
    # Sort by crawled_at descending
    items.sort(key=lambda x: x.get('crawled_at', ''), reverse=True)
    
    return success_response({
        'items': items,
        'count': len(items)
    }, event)
