"""
Authorization tests for manage-users.py (AUDIT-2026-08-19 §0.1, §0.2).

This handler had no test file at all, while hosting the two paths that let any
signed-in user take over the deployment:

- `PUT /api/users/<self>` with `{"groups":["Admin"]}` — nothing compared the
  target against the caller, so a read-only invited user could promote
  themselves.
- `DELETE /api/users/<anyone>` — irreversible, and `handle_list_users` handed
  any caller the roster to pick from first.

Every test below asserts both the refusal *and* that no Cognito mutation was
attempted. A 403 returned after `admin_add_user_to_group` already succeeded
would be no fix at all.

Also covers the route regression where `('GET', None)` shadowed
`handle_get_user`, making `GET /api/users/{username}` return the whole roster,
and the one Cognito error mapping every route shares.
"""

from __future__ import annotations

import json
import os
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from testing.module_loader import load_handler_module

_API_DIR = os.path.dirname(os.path.abspath(__file__))

CALLER = 'admin@example.com'
OTHER_USER = 'victim@example.com'


class CognitoUserNotFound(Exception):
    """Stands in for cognito_client.exceptions.UserNotFoundException."""


class CognitoInvalidParameter(Exception):
    """Stands in for cognito_client.exceptions.InvalidParameterException."""


class CognitoUsernameExists(Exception):
    """Stands in for cognito_client.exceptions.UsernameExistsException."""


mock_cognito = MagicMock()


def _restore_cognito_exception_classes() -> None:
    """Real exception classes on the mock: handlers name them in `except` clauses."""
    mock_cognito.exceptions.UserNotFoundException = CognitoUserNotFound
    mock_cognito.exceptions.InvalidParameterException = CognitoInvalidParameter
    mock_cognito.exceptions.UsernameExistsException = CognitoUsernameExists


_restore_cognito_exception_classes()


def _mock_boto3_client(*args, **kwargs):
    return mock_cognito


_test_env = {
    'USER_POOL_ID': 'us-east-1_testpool',
    'CORS_ORIGIN_PARAM': '',
}

with patch('boto3.client', side_effect=_mock_boto3_client):
    with patch.dict(os.environ, _test_env):
        _handler_mod = load_handler_module(_API_DIR, 'manage-users.py', 'manage_users')


def make_event(
    method: str,
    path: str = '/api/users',
    body: dict[str, Any] | None = None,
    path_params: dict[str, str] | None = None,
    groups: str | None = 'Admin',
    caller: str = CALLER,
) -> dict[str, Any]:
    """Build an API Gateway event with Cognito authorizer claims.

    `groups=None` builds an authenticated-but-ungrouped caller, which is what
    an invited read-only user actually looks like.
    """
    claims: dict[str, Any] = {
        'sub': '11111111-2222-3333-4444-555555555555',
        'cognito:username': caller,
        'email': caller,
    }
    if groups is not None:
        claims['cognito:groups'] = groups

    return {
        'httpMethod': method,
        'path': path,
        'pathParameters': path_params,
        'headers': {'origin': 'http://localhost:3000'},
        'body': json.dumps(body) if body is not None else None,
        'requestContext': {'authorizer': {'claims': claims}},
    }


def user_event(
    method: str,
    username: str,
    body: dict[str, Any] | None = None,
    groups: str | None = 'Admin',
    suffix: str = '',
) -> dict[str, Any]:
    """An event addressing ``/api/users/{username}`` (plus ``suffix``) as an Admin unless ``groups`` says otherwise."""
    return make_event(
        method,
        path=f'/api/users/{username}{suffix}',
        body=body,
        path_params={'username': username},
        groups=groups,
    )


def parse_response(result: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    """Extract status code and parsed body from a Lambda response."""
    status = result.get('statusCode', 200)
    raw = result.get('body')
    body = json.loads(raw) if isinstance(raw, str) and raw else {}
    return status, body


def cognito_user(username: str, enabled: bool = True) -> dict[str, Any]:
    """Build an admin_get_user-shaped Cognito response."""
    return {
        'Username': username,
        'UserAttributes': [
            {'Name': 'email', 'Value': username},
            {'Name': 'email_verified', 'Value': 'true'},
        ],
        'UserStatus': 'CONFIRMED',
        'Enabled': enabled,
    }


def cognito_failure(operation: str) -> ClientError:
    """A Cognito failure that is neither an unknown user nor a route-specific code."""
    return ClientError({'Error': {'Code': 'InternalErrorException', 'Message': 'boom'}}, operation)


@pytest.fixture(autouse=True)
def _reset_mocks():
    """Reset Cognito mocks before each test."""
    mock_cognito.reset_mock(return_value=True, side_effect=True)
    _restore_cognito_exception_classes()
    mock_cognito.list_users.return_value = {
        'Users': [
            {
                'Username': CALLER,
                'Attributes': [{'Name': 'email', 'Value': CALLER}],
                'UserStatus': 'CONFIRMED',
                'Enabled': True,
            },
            {
                'Username': OTHER_USER,
                'Attributes': [{'Name': 'email', 'Value': OTHER_USER}],
                'UserStatus': 'CONFIRMED',
                'Enabled': True,
            },
        ]
    }
    mock_cognito.admin_get_user.return_value = cognito_user(OTHER_USER)
    mock_cognito.admin_list_groups_for_user.return_value = {'Groups': [{'GroupName': 'Users'}]}
    mock_cognito.list_groups.return_value = {'Groups': [{'GroupName': 'Admin'}, {'GroupName': 'Users'}]}
    mock_cognito.admin_add_user_to_group.return_value = {}
    mock_cognito.admin_remove_user_from_group.return_value = {}
    mock_cognito.admin_delete_user.return_value = {}
    mock_cognito.admin_disable_user.return_value = {}
    mock_cognito.admin_enable_user.return_value = {}


@pytest.fixture
def handler_module(monkeypatch):
    """Provide the handler module with the mocked Cognito client."""
    monkeypatch.setattr(_handler_mod, 'cognito_client', mock_cognito)
    return _handler_mod


class TestPrivilegeEscalation:
    """
    §0.1 — the self-service promotion path.

    A read-only invited user enumerated group names via GET /api/users/groups,
    then PUT their own record with {"groups":["Admin"]}.
    """

    def test_non_admin_promoting_another_user_to_admin_returns_403(self, handler_module):
        event = user_event('PUT', OTHER_USER, body={'groups': ['Admin']}, groups='Users')

        status, _ = parse_response(handler_module.handler(event, {}))

        assert status == 403

    def test_non_admin_promotion_attempt_never_reaches_cognito(self, handler_module):
        event = user_event('PUT', OTHER_USER, body={'groups': ['Admin']}, groups='Users')

        handler_module.handler(event, {})

        assert mock_cognito.admin_add_user_to_group.call_count == 0

    def test_ungrouped_user_promoting_themselves_returns_403(self, handler_module):
        """The exact attack: no group claim at all, targeting own record."""
        event = user_event('PUT', CALLER, body={'groups': ['Admin']}, groups=None)

        status, _ = parse_response(handler_module.handler(event, {}))

        assert status == 403

    def test_admin_promoting_themselves_returns_403(self, handler_module):
        """
        Self-modification of `groups` is refused regardless of caller group —
        on the wire it is indistinguishable from the escalation attack.
        """
        event = user_event('PUT', CALLER, body={'groups': ['Admin']})

        status, _ = parse_response(handler_module.handler(event, {}))

        assert status == 403

    def test_admin_self_promotion_attempt_never_reaches_cognito(self, handler_module):
        event = user_event('PUT', CALLER, body={'groups': ['Admin']})

        handler_module.handler(event, {})

        assert mock_cognito.admin_add_user_to_group.call_count == 0

    def test_self_reference_is_detected_across_letter_case(self, handler_module):
        """Pool usernames are lowercased emails; the path param may not be."""
        event = user_event('PUT', 'Admin@Example.COM', body={'groups': ['Admin']})

        status, _ = parse_response(handler_module.handler(event, {}))

        assert status == 403

    def test_admin_disabling_their_own_account_returns_403(self, handler_module):
        """Self-disable can lock the last administrator out of the deployment."""
        event = user_event('PUT', CALLER, body={'enabled': False})

        status, _ = parse_response(handler_module.handler(event, {}))

        assert status == 403

    def test_admin_self_disable_never_reaches_cognito(self, handler_module):
        event = user_event('PUT', CALLER, body={'enabled': False})

        handler_module.handler(event, {})

        assert mock_cognito.admin_disable_user.call_count == 0

    def test_admin_can_still_change_another_users_groups(self, handler_module):
        """The legitimate workflow must survive the guard."""
        event = user_event('PUT', OTHER_USER, body={'groups': ['Admin']})

        status, _ = parse_response(handler_module.handler(event, {}))

        assert status == 200
        mock_cognito.admin_add_user_to_group.assert_any_call(
            UserPoolId='us-east-1_testpool', Username=OTHER_USER, GroupName='Admin'
        )

    def test_admin_can_still_rename_their_own_non_privileged_fields(self, handler_module):
        """The guard covers `groups` and `enabled` only, not the whole route."""
        mock_cognito.admin_get_user.return_value = cognito_user(CALLER)
        event = user_event('PUT', CALLER, body={})

        status, _ = parse_response(handler_module.handler(event, {}))

        assert status == 200


class TestGroupsPayloadValidation:
    """
    `set(body['groups'])` was unguarded.

    A bare string silently became one bogus group per character, firing five
    Cognito calls for `"Admin"`; a non-iterable raised TypeError into a 500.
    """

    def test_returns_400_when_groups_is_a_bare_string(self, handler_module):
        event = user_event('PUT', OTHER_USER, body={'groups': 'Admin'})

        status, body = parse_response(handler_module.handler(event, {}))

        assert status == 400
        assert body['field'] == 'groups'

    def test_does_not_call_cognito_with_per_character_groups(self, handler_module):
        """REGRESSION: 'Admin' must not expand to {'A','d','m','i','n'}."""
        event = user_event('PUT', OTHER_USER, body={'groups': 'Admin'})

        handler_module.handler(event, {})

        assert mock_cognito.admin_add_user_to_group.call_count == 0

    def test_returns_400_when_groups_is_not_a_list(self, handler_module):
        event = user_event('PUT', OTHER_USER, body={'groups': 42})

        status, _ = parse_response(handler_module.handler(event, {}))

        assert status == 400

    def test_returns_400_when_groups_contains_a_non_string(self, handler_module):
        event = user_event('PUT', OTHER_USER, body={'groups': ['Admin', 7]})

        status, _ = parse_response(handler_module.handler(event, {}))

        assert status == 400


class TestUserDeletion:
    """§0.2 — `admin_delete_user` is irreversible."""

    def test_non_admin_deleting_a_user_returns_403(self, handler_module):
        event = user_event('DELETE', OTHER_USER, groups='Users')

        status, _ = parse_response(handler_module.handler(event, {}))

        assert status == 403

    def test_non_admin_deletion_never_reaches_cognito(self, handler_module):
        event = user_event('DELETE', OTHER_USER, groups='Users')

        handler_module.handler(event, {})

        assert mock_cognito.admin_delete_user.call_count == 0

    def test_admin_deleting_their_own_account_returns_403(self, handler_module):
        """Irreversible, and the caller may be the last Admin."""
        event = user_event('DELETE', CALLER)

        status, _ = parse_response(handler_module.handler(event, {}))

        assert status == 403

    def test_admin_self_deletion_never_reaches_cognito(self, handler_module):
        event = user_event('DELETE', CALLER)

        handler_module.handler(event, {})

        assert mock_cognito.admin_delete_user.call_count == 0

    def test_admin_can_still_delete_another_user(self, handler_module):
        event = user_event('DELETE', OTHER_USER)

        status, _ = parse_response(handler_module.handler(event, {}))

        assert status == 200
        mock_cognito.admin_delete_user.assert_called_once_with(
            UserPoolId='us-east-1_testpool', Username=OTHER_USER
        )


class TestReadRoutesRequireAdmin:
    """
    The reads are administrative too.

    `handle_list_users` returns the full roster and `handle_list_groups`
    enumerates the group names the escalation path needs, so both are gated.
    """

    def test_listing_users_without_the_admin_group_returns_403(self, handler_module):
        status, _ = parse_response(
            handler_module.handler(make_event('GET', groups='Users'), {})
        )

        assert status == 403

    def test_listing_users_never_reaches_cognito_when_denied(self, handler_module):
        handler_module.handler(make_event('GET', groups='Users'), {})

        assert mock_cognito.list_users.call_count == 0

    def test_listing_groups_without_the_admin_group_returns_403(self, handler_module):
        event = make_event('GET', path='/api/users/groups', groups='Users')

        status, _ = parse_response(handler_module.handler(event, {}))

        assert status == 403

    def test_inviting_a_user_without_the_admin_group_returns_403(self, handler_module):
        event = make_event('POST', body={'email': 'new@example.com'}, groups='Users')

        status, _ = parse_response(handler_module.handler(event, {}))

        assert status == 403

    def test_invite_never_creates_the_user_when_denied(self, handler_module):
        event = make_event('POST', body={'email': 'new@example.com'}, groups='Users')

        handler_module.handler(event, {})

        assert mock_cognito.admin_create_user.call_count == 0

    def test_resetting_a_password_without_the_admin_group_returns_403(self, handler_module):
        event = user_event('POST', OTHER_USER, groups='Users', suffix='/reset-password')

        status, _ = parse_response(handler_module.handler(event, {}))

        assert status == 403

    def test_returns_403_for_a_direct_lambda_invoke_with_no_request_context(self, handler_module):
        """
        The Step Functions role can invoke this function directly, bypassing
        API Gateway. That event has no claims and must not be trusted.
        """
        status, _ = parse_response(
            handler_module.handler({'httpMethod': 'GET', 'path': '/api/users'}, {})
        )

        assert status == 403


class TestCorsPreflightIsNotGated:
    """
    `@cors_preflight` sits above `@require_group` on purpose.

    An OPTIONS preflight carries no Authorization header, so gating it would
    turn every admin route into an opaque browser CORS error instead of a
    readable 403.
    """

    def test_options_preflight_succeeds_without_any_claims(self, handler_module):
        event = {
            'httpMethod': 'OPTIONS',
            'path': '/api/users',
            'headers': {'origin': 'http://localhost:3000'},
        }

        status, _ = parse_response(handler_module.handler(event, {}))

        assert status == 200


class TestGetUserRouting:
    """
    REGRESSION: `('GET', None)` is a method-only match, so it swallowed every
    GET — including `GET /api/users/{username}` — and returned the paginated
    roster while `handle_get_user` sat unreachable.
    """

    def test_get_with_a_username_returns_that_single_user(self, handler_module):
        mock_cognito.admin_get_user.return_value = cognito_user(OTHER_USER)

        status, body = parse_response(handler_module.handler(user_event('GET', OTHER_USER), {}))

        assert status == 200
        assert body['user']['username'] == OTHER_USER

    def test_get_with_a_username_does_not_return_the_roster(self, handler_module):
        _, body = parse_response(handler_module.handler(user_event('GET', OTHER_USER), {}))

        assert 'users' not in body

    def test_get_without_a_username_returns_the_roster(self, handler_module):
        status, body = parse_response(handler_module.handler(make_event('GET'), {}))

        assert status == 200
        assert [user['username'] for user in body['users']] == [CALLER, OTHER_USER]

    def test_get_groups_still_routes_to_the_group_list(self, handler_module):
        """The static /groups segment must keep winning over the parametric route."""
        event = make_event('GET', path='/api/users/groups')

        status, body = parse_response(handler_module.handler(event, {}))

        assert status == 200
        assert [group['name'] for group in body['groups']] == ['Admin', 'Users']


class TestCognitoErrorMapping:
    """
    Every route answers Cognito's failures the same way: an unknown user is a
    404 naming the user, any other client error is a 500 carrying the route's
    own message, and the two route-specific codes (409 on an existing
    username, 400 on an invalid reset) keep their place ahead of that.
    """

    @staticmethod
    def _answer(handler_module, method: str, suffix: str = '', body: dict[str, Any] | None = None) -> tuple[int, dict[str, Any]]:
        """``(status, body)`` the route addressing OTHER_USER answers an Admin with."""
        return parse_response(handler_module.handler(user_event(method, OTHER_USER, body=body, suffix=suffix), {}))

    @staticmethod
    def _invite(handler_module) -> tuple[int, dict[str, Any]]:
        """``(status, body)`` of inviting a new address as an Admin."""
        return parse_response(handler_module.handler(make_event('POST', body={'email': 'new@example.com'}), {}))

    @pytest.mark.parametrize(('method', 'suffix', 'body', 'failing_call'), [
        ('GET', '', None, 'admin_get_user'),
        ('PUT', '', {'enabled': True}, 'admin_enable_user'),
        ('DELETE', '', None, 'admin_delete_user'),
        ('POST', '/reset-password', None, 'admin_reset_user_password'),
    ], ids=['get', 'update', 'delete', 'reset-password'])
    def test_returns_404_naming_the_user_when_cognito_does_not_know_them(
        self, handler_module, method, suffix, body, failing_call
    ):
        getattr(mock_cognito, failing_call).side_effect = CognitoUserNotFound()

        assert self._answer(handler_module, method, suffix, body) == (404, {'error': f'User {OTHER_USER} not found'})

    @pytest.mark.parametrize(('method', 'suffix', 'body', 'failing_call', 'message'), [
        ('GET', '', None, 'admin_get_user', 'Failed to get user'),
        ('PUT', '', {'enabled': True}, 'admin_enable_user', 'Failed to update user'),
        ('DELETE', '', None, 'admin_delete_user', 'Failed to delete user'),
        ('POST', '/reset-password', None, 'admin_reset_user_password', 'Failed to reset password'),
    ], ids=['get', 'update', 'delete', 'reset-password'])
    def test_returns_500_with_the_routes_message_when_cognito_fails(
        self, handler_module, method, suffix, body, failing_call, message
    ):
        getattr(mock_cognito, failing_call).side_effect = cognito_failure(failing_call)

        assert self._answer(handler_module, method, suffix, body) == (500, {'error': message})

    @pytest.mark.parametrize(('path', 'failing_call', 'message'), [
        ('/api/users', 'list_users', 'Failed to list users'),
        ('/api/users/groups', 'list_groups', 'Failed to list groups'),
    ], ids=['users', 'groups'])
    def test_returns_500_with_the_listings_message_when_cognito_fails(self, handler_module, path, failing_call, message):
        getattr(mock_cognito, failing_call).side_effect = cognito_failure(failing_call)

        status, response = parse_response(handler_module.handler(make_event('GET', path=path), {}))

        assert (status, response) == (500, {'error': message})

    def test_returns_409_when_the_invited_email_is_already_a_user(self, handler_module):
        mock_cognito.admin_create_user.side_effect = CognitoUsernameExists()

        assert self._invite(handler_module) == (409, {'error': 'User with this email already exists'})

    def test_returns_500_with_the_invite_message_when_cognito_fails(self, handler_module):
        mock_cognito.admin_create_user.side_effect = cognito_failure('admin_create_user')

        assert self._invite(handler_module) == (500, {'error': 'Failed to invite user'})

    def test_returns_a_sanitised_400_when_the_reset_parameters_are_invalid(self, handler_module):
        mock_cognito.admin_reset_user_password.side_effect = CognitoInvalidParameter('no verified email')

        assert self._answer(handler_module, 'POST', '/reset-password') == (400, {'error': 'An unexpected error occurred'})
