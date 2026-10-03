"""Callers, events and responses for tests of the Admin-gated API handlers.

The admin handlers (`manage-users`, `manage-schedule`, `manage-query-prompts`,
`manage-alerts`, ...) all read the caller from the Cognito authorizer claims,
so their tests share one claim shape: an identity plus an optional
``cognito:groups`` claim. ``groups=None`` builds the authenticated-but-ungrouped
caller an invited read-only user actually is.
"""

from __future__ import annotations

from collections.abc import Mapping
from types import ModuleType
from typing import Any

from testing.events import api_gateway_event, parse_response_lenient

ADMIN_EMAIL = 'admin@example.com'
CALLER_SUB = '11111111-2222-3333-4444-555555555555'


def caller_claims(groups: str | None = 'Admin', email: str = ADMIN_EMAIL) -> dict[str, str]:
    """Authorizer claims for ``email``; ``groups`` becomes ``cognito:groups`` unless ``None``."""
    claims = {'sub': CALLER_SUB, 'cognito:username': email, 'email': email}
    if groups is not None:
        claims['cognito:groups'] = groups
    return claims


def caller_event(
    method: str,
    path: str,
    *,
    groups: str | None = 'Admin',
    caller: str = ADMIN_EMAIL,
    **request: Any,
) -> dict[str, Any]:
    """An API Gateway event from ``caller`` in ``groups`` (an Admin by default).

    ``request`` takes the other keywords of ``api_gateway_event`` (``body``,
    ``path_params``, ``query``, ``resource``, ...).
    """
    return api_gateway_event(method, path, claims=caller_claims(groups, caller), **request)


def invoke(handler_module: ModuleType, event: Mapping[str, Any]) -> tuple[int, Any]:
    """``(status, body)`` the module's ``handler`` answers ``event`` with."""
    return parse_response_lenient(handler_module.handler(event, {}))


def status_of(handler_module: ModuleType, event: Mapping[str, Any]) -> int:
    """The status code the module's ``handler`` answers ``event`` with."""
    return invoke(handler_module, event)[0]
