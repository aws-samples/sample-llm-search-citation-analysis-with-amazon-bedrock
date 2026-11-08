"""
DataForSEO callbacks Lambda (``CitationAnalysis-SeoCallbacks``): the public pingback endpoint.

DataForSEO calls ``<function URL>?gate=<gate id>&id=<task id>`` when a queued task posted with that
``pingback_url`` is ready (``shared.dataforseo_callbacks``). The function counts the task on its gate; the task
that empties the gate sends the waiting state machine's task token, which resumes it to collect the results.

The URL is public (DataForSEO cannot sign in), so the function holds nothing worth taking: it can only count on
``callback#`` gate items of ``CitationAnalysis-SeoCache`` and send task success to the two state machines that
wait on gates. It has no DataForSEO credentials and calls nothing paid. The 32-byte random gate id is the only
way to reach a gate. Every well-formed request gets the same answer, whether its gate exists or not, so the
endpoint tells a caller nothing; a malformed one gets 400.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

# Shared layer path (populated by the Lambda layer at /opt/python)
sys.path.insert(0, '/opt/python')

from shared.dataforseo_callbacks import arrive, is_gate_id, is_task_id, release

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

_METHODS = frozenset({'GET', 'POST'})


def _answer(status: int) -> dict[str, Any]:
    return {'statusCode': status, 'headers': {'Content-Type': 'text/plain'}, 'body': 'ok' if status == 200 else ''}


def _method(event: dict[str, Any]) -> str:
    http = (event.get('requestContext') or {}).get('http') or {}
    return str(http.get('method') or '')


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    if _method(event) not in _METHODS:
        return _answer(405)
    params = event.get('queryStringParameters') or {}
    gate_id, task_id = params.get('gate'), params.get('id')
    if not is_gate_id(gate_id) or not is_task_id(task_id):
        return _answer(400)
    arrival = arrive(gate_id, task_id)
    if arrival is None:
        return _answer(200)
    if arrival.remaining <= 0 and arrival.task_token:
        released = release(arrival.task_token, arrival.output)
        logger.info('callback gate emptied; state machine resumed=%s', released)
    return _answer(200)
