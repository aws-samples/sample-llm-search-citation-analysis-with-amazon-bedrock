"""DataForSEO's response status ladder: turning an HTTP answer and its envelope into data or a typed error.

DataForSEO answers most failures with HTTP 200 and a failed top-level or task ``status_code``, so a response is
checked in three steps: the HTTP status, the envelope's top-level status, then the first task's status. Every
failure becomes a ``DataForSeoError`` whose ``code`` the API and Settings map to a user-facing state.

- The balance/billing classifier applies to every API section, so a depleted balance is always
  ``BILLING_ISSUE``, never a generic ``INTERNAL_ERROR``.
- An unbilled "Invalid Field" failure is ``VALIDATION_ERROR`` even without a ``cost`` field, so a bad request
  is recognised without billing metadata.
- In-body (HTTP 200) top-level or task status 40100 / 40104 and HTTP 403 are ``AUTH_FAILED``.
- A billed failure keeps its cost (``DataForSeoError.cost_usd``).
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from shared.log_safety import log_text

logger = logging.getLogger(__name__)

MAX_ERROR_PAYLOAD_LENGTH = 1600

OK_STATUS = 20000
TASK_CREATED_STATUS = 20100
"""What a ``task_post`` entry returns on success."""

UPSTREAM_FAILURE_STATUS_CODES = frozenset({
    40101,  # Internal SE Server Error.
    40103,  # Task execution failed, please try to resubmit.
    50000,  # Internal Error.
    50301,  # 3rd Party API Service Unavailable.
    50302,  # Internal 3rd Party API Service Unavailable.
    50303,  # Update in progress. Please try after a few minutes.
    50304,  # This function temporarily unavailable.
    50401,  # Internal Error - Timeout.
    50402,  # Target page took too long to respond.
})
"""DataForSEO's own backend failed: an explicit list, not a range (50100 "Not Implemented" is our bug)."""

AUTH_STATUS_CODES = frozenset({40100, 40104})
"""In-body codes of a rejected login (40100 "You are not authorized", 40104 "Please verify your account")."""
AUTH_HTTP_STATUSES = frozenset({401, 403})

BILLING_STATUS_CODES = frozenset({40200, 40210, 402})
BILLING_SIGNALS = (
    'insufficient funds',
    'balance is too low',
    'payment required',
    'problem billing',
    'recharged',
)
"""Specific phrases only: a message that merely mentions "balance" or "billing" is not a balance failure."""
BILLING_MESSAGE = 'The connected DataForSEO account has a billing or balance issue'

_INVALID_FIELD = re.compile(r"Invalid Field:\s*'([^']+)'", re.IGNORECASE)
_NO_RESULTS = 'no search results'


class DataForSeoError(Exception):
    """A DataForSEO call that did not produce usable data.

    ``code`` is one of ``NOT_CONFIGURED``, ``AUTH_FAILED``, ``RATE_LIMITED``, ``UPSTREAM_UNAVAILABLE``,
    ``BILLING_ISSUE``, ``VALIDATION_ERROR``, ``INTERNAL_ERROR``. ``cost_usd`` is set when DataForSEO billed the
    failed task; ``provider_status`` is the HTTP, top-level or task status code that failed.
    """

    def __init__(self, code: str, message: str, *, cost_usd: float | None = None,
                 provider_status: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.cost_usd = cost_usd
        self.provider_status = provider_status


def _is_billing_failure(status: object, text: str) -> bool:
    lowered = text.lower()
    return status in BILLING_STATUS_CODES or any(signal in lowered for signal in BILLING_SIGNALS)


def http_error(status: int, text: str, path: str) -> DataForSeoError:
    """The error for a final non-2xx HTTP response (after any retries)."""
    logger.warning('%s', json.dumps({
        'event': 'dataforseo.http-failed', 'path': log_text(path), 'status_code': status,
        'response_body': log_text(text, MAX_ERROR_PAYLOAD_LENGTH),
    }))
    if _is_billing_failure(status, text):
        return DataForSeoError('BILLING_ISSUE', BILLING_MESSAGE, provider_status=status)
    if status >= 500:
        code = 'UPSTREAM_UNAVAILABLE'
    elif status == 429:
        code = 'RATE_LIMITED'
    elif status in AUTH_HTTP_STATUSES:
        code = 'AUTH_FAILED'
    else:
        code = 'INTERNAL_ERROR'
    return DataForSeoError(code, f'DataForSEO HTTP {status} on {path}', provider_status=status)


def parse_envelope(text: str) -> dict[str, Any]:
    """The JSON object of a 2xx answer; an empty, non-JSON or non-object body is ``INTERNAL_ERROR``."""
    if text == '':
        raise DataForSeoError('INTERNAL_ERROR', 'DataForSEO returned an empty response')
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise DataForSeoError('INTERNAL_ERROR', 'DataForSEO returned a response that is not JSON') from exc
    if not isinstance(parsed, dict):
        raise DataForSeoError('INTERNAL_ERROR', 'DataForSEO returned a response that is not an object')
    return parsed


def task_cost(task: dict[str, Any]) -> float | None:
    """The task's billed ``cost`` in USD, or ``None`` when it carries none."""
    cost = task.get('cost')
    if isinstance(cost, bool) or not isinstance(cost, int | float):
        return None
    return float(cost)


def _status_int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _describe_invalid_field(message: str, task: dict[str, Any]) -> str:
    """``message`` with the value we sent for the field an "Invalid Field: 'x'" rejection names."""
    match = _INVALID_FIELD.search(message)
    data = task.get('data')
    if match is None or not isinstance(data, dict) or match.group(1) not in data:
        return message
    name = match.group(1)
    return f'{message} (sent {name}={json.dumps(data[name], ensure_ascii=False)})'


def top_level_error(response: dict[str, Any]) -> DataForSeoError:
    """The error for an envelope whose top-level ``status_code`` is not ``OK_STATUS``."""
    status = _status_int(response.get('status_code'))
    message = str(response.get('status_message') or 'DataForSEO request failed')
    if _is_billing_failure(status, message):
        return DataForSeoError('BILLING_ISSUE', BILLING_MESSAGE, provider_status=status)
    if status in AUTH_STATUS_CODES:
        code = 'AUTH_FAILED'
    elif status in UPSTREAM_FAILURE_STATUS_CODES:
        code = 'UPSTREAM_UNAVAILABLE'
    else:
        code = 'INTERNAL_ERROR'
    return DataForSeoError(code, message, provider_status=status)


def checked_envelope(response: dict[str, Any]) -> dict[str, Any]:
    """``response`` when its top-level status is ``OK_STATUS``, else its ``DataForSeoError``."""
    if response.get('status_code') != OK_STATUS:
        raise top_level_error(response)
    return response


def first_task(response: dict[str, Any]) -> dict[str, Any]:
    """``tasks[0]`` of an envelope with a successful top-level status."""
    tasks = checked_envelope(response).get('tasks')
    task = tasks[0] if isinstance(tasks, list) and tasks else None
    if not isinstance(task, dict):
        raise DataForSeoError('INTERNAL_ERROR', 'DataForSEO response missing task')
    return task


def _task_error(task: dict[str, Any], message: str, path: str) -> DataForSeoError:
    """The error for a failed task; a billed failure keeps its cost (balance failures are never billed)."""
    status = _status_int(task.get('status_code'))
    cost = task_cost(task)
    if _is_billing_failure(status, message):
        return DataForSeoError('BILLING_ISSUE', BILLING_MESSAGE, provider_status=status)
    detailed = _describe_invalid_field(message, task)
    if status in AUTH_STATUS_CODES:
        code = 'AUTH_FAILED'
    elif status in UPSTREAM_FAILURE_STATUS_CODES:
        logger.warning('%s', json.dumps({
            'event': 'dataforseo.upstream-task-failed', 'path': log_text(path), 'status': status,
            'message': log_text(message),
        }))
        code = 'UPSTREAM_UNAVAILABLE'
    elif _INVALID_FIELD.search(message) and not (cost and cost > 0):
        code = 'VALIDATION_ERROR'
    else:
        code = 'INTERNAL_ERROR'
    return DataForSeoError(code, detailed, cost_usd=cost, provider_status=status)


def task_no_results(task: dict[str, Any], path: str, *, ok_task_status: int,
                    treat_no_results_as_empty: bool) -> bool:
    """Whether a task with ``ok_task_status`` is empty ("No Search Results", when allowed); a failure raises."""
    if task.get('status_code') == ok_task_status:
        return False
    message = str(task.get('status_message') or 'DataForSEO task failed')
    if treat_no_results_as_empty and _NO_RESULTS in message.lower():
        return True
    raise _task_error(task, message, path)
