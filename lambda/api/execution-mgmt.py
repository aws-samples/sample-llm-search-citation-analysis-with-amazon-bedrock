"""
Execution Management Consolidated API Lambda

Routes:
- POST /api/trigger-analysis -> trigger-analysis handler
- POST /api/trigger-keyword-analysis -> trigger-keyword-analysis handler
- GET /api/executions/{id} -> get-execution-status handler
"""

import sys

# Shared layer path (populated by the Lambda layer at /opt/python)
sys.path.insert(0, '/opt/python')

from shared.consolidated_router import route_map_handler

ROUTE_MAP = {
    '/api/trigger-keyword-analysis': 'trigger-keyword-analysis.py',
    '/api/trigger-analysis': 'trigger-analysis.py',
    '/api/executions': 'get-execution-status.py',
}

handler = route_map_handler(__file__, ROUTE_MAP, __name__)
