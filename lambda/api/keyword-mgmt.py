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

from shared.api_response import not_found_response, validation_error
from shared.router import HandlerLoader, path_matches_route

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

_handlers = HandlerLoader(__file__)
_PROMOTION_ROUTE = '/api/keywords/promote'


def _matches_exact_route(resource, path):
    """Require every populated API Gateway path field to name promotion exactly."""
    candidates = [candidate for candidate in (resource, path) if candidate]
    return bool(candidates) and all(candidate == _PROMOTION_ROUTE for candidate in candidates)


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

    # Promotion is more specific than /api/keywords and must be checked first.
    if path_matches_route(_PROMOTION_ROUTE, resource, path):
        if not _matches_exact_route(resource, path):
            return not_found_response(resource='Route', event=event)
        if method == 'POST':
            return _handlers.get('promote-keywords.py')(event, context)
        return validation_error(f'Method {method} not allowed', event, 'httpMethod')

    # /api/keywords routes: GET list goes to get-keywords, mutations go to manage-keywords
    if path_matches_route('/api/keywords', resource, path):
        if method == 'GET' and not (event.get('pathParameters') or {}).get('id'):
            return _handlers.get('get-keywords.py')(event, context)
        return _handlers.get('manage-keywords.py')(event, context)

    logger.error(f"No route matched for resource={resource}, path={path}")
    return not_found_response(resource='Route', event=event)
