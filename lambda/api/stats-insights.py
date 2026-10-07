"""
Stats & Insights Consolidated API Lambda

Routes requests to the appropriate handler based on API Gateway resource path.
Consolidates 6 separate Lambdas into one to reduce CloudFormation resource count:
- GET /api/stats -> get-stats handler
- GET /api/visibility/sentiment-examples -> get-sentiment-examples handler
- GET /api/visibility -> get-visibility-metrics handler
- GET /api/prompt-insights -> get-prompt-insights handler
- GET /api/citation-gaps -> get-citation-gaps handler
- GET /api/recommendations -> get-recommendations handler
- GET /api/trends -> get-historical-trends handler
- GET /api/reports/group-kpis -> get-group-kpi-history handler
- GET /api/reports/insights -> get-reports-insights handler
- POST /api/reports/insights/regenerate -> regenerate-report-insights handler (Admin)
"""

import sys

# Shared layer path (populated by the Lambda layer at /opt/python)
sys.path.insert(0, '/opt/python')

from shared.consolidated_router import route_map_handler

# Map resource paths to handler module filenames
ROUTE_MAP = {
    '/api/stats': 'get-stats.py',
    # Before its parent: the matcher takes the first prefix that matches.
    '/api/visibility/sentiment-examples': 'get-sentiment-examples.py',
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
    '/api/reports/group-kpis': 'get-group-kpi-history.py',
    # Before its parent: the matcher takes the first prefix that matches.
    '/api/reports/insights/regenerate': 'regenerate-report-insights.py',
    # No sibling prefix reaches it: /api/reports itself is not a route.
    '/api/reports/insights': 'get-reports-insights.py',
}

handler = route_map_handler(__file__, ROUTE_MAP, __name__)
