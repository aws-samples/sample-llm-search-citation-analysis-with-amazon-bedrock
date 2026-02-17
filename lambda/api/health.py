"""
Health Check Endpoint

Simple health check for monitoring and load balancer integration.
Returns 200 OK with system status.
"""

import json
import logging
from datetime import datetime

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)


def handler(event, context):
    """
    Health check handler.
    
    Returns:
        200 OK with timestamp and status
    """
    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
        'body': json.dumps({
            'status': 'healthy',
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'service': 'citation-analysis-api',
        })
    }
