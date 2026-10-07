"""
The caller's Cognito groups, read from the user pool rather than from the access token.

Cognito writes ``cognito:groups`` into an access token only when the client
requested the ``openid`` scope, and an MCP client requests the scopes it
finds in the protected resource metadata, which offers none but the
server's own. Authorization must not depend on which scopes a client
happened to ask for, so the groups the admin tools and the replayed API
handlers check come from ``AdminListGroupsForUser`` on the pool
(``MCP_USER_POOL_ID``). That is also current: a user removed from ``Admin``
loses it within ``GROUPS_CACHE_SECONDS`` instead of at the token's expiry.

Each container caches a user's groups for ``GROUPS_CACHE_SECONDS``. When the
lookup fails the token's own claim stands, so an outage never grants more
than the token says (and a token without the claim gets no group at all).
"""

from __future__ import annotations

import logging
import os
from dataclasses import replace
from time import monotonic
from typing import Any

import boto3
from auth import Caller
from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

#: How long a container trusts the groups it read for a user.
GROUPS_CACHE_SECONDS = 60.0
#: A user's groups are few; one page covers them (the API allows up to 60 per page).
GROUPS_PAGE_LIMIT = 60

_client: Any = None
_cache: dict[str, tuple[float, tuple[str, ...]]] = {}


def cognito() -> Any:
    """The Cognito Identity Provider client, created on first use so importing this module needs no AWS region."""
    global _client
    if _client is None:
        _client = boto3.client('cognito-idp')
    return _client


def user_groups(username: str) -> tuple[str, ...]:
    """The names of the groups ``username`` belongs to, sorted; raises on a failed lookup."""
    cached = _cache.get(username)
    if cached is not None and monotonic() - cached[0] < GROUPS_CACHE_SECONDS:
        return cached[1]
    response = cognito().admin_list_groups_for_user(
        UserPoolId=os.environ['MCP_USER_POOL_ID'],
        Username=username,
        Limit=GROUPS_PAGE_LIMIT,
    )
    groups = tuple(sorted(str(group['GroupName']) for group in response.get('Groups', []) if group.get('GroupName')))
    _cache[username] = (monotonic(), groups)
    return groups


def with_directory_groups(caller: Caller) -> Caller:
    """``caller`` with the groups the user pool holds for them; the token's groups when the pool cannot be read."""
    try:
        groups = user_groups(caller.username)
    except (BotoCoreError, ClientError):
        logger.exception('Reading the caller groups from the user pool failed; keeping the token claim')
        return caller
    return replace(caller, groups=frozenset(groups), raw_groups=list(groups))
