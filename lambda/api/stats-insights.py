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

from shared.router import HandlerLoader, dispatch_route

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Map resource paths to handler module filenames
ROUTE_MAP = {
    '/api/stats': 'get-stats.py',
    '/api/visibility': 'get-visibility-metrics.py',
    '/api/prompt-insights': 'get-prompt-insights.py',
    '/api/citation-gaps': 'get-citation-gaps.py',
    # More specific (recommendations/{id}/status) must be checked before
    # the generic /recommendations route since the matcher uses prefix.
    '/api/recommendations/{id}/status': 'recommendation-status.py',
    '/api/recommendations': 'get-recommendations.py',
    '/api/trends': 'get-historical-trends.py',
    '/api/reports/overview': 'get-reports-overview.py',
    '/api/reports/competitor': 'get-reports-competitor.py',
}

_handlers = HandlerLoader(__file__)


def handler(event, context):
    """
    Router handler that dispatches to the correct sub-handler
    based on the API Gateway resource path.
    """
    return dispatch_route(event, context, ROUTE_MAP, _handlers, logger)
