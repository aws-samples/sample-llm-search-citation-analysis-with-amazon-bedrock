"""
Execution Management Consolidated API Lambda

Routes:
- POST /api/trigger-analysis -> trigger-analysis handler
- POST /api/trigger-keyword-analysis -> trigger-keyword-analysis handler
- GET /api/executions/{id} -> get-execution-status handler
"""

import logging
import sys

# Shared layer path (populated by the Lambda layer at /opt/python)
sys.path.insert(0, '/opt/python')

from shared.router import HandlerLoader, dispatch_route

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

ROUTE_MAP = {
    '/api/trigger-keyword-analysis': 'trigger-keyword-analysis.py',
    '/api/trigger-analysis': 'trigger-analysis.py',
    '/api/executions': 'get-execution-status.py',
}

_handlers = HandlerLoader(__file__)


def handler(event, context):
    return dispatch_route(event, context, ROUTE_MAP, _handlers, logger)
