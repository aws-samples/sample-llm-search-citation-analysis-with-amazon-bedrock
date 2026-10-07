"""The caller's groups come from the user pool, not from the access token."""

from __future__ import annotations

from unittest.mock import MagicMock

import directory
import pytest
from auth import verify_claims
from botocore.exceptions import ClientError


@pytest.fixture
def pool(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    """A fake Cognito client answering ``Admin`` and ``Users`` for every user, and an empty cache for the test."""
    client = MagicMock()
    client.admin_list_groups_for_user.return_value = {'Groups': [{'GroupName': 'Users'}, {'GroupName': 'Admin'}]}
    monkeypatch.setattr(directory, '_client', client)
    monkeypatch.setattr(directory, '_cache', {})
    return client


@pytest.fixture
def real_lookup(monkeypatch: pytest.MonkeyPatch) -> None:
    """Undo the conftest stub that keeps the token's groups, so these tests exercise the lookup itself."""
    monkeypatch.setattr(directory, 'with_directory_groups', _REAL_WITH_DIRECTORY_GROUPS)


_REAL_WITH_DIRECTORY_GROUPS = directory.with_directory_groups


@pytest.mark.usefixtures('real_lookup')
class TestWithDirectoryGroups:
    def test_gives_an_admin_their_pool_groups_when_the_token_carries_none(self, pool, claims):
        caller = verify_claims(claims(**{'cognito:groups': None}))

        enriched = directory.with_directory_groups(caller)

        assert (enriched.groups, enriched.raw_groups) == (frozenset({'Admin', 'Users'}), ['Admin', 'Users'])

    def test_replaces_a_stale_token_claim_with_the_pool_groups(self, pool, claims):
        pool.admin_list_groups_for_user.return_value = {'Groups': [{'GroupName': 'Users'}]}
        caller = verify_claims(claims(**{'cognito:groups': 'Admin,Users'}))

        assert directory.with_directory_groups(caller).groups == frozenset({'Users'})

    def test_asks_the_configured_pool_about_the_callers_username(self, pool, claims, mcp_env):
        directory.with_directory_groups(verify_claims(claims()))

        assert pool.admin_list_groups_for_user.call_args.kwargs == {
            'UserPoolId': mcp_env['MCP_USER_POOL_ID'], 'Username': 'alice', 'Limit': directory.GROUPS_PAGE_LIMIT,
        }

    def test_keeps_the_token_groups_when_the_pool_cannot_be_read(self, pool, claims):
        pool.admin_list_groups_for_user.side_effect = ClientError({'Error': {'Code': 'TooManyRequestsException'}}, 'AdminListGroupsForUser')
        caller = verify_claims(claims(**{'cognito:groups': 'Users'}))

        assert directory.with_directory_groups(caller) == caller

    def test_reads_the_pool_once_per_user_within_the_cache_window(self, pool, claims):
        caller = verify_claims(claims())

        directory.with_directory_groups(caller)
        directory.with_directory_groups(caller)

        assert pool.admin_list_groups_for_user.call_count == 1


class TestHandlerUsesThePool:
    def test_lets_an_admin_whose_token_lacks_the_groups_claim_run_an_admin_tool(self, rpc, api, claims, pool, monkeypatch):
        monkeypatch.setattr(directory, 'with_directory_groups', _REAL_WITH_DIRECTORY_GROUPS)
        api.answer(200, {'providers': []})
        params = {'name': 'call_tool', 'arguments': {'name': 'list_providers', 'arguments': {}}}

        result = rpc('tools/call', params, claims_override=claims(**{'cognito:groups': None}))['result']

        assert 'isError' not in result
        assert api.event['requestContext']['authorizer']['claims']['cognito:groups'] == ['Admin', 'Users']
