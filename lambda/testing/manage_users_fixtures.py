"""The manage-users handler loaded over one mocked Cognito client, for its test modules.

``boto3.client`` is patched while the hyphenated handler is imported, so its
module-level ``cognito_client`` is ``mock_cognito``. Tests call
``reset_cognito_mock`` before each case (an autouse fixture in each module) and
patch the handler's client back to the mock with ``monkeypatch``.
"""

from __future__ import annotations

import os
from typing import Any
from unittest.mock import MagicMock, patch

from botocore.exceptions import ClientError

from testing.admin_authz_fixtures import ADMIN_EMAIL, caller_event
from testing.module_loader import load_handler_module

_API_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'api')

USER_POOL_ID = 'us-east-1_testpool'
CALLER = ADMIN_EMAIL
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

_test_env = {
    'USER_POOL_ID': USER_POOL_ID,
    'CORS_ORIGIN_PARAM': '',
}

with patch('boto3.client', return_value=mock_cognito), patch.dict(os.environ, _test_env):
    handler_module = load_handler_module(_API_DIR, 'manage-users.py', 'manage_users')


def cognito_user(username: str, enabled: bool = True, status: str = 'CONFIRMED') -> dict[str, Any]:
    """An admin_get_user-shaped Cognito response."""
    return {
        'Username': username,
        'UserAttributes': [
            {'Name': 'email', 'Value': username},
            {'Name': 'email_verified', 'Value': 'true'},
        ],
        'UserStatus': status,
        'Enabled': enabled,
    }


def listed_user(username: str) -> dict[str, Any]:
    """One list_users entry."""
    return {
        'Username': username,
        'Attributes': [{'Name': 'email', 'Value': username}],
        'UserStatus': 'CONFIRMED',
        'Enabled': True,
    }


def cognito_failure(operation: str, code: str = 'InternalErrorException') -> ClientError:
    """A Cognito failure that is neither an unknown user nor a route-specific code."""
    return ClientError({'Error': {'Code': code, 'Message': 'boom'}}, operation)


def make_event(
    method: str,
    path: str = '/api/users',
    body: dict[str, Any] | None = None,
    groups: str | None = 'Admin',
) -> dict[str, Any]:
    """An event addressing a collection route as an Admin unless ``groups`` says otherwise."""
    return caller_event(method, path, body=body, groups=groups)


def user_event(
    method: str,
    username: str,
    body: dict[str, Any] | None = None,
    groups: str | None = 'Admin',
    suffix: str = '',
) -> dict[str, Any]:
    """An event addressing ``/api/users/{username}`` (plus ``suffix``) as an Admin unless ``groups`` says otherwise."""
    return caller_event(
        method,
        f'/api/users/{username}{suffix}',
        body=body,
        path_params={'username': username},
        groups=groups,
    )


def reset_cognito_mock() -> None:
    """Forget every call and give each Cognito operation its happy-path answer."""
    mock_cognito.reset_mock(return_value=True, side_effect=True)
    _restore_cognito_exception_classes()
    mock_cognito.list_users.return_value = {'Users': [listed_user(CALLER), listed_user(OTHER_USER)]}
    mock_cognito.admin_get_user.return_value = cognito_user(OTHER_USER)
    mock_cognito.admin_list_groups_for_user.return_value = {'Groups': [{'GroupName': 'Users'}]}
    mock_cognito.list_groups.return_value = {'Groups': [{'GroupName': 'Admin'}, {'GroupName': 'Users'}]}
    for operation in (
        'admin_add_user_to_group', 'admin_remove_user_from_group', 'admin_delete_user',
        'admin_disable_user', 'admin_enable_user', 'admin_reset_user_password',
    ):
        getattr(mock_cognito, operation).return_value = {}
