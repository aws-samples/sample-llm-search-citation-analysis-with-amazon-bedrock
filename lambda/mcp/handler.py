"""
MCP server Lambda: the API Gateway proxy entry point.

One function serves these routes, told apart by method and path suffix:

- ``GET  /.well-known/oauth-protected-resource/mcp`` (RFC 9728 path-inserted,
  the location the 401 advertises) and ``GET  /.well-known/oauth-protected-resource``
  (no authorizer) → the protected resource metadata that names the server's
  base URL as the authorization server.
- ``GET  /.well-known/openid-configuration`` and
  ``GET  /.well-known/oauth-authorization-server`` (no authorizer) → the
  authorization server metadata describing Cognito's managed login.
- ``GET  /mcp`` → ``405 Allow: POST`` (no SSE stream; the server is stateless).
- ``POST /mcp`` (Cognito authorizer) → verify the token's claims, read the
  caller's groups from the user pool (``directory``), then answer the JSON-RPC
  body through ``protocol.respond``.

Every failure before a request is accepted is an HTTP status (``401`` with the
``WWW-Authenticate`` challenge, ``405``, ``400`` for an unsupported
``MCP-Protocol-Version``); JSON-RPC errors are only ever sent for a request
that passed authentication.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

# Shared layer path (populated by the Lambda layer at /opt/python)
sys.path.insert(0, '/opt/python')

import directory
from auth import AuthError, DiscoveryDocument, discovery_document, unauthorized_response, verify_claims
from protocol import SUPPORTED_VERSIONS, RequestContext, http_response, respond

from shared.auth import get_caller_claims

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

PROTOCOL_VERSION_HEADER = 'mcp-protocol-version'


def _header(event: dict[str, Any], name: str) -> str | None:
    """The value of header ``name`` (lower-case), whatever casing the client used."""
    headers = event.get('headers') or {}
    for key, value in headers.items():
        if str(key).lower() == name:
            return str(value)
    return None


def _method_not_allowed(allow: str) -> dict[str, Any]:
    response = http_response(405, {'error': 'method_not_allowed', 'allow': allow})
    response['headers']['Allow'] = allow
    return response


#: Discovery documents change only with a deploy; a few minutes spares clients a refetch per connection.
DISCOVERY_CACHE_CONTROL = 'public, max-age=300'


def _discovery(method: str, document: DiscoveryDocument) -> dict[str, Any]:
    """A public metadata document on GET, ``405 Allow: GET`` otherwise."""
    if method != 'GET':
        return _method_not_allowed('GET')
    response = http_response(200, document())
    response['headers']['Cache-Control'] = DISCOVERY_CACHE_CONTROL
    return response


def _unsupported_version(version: str) -> dict[str, Any]:
    body = {'error': 'unsupported_protocol_version', 'requested': version, 'supported': list(SUPPORTED_VERSIONS)}
    return http_response(400, body)


def handler(event: dict[str, Any], context: object) -> dict[str, Any]:
    """Serve the metadata routes, refuse non-POST methods, or verify the caller and answer the JSON-RPC body."""
    method = str(event.get('httpMethod') or 'GET').upper()
    path = str(event.get('path') or '')
    document = discovery_document(path)
    if document is not None:
        return _discovery(method, document)
    if method != 'POST':
        return _method_not_allowed('POST')
    try:
        # Groups come from the user pool: access tokens carry them only when the client asked for `openid`.
        caller = directory.with_directory_groups(verify_claims(get_caller_claims(event)))
    except AuthError as error:
        logger.warning('Rejected MCP request: %s', error)
        return unauthorized_response(error)
    version = _header(event, PROTOCOL_VERSION_HEADER)
    if version is not None and version not in SUPPORTED_VERSIONS:
        return _unsupported_version(version)
    query = event.get('queryStringParameters') or {}
    return respond(event.get('body'), RequestContext(caller=caller, list_full=query.get('tools') == 'full'))
