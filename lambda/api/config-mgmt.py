"""
Config Management Consolidated API Lambda

Routes:
- GET/POST/PUT/DELETE/PATCH /api/query-prompts/* -> manage-query-prompts handler
- GET/POST/DELETE /api/schedules/* -> manage-schedule handler
- GET/PUT/POST /api/providers/* -> manage-providers handler
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
    '/api/query-prompts': 'manage-query-prompts.py',
    '/api/schedules': 'manage-schedule.py',
    '/api/providers': 'manage-providers.py',
}

_handlers = HandlerLoader(__file__)


def handler(event, context):
    resource = event.get('resource', '')
    path = event.get('path', '')

    logger.info(f"Routing: resource={resource}, path={path}")

    for route_path, filename in ROUTE_MAP.items():
        if resource.startswith(route_path) or path.startswith(route_path):
            return _handlers.get(filename)(event, context)

    logger.error(f"No route matched for resource={resource}, path={path}")
    return not_found_response(resource='Route', event=event)
