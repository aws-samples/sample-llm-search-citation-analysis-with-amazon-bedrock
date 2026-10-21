"""
Running one tool call: authorize, validate, replay against an API handler Lambda, shape the result.

The API handlers behind the dashboard are invoked directly (``lambda:Invoke``)
with the API Gateway proxy event they would have received from the dashboard,
carrying the verified caller's identity in ``requestContext.authorizer.claims``.
Their ``statusCode``/``body`` answer becomes an MCP tool result: the parsed
JSON as ``structuredContent`` and, in the text block, a one-line summary
followed by the same JSON, or ``isError`` with the handler's ``error``,
``details`` and ``field`` on a non-2xx. The JSON is repeated in the text
block because several hosts (Kiro among them) show the model only the text
block; the MCP spec asks servers that return ``structuredContent`` to do so.

A router answer over 5 MB arrives as a spill pointer (``shared.response_spill``);
``invoke_route`` reads the body from its presigned S3 URL (capped at
``MAX_SPILL_BYTES``) before shaping, and any failure there is the generic 502.

Every call emits exactly one structured audit line
``{caller_sub, tool, operation, outcome, ms}`` (plus ``reason`` when the call
was refused); tokens and bodies are never logged. Calls of write and spend
operations are also recorded in the state table (``state.record_audit``).
"""

from __future__ import annotations

import json
import logging
import math
import os
from time import perf_counter
from typing import Any
from urllib.parse import urlparse

import boto3
import requests
import state
from auth import Caller, authorize_tool
from botocore.exceptions import BotoCoreError, ClientError
from catalogue import InvalidArguments, JsonObject, NotFound, Route, Tool, validate_arguments

from shared.response_spill import spilled_location

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

#: A JSON result longer than this is cut down to its first page.
MAX_RESULT_CHARS = 50_000
#: Room left for the ``truncated`` marker and JSON punctuation when only a text preview fits.
_PREVIEW_MARGIN = 100
_CURSOR_KEY = 'next_token'
#: What a cut page of a paginated answer tells the model (its ``next_token`` skips the items cut).
CUT_PAGE_NOTE = 'Items of this page were cut to fit; ask again with a smaller limit before following next_token.'
_ERROR_FIELDS = ('error', 'details', 'field')

_lambda_client: Any = None


def lambda_client() -> Any:
    """The Lambda client, created on first use so importing this module needs no AWS region."""
    global _lambda_client
    if _lambda_client is None:
        _lambda_client = boto3.client('lambda')
    return _lambda_client


def function_name(router: str) -> str:
    """The deployed function behind ``router`` (``MCP_API_FUNCTIONS``)."""
    functions: dict[str, str] = json.loads(os.environ['MCP_API_FUNCTIONS'])
    return functions[router]


def api_event(route: Route, caller: Caller) -> JsonObject:
    """The API Gateway proxy event a router Lambda expects for ``route``, on behalf of ``caller``."""
    claims: JsonObject = {'sub': caller.sub, 'cognito:username': caller.username}
    if caller.raw_groups is not None:
        claims['cognito:groups'] = caller.raw_groups
    return {
        'httpMethod': route.method,
        'path': route.path,
        'resource': route.resource,
        'pathParameters': route.path_params,
        'queryStringParameters': route.query,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps(route.body) if route.body is not None else None,
        'requestContext': {'authorizer': {'claims': claims}},
    }


def _decode_body(raw: Any) -> Any:
    if not isinstance(raw, str) or not raw:
        return {}
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {'error': raw}


def invoke_route(route: Route, caller: Caller) -> tuple[int, Any]:
    """``(statusCode, decoded body)`` the router Lambda answered ``route`` with.

    A spill pointer (``shared.response_spill``: the router moved a body over
    5 MB to S3) is followed, so the caller sees the original body.
    """
    response = lambda_client().invoke(
        FunctionName=function_name(route.router),
        Payload=json.dumps(api_event(route, caller)).encode('utf-8'),
    )
    payload = json.loads(response['Payload'].read())
    if response.get('FunctionError') or not isinstance(payload, dict):
        logger.error('Router %s failed: %s', route.router, response.get('FunctionError') or 'malformed response')
        return _handler_failed()
    status, body = int(payload.get('statusCode') or 500), _decode_body(payload.get('body'))
    location = spilled_location(body)
    if location is None:
        return status, body
    spilled, reason = _follow_spill(location)
    if reason is not None:
        logger.error('Router %s spilled response could not be read: %s', route.router, reason)
        return _handler_failed()
    return status, spilled


def _handler_failed() -> tuple[int, Any]:
    return 502, {'error': 'The API handler failed'}


def _follow_spill(url: str) -> tuple[Any, str | None]:
    """``(body, None)`` read from a spill pointer's URL, or ``(None, reason)``.

    The reason of a ``requests`` failure is its class name only: its message
    holds the presigned URL, whose signature must not reach the logs.
    """
    try:
        return fetch_spilled_body(url), None
    except SpillDownloadError as refused:
        return None, str(refused)
    except requests.RequestException as failure:
        return None, type(failure).__name__
    except ValueError as malformed:
        return None, f'malformed body ({type(malformed).__name__})'


# --- Spilled responses ------------------------------------------------------------

#: Largest spilled body the server reads (a spill is over 5 MB, and a router's whole answer stays under 6 MiB).
MAX_SPILL_BYTES = 32 * 1024 * 1024
#: Seconds to connect to and read from S3.
SPILL_TIMEOUT_SECONDS = 20
#: Presigned S3 URLs are on this domain; any other host is refused.
SPILL_HOST_SUFFIX = '.amazonaws.com'
_SPILL_CHUNK_BYTES = 64 * 1024


class SpillDownloadError(Exception):
    """A spilled body the server will not read: a foreign host, an error status or too many bytes."""


def _spill_host(url: str) -> str:
    """The URL's host when it is an https URL on ``SPILL_HOST_SUFFIX``; raises ``SpillDownloadError`` otherwise."""
    parsed = urlparse(url)
    host = parsed.hostname or ''
    if parsed.scheme != 'https' or not host.endswith(SPILL_HOST_SUFFIX):
        raise SpillDownloadError(f'refused host {host or "(none)"}')
    return host


def spill_session() -> requests.Session:
    """A session that sends nothing but the URL: no ``.netrc`` credentials, no proxy or other environment settings."""
    session = requests.Session()
    session.trust_env = False
    return session


def _read_capped(response: requests.Response) -> bytes:
    """The response body, refused above ``MAX_SPILL_BYTES`` by its Content-Length and by the bytes read."""
    declared = response.headers.get('Content-Length')
    if declared is not None and int(declared) > MAX_SPILL_BYTES:
        raise SpillDownloadError(f'declared {declared} bytes')
    chunks: list[bytes] = []
    received = 0
    for chunk in response.iter_content(chunk_size=_SPILL_CHUNK_BYTES):
        received += len(chunk)
        if received > MAX_SPILL_BYTES:
            raise SpillDownloadError(f'more than {MAX_SPILL_BYTES} bytes')
        chunks.append(chunk)
    return b''.join(chunks)


def fetch_spilled_body(url: str) -> Any:
    """The decoded JSON body a spill pointer's presigned ``url`` holds.

    The URL carries its own (presigned) authorization, so the request sends no
    headers of the caller and follows no redirect. The URL is never logged.
    """
    host = _spill_host(url)
    with spill_session() as session, session.get(
        url, timeout=SPILL_TIMEOUT_SECONDS, stream=True, allow_redirects=False,
    ) as response:
        if response.status_code != 200:
            raise SpillDownloadError(f'{host} answered {response.status_code}')
        raw = _read_capped(response)
    return json.loads(raw)


# --- Result shaping -------------------------------------------------------------

def tool_result(text: str, structured: JsonObject, *, is_error: bool = False) -> JsonObject:
    """
    An MCP ``tools/call`` result: ``structuredContent`` plus one text block
    holding ``text`` and, on a new line, the same JSON, for hosts that read
    only the text block.
    """
    body = f'{text}\n{json.dumps(structured, default=str)}'
    result: JsonObject = {'content': [{'type': 'text', 'text': body}], 'structuredContent': structured}
    if is_error:
        result['isError'] = True
    return result


def _size(value: Any) -> int:
    return len(json.dumps(value, default=str))


def _without_tail(items: list[Any], overflow: int) -> list[Any]:
    """``items`` minus enough trailing entries (at least one) to shed ``overflow`` characters."""
    per_item = _size(items) / len(items)
    return items[:max(0, len(items) - math.ceil(overflow / per_item) - 1)]


def truncate_result(data: JsonObject) -> JsonObject:
    """``data`` cut to its first page when it exceeds ``MAX_RESULT_CHARS``: the longest lists lose their tail.

    A paginated answer keeps its ``next_token``, but the cursor continues after
    the whole page the API returned, so a cut page says to ask again with a
    smaller ``limit`` rather than skip the items it lost.
    """
    if _size(data) <= MAX_RESULT_CHARS:
        return data
    markers: JsonObject = {'truncated': True}
    if data.get(_CURSOR_KEY) is not None:
        markers = {_CURSOR_KEY: data[_CURSOR_KEY], 'truncated_note': CUT_PAGE_NOTE, **markers}
    trimmed = {**data, **markers}
    lists = [key for key, value in trimmed.items() if isinstance(value, list) and value]
    for key in sorted(lists, key=lambda name: _size(trimmed[name]), reverse=True):
        while trimmed[key] and _size(trimmed) > MAX_RESULT_CHARS:
            trimmed[key] = _without_tail(trimmed[key], _size(trimmed) - MAX_RESULT_CHARS)
    if _size(trimmed) > MAX_RESULT_CHARS:
        room = MAX_RESULT_CHARS - _PREVIEW_MARGIN - _size(markers)
        trimmed = {'preview': json.dumps(trimmed, default=str)[:room], **markers}
    return trimmed


def summarize(operation: str, data: JsonObject) -> str:
    """One line for the text block: list sizes when there are lists, else the field count."""
    counts = [f'{len(value)} {key}' for key, value in data.items() if isinstance(value, list)]
    detail = ', '.join(counts) if counts else f'{len(data)} field(s)'
    suffix = ' (truncated)' if data.get('truncated') is True else ''
    return f'{operation}: {detail}{suffix}'


def success_result(tool: Tool, body: Any, arguments: JsonObject | None = None) -> JsonObject:
    """The handler's 2xx answer, shaped or selected from, truncated, as a tool result."""
    shaped = tool.shape(body) if tool.shape is not None else body
    if tool.select is not None:
        shaped = tool.select(shaped, arguments or {})
    data = truncate_result(shaped if isinstance(shaped, dict) else {'items': shaped})
    return tool_result(summarize(tool.name, data), data)


def error_result(operation: str, status: int, body: Any) -> JsonObject:
    """The handler's refusal as a tool error carrying its ``error``, ``details`` and ``field``."""
    source = body if isinstance(body, dict) else {'error': str(body)}
    details = {key: source[key] for key in _ERROR_FIELDS if key in source}
    text = f'{operation} failed ({status}): {details.get("error") or "request failed"}'
    if 'details' in details:
        text = f'{text} - {details["details"]}'
    return tool_result(text, {'status': status, **details}, is_error=True)


def refusal_result(message: str) -> JsonObject:
    """A tool error the server itself raised (scope, admin, limit, token), before or instead of any API call."""
    return tool_result(message, {'error': message}, is_error=True)


# --- The call -------------------------------------------------------------------

def audit(
    caller: Caller, tool_name: str, operation: Tool, outcome: str, started: float, reason: str | None = None,
) -> None:
    """The structured log line of one call; write and spend calls also get an audit record."""
    line: JsonObject = {
        'caller_sub': caller.sub,
        'tool': tool_name,
        'operation': operation.name,
        'outcome': outcome,
        'ms': round((perf_counter() - started) * 1000),
    }
    if reason:
        line['reason'] = reason
    logger.info(json.dumps(line))
    if operation.scope != 'read':
        state.record_audit(caller.sub, tool_name, operation.name, outcome, reason)


def checked_route(tool_name: str, operation: Tool, arguments: Any, caller: Caller, started: float) -> tuple[JsonObject, Route]:
    """``(validated arguments, route)``; audits and re-raises ``InvalidArguments``."""
    try:
        valid = validate_arguments(operation.input_schema, arguments)
        return valid, operation.route(valid)
    except InvalidArguments:
        audit(caller, tool_name, operation, 'invalid_arguments', started)
        raise


def replay(tool_name: str, operation: Tool, route: Route, caller: Caller, started: float) -> tuple[int, Any] | None:
    """``invoke_route`` with the failure audited; ``None`` when the API could not be reached."""
    try:
        return invoke_route(route, caller)
    except (BotoCoreError, ClientError, ValueError):
        logger.exception('Invoking %s for %s failed', route.router, operation.name)
        audit(caller, tool_name, operation, 'invoke_failed', started)
        return None


def unreachable_result(operation: Tool) -> JsonObject:
    return tool_result(f'{operation.name} could not reach the API', {'error': 'upstream_unavailable'}, is_error=True)


def answer_result(operation: Tool, status: int, body: Any, arguments: JsonObject) -> JsonObject:
    """The tool result of the handler's answer: shaped data on a 2xx, its refusal otherwise."""
    if not 200 <= status < 300:
        return error_result(operation.name, status, body)
    try:
        return success_result(operation, body, arguments)
    except NotFound as missing:
        return error_result(operation.name, 404, {'error': str(missing)})


def run_operation(tool_name: str, operation: Tool, arguments: Any, caller: Caller) -> JsonObject:
    """Authorize, validate, replay and shape one call of ``operation`` made through ``tool_name``.

    ``tool_name`` is the MCP tool the client called (``call_tool`` for the
    catalogue, the operation itself for direct tools); the audit line names both.
    ``InvalidArguments`` propagates so the protocol layer can answer ``-32602``.
    """
    started = perf_counter()
    refusal = authorize_tool(caller, operation.scope, operation.admin)
    if refusal is not None:
        audit(caller, tool_name, operation, 'denied', started, refusal)
        return refusal_result(refusal)
    valid, route = checked_route(tool_name, operation, arguments, caller, started)
    answer = replay(tool_name, operation, route, caller, started)
    if answer is None:
        return unreachable_result(operation)
    status, body = answer
    audit(caller, tool_name, operation, f'http_{status}', started)
    return answer_result(operation, status, body, valid)
