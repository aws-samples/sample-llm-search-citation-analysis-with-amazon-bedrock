"""
Authorization tier for API Lambda handlers.

API Gateway's Cognito authorizer answers *who* the caller is. Until this
module existed, nothing answered *what they may do* — every signed-in user had
the full administrative capability set, including promoting themselves to
``Admin`` and rewriting provider API keys (AUDIT-2026-08-19 §0).

The primitives here read the Cognito claims that the authorizer attaches to
``event['requestContext']['authorizer']['claims']`` and are **fail closed** at
every step: a missing ``requestContext``, a missing ``authorizer``, missing
``claims``, an absent ``cognito:groups`` claim, and an empty or unparseable
claim all deny. That matters because a direct ``lambda:InvokeFunction`` (the
Step Functions role can reach every ``CitationAnalysis-*`` function) produces an
event with no ``requestContext`` at all — which must not be mistaken for an
unrestricted caller.

Membership is an exact set intersection, never a substring test. ``Admins`` and
``NotAdmin`` do not satisfy ``Admin``; the substring-matching bug class is
tracked separately in AUDIT-2026-08-19 §2.15.

This lives outside ``shared/decorators.py`` on purpose: that module is already
473 lines and is a grab bag of unrelated request plumbing, whereas
authorization is one cohesive concern that deserves its own test file.
Handlers import it directly::

    from shared.auth import ADMIN_GROUP, require_group

    @api_handler
    @cors_preflight
    @require_group(ADMIN_GROUP)
    @parse_json_body
    def handle_update_provider(event, context, body=None):
        ...

Ordering rules for the decorator stack:

- **Below** ``@cors_preflight``, so browser preflight (an ``OPTIONS`` request,
  which carries no ``Authorization`` header) still answers 200. Above it, every
  gated route would fail CORS instead of returning a usable 403.
- **Above** ``@parse_json_body`` / ``@validate`` / ``@paginate``, so an
  unauthorized request is refused before any attacker-controlled input is
  parsed.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Callable
from functools import wraps
from typing import Any

from shared.api_response import forbidden_response

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Cognito group names. These are the literal `groupName` values created by
# `lib/constructs/auth.ts` — keep the two in lockstep. Renaming a group there
# without changing it here silently removes every authorization check, because
# an unmatched group name simply means "caller is not in the required group".
# The CDK synth test in `lib/citation-analysis-stack.spec.ts` pins the names on
# the infrastructure side.
# ---------------------------------------------------------------------------
ADMIN_GROUP = 'Admin'
USERS_GROUP = 'Users'

# The claim API Gateway populates from the ID token's group membership.
GROUPS_CLAIM = 'cognito:groups'

# Claims that can carry the caller's own identity, in priority order.
# `cognito:username` is the authoritative one for a user pool; `email` and
# `sub` are included because this pool signs in with an email alias and the
# username *is* the lowercased email (see `handle_invite_user`), so callers
# legitimately address themselves either way.
_IDENTITY_CLAIMS = ('cognito:username', 'username', 'email', 'sub')

# Splits the flattened group claim. API Gateway's REST authorizer serializes
# the JWT's string array as `Admin,Users`, and some payload shapes arrive
# bracketed and space-separated as `[Admin Users]`. Cognito group names cannot
# contain whitespace (the allowed pattern excludes the Unicode separator
# category), so splitting on whitespace can never fragment a legitimate name.
_GROUP_SEPARATORS = re.compile(r'[,\s]+')


def get_caller_claims(event: dict[str, Any]) -> dict[str, Any]:
    """
    Return the Cognito claims attached by the API Gateway authorizer.

    Returns an empty dict for every shape that is not a populated claims
    mapping — including a direct Lambda invoke with no ``requestContext``.
    Callers must treat an empty dict as "unauthenticated", never as "no
    restrictions".

    Args:
        event: The raw Lambda event.

    Returns:
        The claims mapping, or ``{}`` when unavailable.
    """
    if not isinstance(event, dict):
        return {}

    request_context = event.get('requestContext')
    if not isinstance(request_context, dict):
        return {}

    authorizer = request_context.get('authorizer')
    if not isinstance(authorizer, dict):
        return {}

    claims = authorizer.get('claims')
    if not isinstance(claims, dict):
        return {}

    return claims


def get_caller_groups(event: dict[str, Any]) -> frozenset[str]:
    """
    Return the Cognito groups the caller belongs to.

    Handles both wire shapes of the ``cognito:groups`` claim: the
    comma-separated string API Gateway's REST authorizer produces, and the
    genuine list that appears when a JWT is decoded directly.

    Returns an empty set whenever membership cannot be established. An empty
    set never satisfies :func:`require_group`, which is what makes the absent
    claim deny rather than allow.

    Args:
        event: The raw Lambda event.

    Returns:
        Frozenset of group names, empty when none could be parsed.
    """
    raw = get_caller_claims(event).get(GROUPS_CLAIM)

    if isinstance(raw, str):
        candidate = raw.strip()
        # Unwrap the `[Admin Users]` shape before splitting so the brackets
        # don't end up glued to the first and last group name.
        if candidate.startswith('[') and candidate.endswith(']'):
            candidate = candidate[1:-1]
        parts: list[Any] = _GROUP_SEPARATORS.split(candidate)
    elif isinstance(raw, (list, tuple, set, frozenset)):
        parts = list(raw)
    else:
        # None, a number, a nested dict — nothing we can trust. Deny.
        return frozenset()

    return frozenset(
        part.strip() for part in parts
        if isinstance(part, str) and part.strip()
    )


def get_caller_identity(event: dict[str, Any]) -> str | None:
    """
    Return the caller's own username, or ``None`` when it cannot be determined.

    Args:
        event: The raw Lambda event.

    Returns:
        The first non-empty identity claim, or ``None``.
    """
    claims = get_caller_claims(event)

    for claim in _IDENTITY_CLAIMS:
        value = claims.get(claim)
        if isinstance(value, str) and value.strip():
            return value.strip()

    return None


def is_self_reference(event: dict[str, Any], target_username: str | None) -> bool:
    """
    Return True iff ``target_username`` may be the caller's own account.

    Used to block self-modification of privilege-bearing fields. An admin
    editing their own ``groups`` could not be distinguished from the escalation
    attack this tier exists to stop, and an admin disabling or deleting
    themselves can lock the last administrator out of the deployment
    irreversibly.

    Fail closed twice over:

    - An unknown caller identity returns True. We cannot prove the request
      *isn't* self-directed, so the sensitive operation is refused. In practice
      :func:`require_group` has already denied such a request.
    - Comparison is case-insensitive across every identity claim, because the
      pool's usernames are lowercased emails and a caller can address
      themselves as ``Alice@Example.com``.

    Args:
        event: The raw Lambda event.
        target_username: The account the request is acting on.

    Returns:
        True when the operation should be treated as self-directed.
    """
    if not target_username or not target_username.strip():
        return False

    claims = get_caller_claims(event)
    if not claims:
        return True

    identities = {
        value.strip().casefold()
        for claim in _IDENTITY_CLAIMS
        if isinstance(value := claims.get(claim), str) and value.strip()
    }
    if not identities:
        return True

    return target_username.strip().casefold() in identities


def require_group(*allowed_groups: str) -> Callable:
    """
    Decorator that refuses the request unless the caller is in one of ``allowed_groups``.

    Returns a 403 (not a 401) on refusal: the caller is authenticated, just not
    privileged, so retrying with the same token is pointless and the frontend
    must not read it as session expiry.

    Args:
        *allowed_groups: Group names, any one of which grants access. At least
            one is required — a zero-group call would be a no-op gate, so it
            raises at import time rather than silently allowing everyone.

    Returns:
        The decorator.

    Raises:
        ValueError: If called with no groups.

    Usage:
        @api_handler
        @cors_preflight
        @require_group(ADMIN_GROUP)
        @route_handler({...})
        def handler(event, context):
            pass
    """
    if not allowed_groups:
        raise ValueError(
            "require_group() needs at least one group name; an empty gate "
            "would authorize every caller."
        )

    allowed = frozenset(allowed_groups)

    def decorator(func: Callable) -> Callable:
        @wraps(func)
        def wrapper(event: dict[str, Any], context: Any, *args, **kwargs) -> dict[str, Any]:
            caller_groups = get_caller_groups(event)

            if not (caller_groups & allowed):
                # Log enough to investigate, nothing sensitive: group names are
                # not secrets and the token never appears here.
                logger.warning(
                    "Authorization denied for %s: caller %r is not in %s (has %s)",
                    func.__name__,
                    get_caller_identity(event) or '<unauthenticated>',
                    sorted(allowed),
                    sorted(caller_groups) or '<no groups>',
                )
                return forbidden_response(
                    'You do not have permission to perform this action', event
                )

            return func(event, context, *args, **kwargs)

        return wrapper
    return decorator


__all__ = [
    'ADMIN_GROUP',
    'GROUPS_CLAIM',
    'USERS_GROUP',
    'get_caller_claims',
    'get_caller_groups',
    'get_caller_identity',
    'is_self_reference',
    'require_group',
]
