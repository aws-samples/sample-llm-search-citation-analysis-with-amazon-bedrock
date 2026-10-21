"""Volume tests for GET /api/users.

Before: every request read up to 50 Cognito pages (3,000 users) and looked up
the groups of every one of them (3,000 admin_list_groups_for_user calls,
about 15 s at 10 in flight) to answer one offset page of at most 100, so a
large pool risked API Gateway's 29 s timeout. Now ``next_token`` wraps
Cognito's PaginationToken: a request reads only the users it returns and
looks up only their groups.
"""

from __future__ import annotations

from typing import Any

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from testing.admin_authz_fixtures import caller_event
from testing.events import parse_response
from testing.manage_users_fixtures import (
    CognitoInvalidParameter,
    handler_module,
    listed_user,
    mock_cognito,
)
from testing.paging import INVALID_NEXT_TOKEN, follow_next_token
from testing.response_size import assert_within_page_budget


@pytest.fixture(autouse=True)
def _reset(monkeypatch: pytest.MonkeyPatch) -> None:
    mock_cognito.reset_mock(side_effect=True, return_value=True)
    mock_cognito.exceptions.InvalidParameterException = CognitoInvalidParameter
    mock_cognito.exceptions.UserNotFoundException = type('UserNotFound', (Exception,), {})
    monkeypatch.setattr(handler_module, 'cognito_client', mock_cognito)


def _pool(size: int) -> None:
    """Make Cognito list a pool of ``size`` users, honouring Limit and PaginationToken."""
    users = [listed_user(f'usuario.{n:05d}@hotel-coruña.example') for n in range(size)]

    def list_users(**params: Any) -> dict[str, Any]:
        start = int(params.get('PaginationToken', '0'))
        page = users[start:start + params['Limit']]
        response: dict[str, Any] = {'Users': page}
        if start + len(page) < len(users):
            response['PaginationToken'] = str(start + len(page))
        return response

    mock_cognito.list_users.side_effect = list_users
    mock_cognito.admin_list_groups_for_user.return_value = {'Groups': [{'GroupName': 'Users'}]}


def _list(query: dict[str, str]) -> dict[str, Any]:
    return handler_module.handler(caller_event('GET', '/api/users', query=query), {})


def test_stays_within_page_budget_when_pool_has_thousands_of_users() -> None:
    _pool(5_000)

    assert_within_page_budget(_list({'limit': '100'}))


def test_looks_up_groups_only_for_the_returned_page() -> None:
    _pool(5_000)

    _status, body = parse_response(_list({'limit': '100'}))

    assert (body['count'], mock_cognito.admin_list_groups_for_user.call_count, mock_cognito.list_users.call_count) == (100, 100, 2)


@settings(max_examples=20, deadline=None)
@given(st.integers(min_value=0, max_value=400), st.integers(min_value=1, max_value=100))
def test_following_next_token_returns_every_user_once_in_order(size: int, limit: int) -> None:
    _pool(size)

    collected = follow_next_token(_list, {'limit': str(limit)}, lambda body: [user['username'] for user in body['users']])

    assert collected == [f'usuario.{n:05d}@hotel-coruña.example' for n in range(size)]


def test_rejects_malformed_next_token_with_400() -> None:
    _pool(3)

    assert parse_response(_list({'next_token': 'e30'})) == INVALID_NEXT_TOKEN


def test_rejects_expired_cognito_token_with_400() -> None:
    mock_cognito.list_users.side_effect = CognitoInvalidParameter('expired')

    assert parse_response(_list({'next_token': 'eyJjb2duaXRvIjoiYWJjIn0'})) == INVALID_NEXT_TOKEN
