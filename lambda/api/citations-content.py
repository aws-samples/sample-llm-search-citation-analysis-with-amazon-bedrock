"""
Citations & Content Consolidated API Lambda

Routes requests to the appropriate handler based on API Gateway resource path.
Consolidates 5 separate Lambdas into one:
- GET /api/citations -> get-citations handler
- GET /api/url-breakdown -> get-url-breakdown handler
- GET /api/searches -> get-searches handler
- GET /api/crawled-content -> get-crawled-content handler
- GET /api/raw-responses/* -> browse-raw-responses handler
"""

import logging
import sys

# Shared layer path (populated by the Lambda layer at /opt/python)
sys.path.insert(0, '/opt/python')

from shared.api_response import not_found_response
from shared.router import HandlerLoader

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

ROUTE_MAP = {
    '/api/citations': 'get-citations.py',
    '/api/url-breakdown': 'get-url-breakdown.py',
    '/api/searches': 'get-searches.py',
    '/api/crawled-content': 'get-crawled-content.py',
    '/api/raw-responses': 'browse-raw-responses.py',
}

_handlers = HandlerLoader(__file__)


def handler(event, context):
    """Router handler that dispatches based on API Gateway resource path."""
    resource = event.get('resource', '')
    path = event.get('path', '')

    logger.info(f"Routing request: resource={resource}, path={path}")

    for route_path, filename in ROUTE_MAP.items():
        if resource.startswith(route_path) or path.startswith(route_path):
            logger.info(f"Matched route {route_path} -> {filename}")
            return _handlers.get(filename)(event, context)

    logger.error(f"No route matched for resource={resource}, path={path}")
    return not_found_response(resource='Route', event=event)
