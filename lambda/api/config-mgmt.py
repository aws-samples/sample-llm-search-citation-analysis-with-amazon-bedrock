"""
Config Management Consolidated API Lambda

Routes:
- GET/POST/PUT/DELETE/PATCH /api/query-prompts/* -> manage-query-prompts handler
- GET/POST/DELETE /api/schedules/* -> manage-schedule handler
- GET/PUT/POST /api/providers/* -> manage-providers handler
- GET/PUT/POST /api/alerts/* -> manage-alerts handler
"""

import sys

# Shared layer path (populated by the Lambda layer at /opt/python)
sys.path.insert(0, '/opt/python')

from shared.consolidated_router import route_map_handler

ROUTE_MAP = {
    '/api/query-prompts': 'manage-query-prompts.py',
    '/api/schedules': 'manage-schedule.py',
    '/api/providers': 'manage-providers.py',
    '/api/alerts': 'manage-alerts.py',
}

handler = route_map_handler(__file__, ROUTE_MAP, __name__)
