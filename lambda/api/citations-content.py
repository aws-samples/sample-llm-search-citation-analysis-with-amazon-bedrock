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

from shared.router import HandlerLoader, dispatch_route

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
    return dispatch_route(event, context, ROUTE_MAP, _handlers, logger)
