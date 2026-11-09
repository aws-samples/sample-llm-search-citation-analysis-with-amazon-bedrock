"""
Health Check Endpoint

Simple health check for monitoring and load balancer integration.
Returns 200 OK with system status plus the project's CORS headers so
browser-based monitors (dashboards, uptime pings from the React app)
don't get blocked.
"""

from shared.api_response import api_response
from shared.utils import get_timestamp


def handler(event, context):
    """
    Health check handler.

    Routes through `api_response` so the response carries the same
    SSM-driven CORS headers as every other endpoint. Adds a hard
    no-cache header so monitors don't serve stale 200s.

    Returns:
        200 OK with timestamp and status.
    """
    return api_response(
        200,
        {
            'status': 'healthy',
            'timestamp': get_timestamp(),
            'service': 'citation-analysis-api',
        },
        event=event,
        headers={'Cache-Control': 'no-cache, no-store, must-revalidate'},
    )
