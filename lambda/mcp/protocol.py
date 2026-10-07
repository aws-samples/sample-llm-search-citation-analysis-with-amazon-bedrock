"""
JSON-RPC 2.0 over one HTTP POST: the MCP Streamable HTTP transport with JSON responses only.

The server is stateless and never opens an SSE stream: every POST body (one
message or a batch) is answered in the same HTTP response. Requests get a
JSON-RPC result or error; a body holding only notifications gets ``202`` with
an empty body. Methods: ``initialize``, ``ping``, ``tools/list``,
``tools/call``; ``notifications/initialized`` (and any other notification) is
accepted silently.

HTTP status codes follow the transport, JSON-RPC codes the protocol: a body
that is not JSON (``-32700``) or not a request (``-32600``) is a ``400``; an
unknown method (``-32601``), bad params (``-32602``) or a failure (``-32603``)
travel in a ``200`` as the request's error response.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any

from auth import Caller
from catalogue import InvalidArguments, JsonObject, tool_listing
from tools import call_tool

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

#: Oldest first; an unsupported client request is answered with the newest.
SUPPORTED_VERSIONS = ('2025-06-18', '2025-11-25', '2026-07-28')
SERVER_INFO = {'name': 'citation-analysis-mcp', 'version': '0.1.0'}
JSON_HEADERS = {'Content-Type': 'application/json'}

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603


class RpcError(Exception):
    """A JSON-RPC error the request is answered with."""

    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class RequestContext:
    """What one POST carries besides its messages: who calls, and whether ``tools/list`` is the full catalogue."""

    caller: Caller
    list_full: bool = False


def negotiate_version(requested: Any) -> str:
    """The client's version when supported, else the newest the server speaks."""
    return requested if requested in SUPPORTED_VERSIONS else SUPPORTED_VERSIONS[-1]


def http_response(status: int, body: Any) -> JsonObject:
    """A Lambda proxy response; ``None`` is an empty body."""
    return {
        'statusCode': status,
        'headers': dict(JSON_HEADERS),
        'body': '' if body is None else json.dumps(body, default=str),
    }


def _error(request_id: Any, code: int, message: str) -> JsonObject:
    return {'jsonrpc': '2.0', 'id': request_id, 'error': {'code': code, 'message': message}}


def _initialize(params: JsonObject) -> JsonObject:
    return {
        'protocolVersion': negotiate_version(params.get('protocolVersion')),
        'capabilities': {'tools': {}},
        'serverInfo': dict(SERVER_INFO),
    }


def _tools_call(params: JsonObject, context: RequestContext) -> JsonObject:
    name = params.get('name')
    arguments = params.get('arguments')
    if arguments is None:
        arguments = {}
    if not isinstance(name, str) or not isinstance(arguments, dict):
        raise RpcError(INVALID_PARAMS, 'tools/call needs a tool name and an arguments object')
    return call_tool(name, arguments, context.caller)


def dispatch(method: str, params: Any, context: RequestContext) -> JsonObject:
    """The result of one request; ``RpcError`` / ``InvalidArguments`` for the errors it may answer with."""
    if params is None:
        params = {}
    if not isinstance(params, dict):
        raise RpcError(INVALID_PARAMS, 'params must be an object')
    if method == 'initialize':
        return _initialize(params)
    if method == 'ping':
        return {}
    if method == 'tools/list':
        return {'tools': tool_listing(context.list_full)}
    if method == 'tools/call':
        return _tools_call(params, context)
    raise RpcError(METHOD_NOT_FOUND, f'Method not found: {method}')


def _is_message(message: Any) -> bool:
    return isinstance(message, dict) and message.get('jsonrpc') == '2.0' and isinstance(message.get('method'), str)


def handle_message(message: Any, context: RequestContext) -> JsonObject | None:
    """The response to one JSON-RPC message, or ``None`` for a notification."""
    if not _is_message(message):
        request_id = message.get('id') if isinstance(message, dict) else None
        return _error(request_id, INVALID_REQUEST, 'Invalid Request')
    if 'id' not in message:
        return None
    request_id = message['id']
    try:
        result = dispatch(message['method'], message.get('params'), context)
    except RpcError as error:
        return _error(request_id, error.code, str(error))
    except InvalidArguments as error:
        return _error(request_id, INVALID_PARAMS, str(error))
    except Exception:
        logger.exception('%s failed', message['method'])
        return _error(request_id, INTERNAL_ERROR, 'Internal error')
    return {'jsonrpc': '2.0', 'id': request_id, 'result': result}


def _status_of(response: JsonObject) -> int:
    return 400 if response.get('error', {}).get('code') == INVALID_REQUEST else 200


def _respond_batch(messages: list[Any], context: RequestContext) -> JsonObject:
    if not messages:
        return http_response(400, _error(None, INVALID_REQUEST, 'Invalid Request'))
    responses = [response for response in (handle_message(message, context) for message in messages) if response]
    return http_response(200, responses) if responses else http_response(202, None)


def respond(raw_body: Any, context: RequestContext) -> JsonObject:
    """The HTTP response to one POST body: a response, a batch of responses, or ``202`` for notifications only."""
    try:
        payload = json.loads(raw_body if isinstance(raw_body, str) else '')
    except json.JSONDecodeError:
        return http_response(400, _error(None, PARSE_ERROR, 'Parse error'))
    if isinstance(payload, list):
        return _respond_batch(payload, context)
    response = handle_message(payload, context)
    if response is None:
        return http_response(202, None)
    return http_response(_status_of(response), response)
