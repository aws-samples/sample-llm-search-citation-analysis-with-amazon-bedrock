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

Every call emits exactly one structured audit line
``{caller_sub, tool, operation, outcome, ms}``; tokens and bodies are never logged.
"""

from __future__ import annotations

import json
import logging
import math
import os
from time import perf_counter
from typing import Any

import boto3
from auth import Caller, authorize_tool
from botocore.exceptions import BotoCoreError, ClientError
from catalogue import InvalidArguments, JsonObject, Route, Tool, validate_arguments

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

#: A JSON result longer than this is cut down to its first page.
MAX_RESULT_CHARS = 50_000
#: Room left for the ``truncated`` marker and JSON punctuation when only a text preview fits.
_PREVIEW_MARGIN = 100
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
    """``(statusCode, decoded body)`` the router Lambda answered ``route`` with."""
    response = lambda_client().invoke(
        FunctionName=function_name(route.router),
        Payload=json.dumps(api_event(route, caller)).encode('utf-8'),
    )
    payload = json.loads(response['Payload'].read())
    if response.get('FunctionError') or not isinstance(payload, dict):
        logger.error('Router %s failed: %s', route.router, response.get('FunctionError') or 'malformed response')
        return 502, {'error': 'The API handler failed'}
    return int(payload.get('statusCode') or 500), _decode_body(payload.get('body'))


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
    """``data`` cut to its first page when it exceeds ``MAX_RESULT_CHARS``: the longest lists lose their tail."""
    if _size(data) <= MAX_RESULT_CHARS:
        return data
    trimmed = dict(data)
    lists = [key for key, value in trimmed.items() if isinstance(value, list) and value]
    for key in sorted(lists, key=lambda name: _size(trimmed[name]), reverse=True):
        while trimmed[key] and _size(trimmed) > MAX_RESULT_CHARS:
            trimmed[key] = _without_tail(trimmed[key], _size(trimmed) - MAX_RESULT_CHARS)
    if _size(trimmed) > MAX_RESULT_CHARS:
        preview: JsonObject = {'preview': json.dumps(trimmed, default=str)[:MAX_RESULT_CHARS - _PREVIEW_MARGIN]}
        trimmed = preview
    trimmed['truncated'] = True
    return trimmed


def summarize(operation: str, data: JsonObject) -> str:
    """One line for the text block: list sizes when there are lists, else the field count."""
    counts = [f'{len(value)} {key}' for key, value in data.items() if isinstance(value, list)]
    detail = ', '.join(counts) if counts else f'{len(data)} field(s)'
    suffix = ' (truncated)' if data.get('truncated') is True else ''
    return f'{operation}: {detail}{suffix}'


def success_result(tool: Tool, body: Any) -> JsonObject:
    shaped = tool.shape(body) if tool.shape is not None else body
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


# --- The call -------------------------------------------------------------------

def _audit(caller: Caller, tool_name: str, operation: str, outcome: str, started: float) -> None:
    logger.info(json.dumps({
        'caller_sub': caller.sub,
        'tool': tool_name,
        'operation': operation,
        'outcome': outcome,
        'ms': round((perf_counter() - started) * 1000),
    }))


def run_operation(tool_name: str, operation: Tool, arguments: Any, caller: Caller) -> JsonObject:
    """Authorize, validate, replay and shape one call of ``operation`` made through ``tool_name``.

    ``tool_name`` is the MCP tool the client called (``call_tool`` for the
    catalogue, the operation itself for direct tools); the audit line names both.
    ``InvalidArguments`` propagates so the protocol layer can answer ``-32602``.
    """
    started = perf_counter()
    refusal = authorize_tool(caller, operation.scope, operation.admin)
    if refusal is not None:
        _audit(caller, tool_name, operation.name, 'denied', started)
        return tool_result(refusal, {'error': refusal}, is_error=True)
    try:
        route = operation.route(validate_arguments(operation.input_schema, arguments))
    except InvalidArguments:
        _audit(caller, tool_name, operation.name, 'invalid_arguments', started)
        raise
    try:
        status, body = invoke_route(route, caller)
    except (BotoCoreError, ClientError, ValueError):
        logger.exception('Invoking %s for %s failed', route.router, operation.name)
        _audit(caller, tool_name, operation.name, 'invoke_failed', started)
        return tool_result(f'{operation.name} could not reach the API', {'error': 'upstream_unavailable'}, is_error=True)
    _audit(caller, tool_name, operation.name, f'http_{status}', started)
    if 200 <= status < 300:
        return success_result(operation, body)
    return error_result(operation.name, status, body)
