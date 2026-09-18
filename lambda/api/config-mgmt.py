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

from shared.router import HandlerLoader, dispatch_route

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

ROUTE_MAP = {
    '/api/query-prompts': 'manage-query-prompts.py',
    '/api/schedules': 'manage-schedule.py',
    '/api/providers': 'manage-providers.py',
}

_handlers = HandlerLoader(__file__)


def handler(event, context):
    return dispatch_route(event, context, ROUTE_MAP, _handlers, logger)
