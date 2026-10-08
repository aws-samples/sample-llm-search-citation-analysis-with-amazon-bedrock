"""
Config Management Consolidated API Lambda

Routes:
- GET/POST/PUT/DELETE/PATCH /api/query-prompts/* -> manage-query-prompts handler
- GET/POST/DELETE /api/schedules/* -> manage-schedule handler
- GET/PUT/POST /api/providers/bedrock/* -> manage-bedrock-models handler
- GET/PUT/POST /api/providers/* -> manage-providers handler
- GET/PUT/POST /api/alerts/* -> manage-alerts handler
- GET/POST/PUT/DELETE /api/custom-reports/* -> manage-custom-reports handler
"""

import sys

# Shared layer path (populated by the Lambda layer at /opt/python)
sys.path.insert(0, '/opt/python')

from shared.consolidated_router import route_map_handler

ROUTE_MAP = {
    '/api/query-prompts': 'manage-query-prompts.py',
    '/api/schedules': 'manage-schedule.py',
    # Settings > Bedrock models: `/api/providers/{id}` with id `bedrock`. Before
    # its parent so the concrete path wins; `/api/providers/bedrockx` does not match.
    '/api/providers/bedrock': 'manage-bedrock-models.py',
    '/api/providers': 'manage-providers.py',
    '/api/alerts': 'manage-alerts.py',
    '/api/custom-reports': 'manage-custom-reports.py',
}

handler = route_map_handler(__file__, ROUTE_MAP, __name__)
