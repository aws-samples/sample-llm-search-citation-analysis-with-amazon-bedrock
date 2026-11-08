"""DataForSEO HTTP transport: authentication, deadline, retries and one log line per call.

The one transport every DataForSEO call goes through: Basic auth from Secrets Manager, one shared deadline,
5xx retries for idempotent calls only, and the status ladder of ``shared.dataforseo_envelope`` that turns
DataForSEO's envelope (HTTP 200 with a failed top-level or task ``status_code``) into a typed
``DataForSeoError``. ``task['cost']`` is read before anything else can fail, so a charged failure keeps its cost
(``DataForSeoError.cost_usd``).

Design choices:
- The credential is stored as ``login:password`` (JSON ``api_key``) and base64-encoded here, when the
  request is built; the secret never holds the encoded form.
- Network errors other than timeouts become ``UPSTREAM_UNAVAILABLE`` rather than escaping as raw exceptions;
  neither is retried, since the request may already have been billed.
- Settings' login probe (``response_error``) and the API classify an answer with the same ladder, so a
  rejected login reads the same in both.
- ``call_deadline`` (a context variable the API handler sets from the Lambda's remaining time) caps every call's
  timeout; a call with less than ``MIN_CALL_BUDGET_S`` left is refused before it is sent, so the API still
  answers within API Gateway's 29 s limit instead of timing out after a billed call.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import time
from collections.abc import Callable, Generator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any

import requests

from shared.dataforseo_envelope import (
    AUTH_STATUS_CODES,
    BILLING_MESSAGE,
    BILLING_SIGNALS,
    BILLING_STATUS_CODES,
    OK_STATUS,
    TASK_CREATED_STATUS,
    UPSTREAM_FAILURE_STATUS_CODES,
    DataForSeoError,
    checked_envelope,
    first_task,
    http_error,
    parse_envelope,
    task_cost,
    task_no_results,
)
from shared.log_safety import log_text
from shared.secrets import get_api_key

logger = logging.getLogger(__name__)

CREDENTIAL_KEY_NAME = 'dataforseo-key'
"""Bare Secrets Manager name (``citation-analysis/dataforseo-key``), JSON ``{"api_key": "<login>:<password>"}``."""
DEFAULT_BASE_URL = 'https://api.dataforseo.com'
MAX_SERVER_ERROR_RETRIES = 2
"""Total attempts = retries + 1, all inside the one deadline."""
RETRY_BACKOFF_S = 0.25
"""Linear backoff: 250 ms x (attempt + 1)."""

MIN_CALL_BUDGET_S = 1.0
"""A call started with less deadline left than this is refused unsent (it could not finish, but could bill)."""

_deadline: ContextVar[float | None] = ContextVar('dataforseo_deadline', default=None)
"""Monotonic time by which every DataForSEO call of the current request must have finished."""


@dataclass(frozen=True)
class TaskResult:
    """The first task of a DataForSEO response."""

    task: dict[str, Any]
    result: list[Any]
    cost_usd: float
    no_results: bool
    """DataForSEO answered "No Search Results": an empty, billed success."""


@dataclass(frozen=True)
class EnvelopeReading[T]:
    """What a ``send_envelope`` reader made of a checked envelope, and what the call's log line reports."""

    value: T
    cost_usd: float | None = None
    task_status_code: object = None
    """Logged only when it is an integer."""


def _requests_send(method: str, url: str, headers: dict[str, str], body: bytes | None,
                   timeout_s: float) -> tuple[int, str]:
    """One HTTP exchange; timeouts raise ``TimeoutError``, other transport failures ``ConnectionError``."""
    try:
        response = requests.request(method, url, headers=headers, data=body, timeout=timeout_s)
    except requests.Timeout as exc:
        raise TimeoutError(type(exc).__name__) from exc
    except requests.RequestException as exc:
        raise ConnectionError(type(exc).__name__) from exc
    return response.status_code, response.text


_send: Callable[[str, str, dict[str, str], bytes | None, float], tuple[int, str]] = _requests_send
"""The transport; tests replace this one attribute."""


def _sleep(seconds: float) -> None:
    time.sleep(seconds)


def _monotonic() -> float:
    return time.monotonic()


@contextmanager
def call_deadline(seconds_from_now: float) -> Generator[None]:
    """Cap every DataForSEO call inside the block to finish ``seconds_from_now`` from now.

    A nested deadline never extends an outer one. Thread-pool workers see it only when run in a copy of the
    caller's context (``contextvars.copy_context().run``).
    """
    deadline = _monotonic() + seconds_from_now
    outer = _deadline.get()
    token = _deadline.set(deadline if outer is None else min(outer, deadline))
    try:
        yield
    finally:
        _deadline.reset(token)


def remaining_deadline_s() -> float | None:
    """Seconds left before the current ``call_deadline``, or ``None`` outside one."""
    deadline = _deadline.get()
    return None if deadline is None else deadline - _monotonic()


def _bounded_timeout(timeout_s: float, path: str) -> float:
    """``timeout_s`` capped to the deadline; raises unsent when less than ``MIN_CALL_BUDGET_S`` remains."""
    remaining = remaining_deadline_s()
    if remaining is None:
        return timeout_s
    if remaining < MIN_CALL_BUDGET_S:
        raise DataForSeoError('UPSTREAM_UNAVAILABLE', f'No time left for the DataForSEO call on {path}')
    return min(timeout_s, remaining)


@dataclass
class _CallRecord:
    """What the one structured log line of a call reports."""

    method: str
    path: str
    started: float
    status_code: int | None = None
    task_status_code: object = None
    cost_usd: float | None = None
    attempts: int = 0
    error_code: str | None = None


def _log_call(record: _CallRecord) -> None:
    line = json.dumps({
        'event': 'dataforseo.call',
        'method': record.method,
        'path': log_text(record.path),
        'status_code': record.status_code,
        'task_status_code': record.task_status_code if isinstance(record.task_status_code, int) else None,
        'cost_usd': record.cost_usd,
        'latency_ms': round((_monotonic() - record.started) * 1000),
        'attempts': record.attempts,
        'error_code': record.error_code,
    })
    if record.error_code is None:
        logger.info('%s', line)
    else:
        logger.warning('%s', line)


#: Runs before each billed call (a POST: DataForSEO bills POSTs, its GETs are free) and raises
#: ``DataForSeoError`` to refuse it; set by the SEO router's daily limit (``shared.seo_spend_limit``).
_billed_call_guard: ContextVar[Callable[[str], None] | None] = ContextVar('dataforseo_billed_call_guard', default=None)


@contextmanager
def guarding_billed_calls(guard: Callable[[str], None]) -> Generator[None]:
    """Every billed call made inside first passes ``guard(path)``, which raises to refuse it (nothing is sent)."""
    token = _billed_call_guard.set(guard)
    try:
        yield
    finally:
        _billed_call_guard.reset(token)


def _check_billed(method: str, path: str) -> None:
    guard = _billed_call_guard.get()
    if guard is not None and method == 'POST':
        guard(path)


@contextmanager
def _logged_call(method: str, path: str) -> Generator[_CallRecord]:
    """The one structured log line of a call, with the error code of a failure."""
    record = _CallRecord(method, path, _monotonic())
    try:
        _check_billed(method, path)
        yield record
    except DataForSeoError as error:
        record.error_code = error.code
        raise
    finally:
        _log_call(record)


def configured_credentials() -> str | None:
    """The stored ``login:password``, or ``None`` when the secret is missing, empty or malformed."""
    value = get_api_key(CREDENTIAL_KEY_NAME)
    if not value:
        return None
    login, separator, password = value.strip().partition(':')
    if not separator or not login or not password:
        return None
    return f'{login}:{password}'


def escape_keyword(text: str) -> str:
    """``text`` with literal ``%`` and ``+`` escaped: DataForSEO decodes %-escapes in posted keywords."""
    return text.replace('%', '%25').replace('+', '%2B')


def _base_url() -> str:
    return (os.environ.get('DATAFORSEO_BASE_URL') or DEFAULT_BASE_URL).rstrip('/')


def _headers(has_body: bool) -> dict[str, str]:
    credentials = configured_credentials()
    if credentials is None:
        raise DataForSeoError('NOT_CONFIGURED', 'DataForSEO is not configured: set the login in Settings > AI Providers')
    headers = {
        'Authorization': f"Basic {base64.b64encode(credentials.encode('utf-8')).decode('ascii')}",
        'Accept': 'application/json',
    }
    if has_body:
        headers['Content-Type'] = 'application/json'
    return headers


def _exchange(method: str, url: str, headers: dict[str, str], body: bytes | None, timeout_s: float,
              path: str) -> tuple[int, str]:
    """One attempt; a timeout or transport failure is final (the call may already be billed)."""
    try:
        return _send(method, url, headers, body, timeout_s)
    except TimeoutError as exc:
        raise DataForSeoError('UPSTREAM_UNAVAILABLE', f'DataForSEO request timed out on {path}') from exc
    except OSError as exc:
        raise DataForSeoError('UPSTREAM_UNAVAILABLE', f'DataForSEO request failed on {path}: {type(exc).__name__}') from exc


def _request(method: str, path: str, body: bytes | None, *, idempotent: bool, timeout_s: float,
             record: _CallRecord) -> str:
    """The response text of a 2xx answer; an idempotent call retries 5xx inside the shared deadline."""
    retries = MAX_SERVER_ERROR_RETRIES if idempotent else 0
    timeout_s = _bounded_timeout(timeout_s, path)
    headers = _headers(body is not None)
    url = f'{_base_url()}{path}'
    deadline = record.started + timeout_s
    attempt = 0
    while True:
        remaining = deadline - _monotonic()
        if remaining <= 0:
            raise DataForSeoError('UPSTREAM_UNAVAILABLE', f'DataForSEO request timed out on {path}')
        status, text = _exchange(method, url, headers, body, remaining, path)
        record.attempts += 1
        record.status_code = status
        if 200 <= status < 300:
            return text
        backoff = RETRY_BACKOFF_S * (attempt + 1)
        if status >= 500 and attempt < retries and deadline - _monotonic() > backoff:
            _sleep(backoff)
            attempt += 1
            continue
        raise http_error(status, text, path)


def _call(method: str, path: str, body: bytes | None, *, idempotent: bool, timeout_s: float,
          treat_no_results_as_empty: bool) -> tuple[dict[str, Any], bool, _CallRecord]:
    ok_task_status = TASK_CREATED_STATUS if path.rstrip('/').endswith('/task_post') else OK_STATUS
    with _logged_call(method, path) as record:
        text = _request(method, path, body, idempotent=idempotent, timeout_s=timeout_s, record=record)
        task = first_task(parse_envelope(text))
        record.task_status_code = task.get('status_code')
        record.cost_usd = task_cost(task)
        no_results = task_no_results(task, path, ok_task_status=ok_task_status,
                                     treat_no_results_as_empty=treat_no_results_as_empty)
    return task, no_results, record


def post_live(path: str, task: dict[str, Any], *, idempotent: bool = True, timeout_s: float = 25.0,
              treat_no_results_as_empty: bool = False) -> TaskResult:
    """POST one task (as the one-element array DataForSEO expects) and return its checked first task.

    ``idempotent=False`` disables the 5xx retries: for a billed call a 5xx does not prove DataForSEO skipped
    the charge. ``treat_no_results_as_empty`` turns "No Search Results" into ``no_results=True``.
    """
    body = json.dumps([task]).encode('utf-8')
    first, no_results, record = _call('POST', path, body, idempotent=idempotent, timeout_s=timeout_s,
                                      treat_no_results_as_empty=treat_no_results_as_empty)
    result = first.get('result')
    return TaskResult(
        task=first,
        result=result if isinstance(result, list) else [],
        cost_usd=record.cost_usd or 0.0,
        no_results=no_results,
    )


def get_free(path: str, *, timeout_s: float = 25.0) -> dict[str, Any]:
    """GET a free endpoint (``/v3/appendix/user_data``, locations) and return its checked first task."""
    task, _no_results, _record = _call('GET', path, None, idempotent=True, timeout_s=timeout_s,
                                       treat_no_results_as_empty=False)
    return task


def send_envelope[T](method: str, path: str, body: bytes | None, *, idempotent: bool, timeout_s: float,
                     read: Callable[[dict[str, Any]], EnvelopeReading[T]]) -> T:
    """Send one request inside the shared deadline and return ``read`` of its envelope.

    For calls whose answer holds several tasks (``task_post``) or whose task status is the caller's to judge
    (``task_get``). The envelope's top-level status is checked first; ``read`` runs inside the call, so a
    ``DataForSeoError`` it raises is logged on the call's one line, with the cost and task status it returns.
    ``idempotent=False`` disables the 5xx retries, as for ``post_live``.
    """
    with _logged_call(method, path) as record:
        text = _request(method, path, body, idempotent=idempotent, timeout_s=timeout_s, record=record)
        reading = read(checked_envelope(parse_envelope(text)))
        record.cost_usd = reading.cost_usd
        record.task_status_code = reading.task_status_code
    return reading.value


def response_error(http_status: int, payload: object, path: str) -> DataForSeoError | None:
    """The ``DataForSeoError`` the status ladder raises for an answer already received, else ``None``.

    For callers that send their own request (Settings' login probe of ``/v3/appendix/user_data``), so they
    classify the answer exactly as ``post_live`` / ``get_free`` do. ``payload`` is the parsed JSON body
    (``None`` when it was not JSON).
    """
    if not 200 <= http_status < 300:
        return http_error(http_status, '' if payload is None else json.dumps(payload), path)
    if not isinstance(payload, dict):
        return DataForSeoError('INTERNAL_ERROR', 'DataForSEO returned a response that is not an object')
    try:
        task_no_results(first_task(payload), path, ok_task_status=OK_STATUS, treat_no_results_as_empty=False)
    except DataForSeoError as error:
        return error
    return None


def account_summary() -> dict[str, Any]:
    """``{'login': str, 'balance_usd': float | None}`` from the free ``GET /v3/appendix/user_data``."""
    task = get_free('/v3/appendix/user_data')
    result = task.get('result')
    first = result[0] if isinstance(result, list) and result and isinstance(result[0], dict) else {}
    money = first.get('money')
    balance = money.get('balance') if isinstance(money, dict) else None
    login = first.get('login')
    return {
        'login': login if isinstance(login, str) else '',
        'balance_usd': float(balance) if isinstance(balance, int | float) and not isinstance(balance, bool) else None,
    }


__all__ = [
    'AUTH_STATUS_CODES',
    'BILLING_MESSAGE',
    'BILLING_SIGNALS',
    'BILLING_STATUS_CODES',
    'DEFAULT_BASE_URL',
    'MAX_SERVER_ERROR_RETRIES',
    'OK_STATUS',
    'TASK_CREATED_STATUS',
    'UPSTREAM_FAILURE_STATUS_CODES',
    'DataForSeoError',
    'EnvelopeReading',
    'TaskResult',
    'account_summary',
    'call_deadline',
    'configured_credentials',
    'escape_keyword',
    'get_free',
    'post_live',
    'remaining_deadline_s',
    'response_error',
    'send_envelope',
]
