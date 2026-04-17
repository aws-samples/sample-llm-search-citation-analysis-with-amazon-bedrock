"""
Stats & Insights Consolidated API Lambda

Routes requests to the appropriate handler based on API Gateway resource path.
Consolidates 6 separate Lambdas into one to reduce CloudFormation resource count:
- GET /api/stats -> get-stats handler
- GET /api/visibility -> get-visibility-metrics handler
- GET /api/prompt-insights -> get-prompt-insights handler
- GET /api/citation-gaps -> get-citation-gaps handler
- GET /api/recommendations -> get-recommendations handler
- GET /api/trends -> get-historical-trends handler
"""

import logging
import sys

# Shared layer path (populated by the Lambda layer at /opt/python)
sys.path.insert(0, '/opt/python')

from shared.api_response import not_found_response
from shared.router import HandlerLoader

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Map resource paths to handler module filenames
ROUTE_MAP = {
    '/api/stats': 'get-stats.py',
    '/api/visibility': 'get-visibility-metrics.py',
    '/api/prompt-insights': 'get-prompt-insights.py',
    '/api/citation-gaps': 'get-citation-gaps.py',
    '/api/recommendations': 'get-recommendations.py',
    '/api/trends': 'get-historical-trends.py',
}

_handlers = HandlerLoader(__file__)


def handler(event, context):
    """
    Router handler that dispatches to the correct sub-handler
    based on the API Gateway resource path.
    """
    resource = event.get('resource', '')
    path = event.get('path', '')

    logger.info(f"Routing request: resource={resource}, path={path}")

    # Try resource first (API Gateway template path), then fall back to actual path
    for route_path, filename in ROUTE_MAP.items():
        if resource.startswith(route_path) or path.startswith(route_path):
            logger.info(f"Matched route {route_path} -> {filename}")
            return _handlers.get(filename)(event, context)

    logger.error(f"No route matched for resource={resource}, path={path}")
    return not_found_response(resource='Route', event=event)
