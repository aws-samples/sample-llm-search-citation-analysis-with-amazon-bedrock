"""
Caller verification and per-tool authorization for the MCP server.

API Gateway's Cognito authorizer has already checked the token's signature,
expiry and scopes before the Lambda runs. This module adds the resource
server's own checks (RFC 8707 / MCP authorization): the token was issued by
our user pool to the MCP app client, is an access token, and — when it names
an audience — names this server. Every failure is an HTTP 401 carrying the
``WWW-Authenticate`` challenge that points clients at the protected resource
metadata, never a JSON-RPC result.

Tool authorization reuses the dashboard's rule: scopes gate read/write, the
``Admin`` Cognito group gates admin tools (``shared.auth.get_caller_groups``).

Scopes are ``<MCP_RESOURCE_URL>/read``, ``/write`` and ``/run``: the Cognito
resource server is identified by the MCP endpoint URL (see
``lib/constructs/mcp-server.ts``), because Cognito accepts an RFC 8707
``resource`` parameter only for scopes of a resource server with that very
identifier, and MCP clients send the endpoint as the resource.
"""

from __future__ import annotations

import json
import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from shared.auth import ADMIN_GROUP, GROUPS_CLAIM, get_caller_groups

METADATA_PATH = '/.well-known/oauth-protected-resource'
SCOPE_NAMES = ('read', 'write', 'run')
RESOURCE_NAME = 'Citation Analysis MCP'


def scope_for(name: str) -> str:
    """The access-token scope for ``name`` (``read``/``write``/``run``): the MCP endpoint URL, a slash, the name."""
    return f'{os.environ["MCP_RESOURCE_URL"]}/{name}'


class AuthError(Exception):
    """A claim check failed; ``str(error)`` is safe to show the client."""


@dataclass(frozen=True)
class Caller:
    """The verified caller a tool call runs on behalf of."""

    sub: str
    username: str
    scopes: frozenset[str]
    groups: frozenset[str]
    raw_groups: Any
    """The ``cognito:groups`` claim as the token carried it (string or list), replayed downstream."""


def canonical_resource(url: str) -> str:
    """``url`` with a lower-case scheme and host, no query string, no fragment and no trailing slash."""
    parts = urlsplit(url.strip())
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path.rstrip('/'), '', ''))


def _audience_matches(audience: Any, resource_url: str) -> bool:
    expected = canonical_resource(resource_url)
    candidates = audience if isinstance(audience, (list, tuple)) else [audience]
    return any(isinstance(item, str) and canonical_resource(item) == expected for item in candidates)


def verify_claims(claims: Mapping[str, Any]) -> Caller:
    """The ``Caller`` behind ``claims``, or ``AuthError`` when they do not fit this server."""
    if not claims:
        raise AuthError('No authorizer claims on the request')
    if claims.get('iss') != os.environ['MCP_ISSUER']:
        raise AuthError('Token issuer is not this user pool')
    if claims.get('client_id') != os.environ['MCP_CLIENT_ID']:
        raise AuthError('Token was not issued to the MCP client')
    if claims.get('token_use') != 'access':
        raise AuthError('An access token is required')
    audience = claims.get('aud')
    if audience is not None and not _audience_matches(audience, os.environ['MCP_RESOURCE_URL']):
        raise AuthError('Token audience is not this server')
    sub = claims.get('sub')
    if not isinstance(sub, str) or not sub:
        raise AuthError('Token has no subject')
    username = claims.get('username') or claims.get('cognito:username') or sub
    scopes = frozenset(str(claims.get('scope') or '').split())
    groups = get_caller_groups({'requestContext': {'authorizer': {'claims': dict(claims)}}})
    return Caller(sub=sub, username=str(username), scopes=scopes, groups=groups, raw_groups=claims.get(GROUPS_CLAIM))


def unauthorized_response(error: AuthError) -> dict[str, Any]:
    """The 401 that sends an MCP client into the OAuth flow (RFC 9728 ``resource_metadata``)."""
    metadata_url = os.environ['MCP_RESOURCE_METADATA_URL']
    return {
        'statusCode': 401,
        'headers': {
            'Content-Type': 'application/json',
            'WWW-Authenticate': f'Bearer resource_metadata="{metadata_url}", error="invalid_token"',
        },
        'body': json.dumps({'error': 'invalid_token', 'error_description': str(error)}),
    }


def protected_resource_metadata() -> dict[str, Any]:
    """The RFC 9728 document served at ``METADATA_PATH``."""
    return {
        'resource': os.environ['MCP_RESOURCE_URL'],
        'authorization_servers': [os.environ['MCP_ISSUER']],
        'scopes_supported': ['openid', *(scope_for(name) for name in SCOPE_NAMES)],
        'bearer_methods_supported': ['header'],
        'resource_name': RESOURCE_NAME,
    }


def authorize_tool(caller: Caller, scope: str, admin: bool) -> str | None:
    """Why ``caller`` may not run a tool needing ``scope`` (``read``/``write``) and ``admin``, or ``None`` when allowed."""
    required = scope_for(scope)
    if required not in caller.scopes:
        return f'This tool needs the {required} scope'
    if admin and ADMIN_GROUP not in caller.groups:
        return 'This tool is for administrators'
    return None
