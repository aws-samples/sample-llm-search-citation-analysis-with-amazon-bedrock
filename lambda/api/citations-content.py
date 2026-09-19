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

import sys

# Shared layer path (populated by the Lambda layer at /opt/python)
sys.path.insert(0, '/opt/python')

from shared.consolidated_router import route_map_handler

ROUTE_MAP = {
    '/api/citations': 'get-citations.py',
    '/api/url-breakdown': 'get-url-breakdown.py',
    '/api/searches': 'get-searches.py',
    '/api/crawled-content': 'get-crawled-content.py',
    '/api/raw-responses': 'browse-raw-responses.py',
}

handler = route_map_handler(__file__, ROUTE_MAP, __name__)
