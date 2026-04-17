"""
Keyword Management Consolidated API Lambda

Routes:
- GET /api/keywords -> get-keywords handler
- POST/PUT/DELETE /api/keywords/* -> manage-keywords handler
- POST/GET/DELETE /api/keyword-research/* -> keyword-research handler
"""

import logging
import sys

# Shared layer path (populated by the Lambda layer at /opt/python)
sys.path.insert(0, '/opt/python')

from shared.api_response import not_found_response
from shared.router import HandlerLoader

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

_handlers = HandlerLoader(__file__)


def handler(event, context):
    resource = event.get('resource', '')
    path = event.get('path', '')
    method = event.get('httpMethod', 'GET')

    logger.info(f"Routing: resource={resource}, path={path}, method={method}")

    # keyword-research routes take priority (longer prefix)
    if resource.startswith('/api/keyword-research') or path.startswith('/api/keyword-research'):
        return _handlers.get('keyword-research.py')(event, context)

    # /api/keywords routes: GET list goes to get-keywords, mutations go to manage-keywords
    if resource.startswith('/api/keywords') or path.startswith('/api/keywords'):
        if method == 'GET' and not (event.get('pathParameters') or {}).get('id'):
            return _handlers.get('get-keywords.py')(event, context)
        return _handlers.get('manage-keywords.py')(event, context)

    logger.error(f"No route matched for resource={resource}, path={path}")
    return not_found_response(resource='Route', event=event)
