"""
Keyword Management Consolidated API Lambda

Routes:
- GET /api/keywords -> get-keywords handler
- POST /api/keywords/promote -> promote-keywords handler
- POST/PUT/DELETE /api/keywords/* -> manage-keywords handler
- POST/GET/DELETE /api/keyword-research/* -> keyword-research handler
"""

import logging
import sys

# Shared layer path (populated by the Lambda layer at /opt/python)
sys.path.insert(0, '/opt/python')

from shared.api_response import not_found_response
from shared.router import HandlerLoader, path_matches_route

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

_handlers = HandlerLoader(__file__)


def handler(event, context):
    # Async self-invocation events carry no resource/path and must be
    # forwarded to the keyword-research worker before path-based routing.
    if event.get('async_expand') or event.get('async_competitor'):
        return _handlers.get('keyword-research.py')(event, context)

    resource = event.get('resource', '')
    path = event.get('path', '')
    method = event.get('httpMethod', 'GET')

    logger.info(f"Routing: resource={resource}, path={path}, method={method}")

    # keyword-research routes take priority (longer prefix)
    if path_matches_route('/api/keyword-research', resource, path):
        return _handlers.get('keyword-research.py')(event, context)

    # Promotion is more specific than /api/keywords and must be checked first,
    # otherwise POST /api/keywords/promote falls through to manage-keywords.
    if path_matches_route('/api/keywords/promote', resource, path):
        return _handlers.get('promote-keywords.py')(event, context)

    # /api/keywords routes: GET list goes to get-keywords, mutations go to manage-keywords
    if path_matches_route('/api/keywords', resource, path):
        if method == 'GET' and not (event.get('pathParameters') or {}).get('id'):
            return _handlers.get('get-keywords.py')(event, context)
        return _handlers.get('manage-keywords.py')(event, context)

    logger.error(f"No route matched for resource={resource}, path={path}")
    return not_found_response(resource='Route', event=event)
