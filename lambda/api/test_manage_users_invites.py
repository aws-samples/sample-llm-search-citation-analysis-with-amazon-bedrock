"""Invitation behaviour of manage-users.py: honest group reporting and resending a pending invite.

Cognito refuses ``admin_reset_user_password`` for a user who has never signed
in (``FORCE_CHANGE_PASSWORD``), so the reset route resends their invitation
instead; and an invite whose group assignment partly failed reports the groups
the user actually joined, not the ones requested.
"""

from __future__ import annotations

from typing import Any

import pytest

from testing.admin_authz_fixtures import invoke
from testing.manage_users_fixtures import (
    OTHER_USER,
    USER_POOL_ID,
    cognito_failure,
    cognito_user,
    handler_module,
    make_event,
    mock_cognito,
    reset_cognito_mock,
    user_event,
)

NEW_EMAIL = 'new@example.com'


@pytest.fixture(autouse=True)
def _fresh_cognito():
    """Each case starts from the happy-path Cognito answers."""
    reset_cognito_mock()
    mock_cognito.admin_create_user.return_value = {'User': cognito_user(NEW_EMAIL, status='FORCE_CHANGE_PASSWORD')}


def _reset_password(status: str) -> tuple[int, Any]:
    """``(status, body)`` of resetting OTHER_USER's password while Cognito reports ``status`` for them."""
    mock_cognito.admin_get_user.return_value = cognito_user(OTHER_USER, status=status)
    return invoke(handler_module, user_event('POST', OTHER_USER, suffix='/reset-password'))


def _invite(groups: list[str]) -> tuple[int, Any]:
    """``(status, body)`` of inviting NEW_EMAIL into ``groups`` as an Admin."""
    return invoke(handler_module, make_event('POST', body={'email': NEW_EMAIL, 'groups': groups}))


def _refuse_group(refused: str) -> None:
    """Make adding a user to ``refused`` fail; every other group succeeds."""
    def add(**kwargs: Any) -> dict[str, Any]:
        if kwargs['GroupName'] == refused:
            raise cognito_failure('admin_add_user_to_group', 'ResourceNotFoundException')
        return {}
    mock_cognito.admin_add_user_to_group.side_effect = add


class TestResetPasswordOfAPendingInvite:
    def test_answers_that_the_invitation_was_sent_again(self):
        assert _reset_password('FORCE_CHANGE_PASSWORD') == (
            200, {'message': 'Invitation email sent again', 'action': 'invite_resent'},
        )

    def test_resends_the_invitation_email_through_cognito(self):
        _reset_password('FORCE_CHANGE_PASSWORD')

        mock_cognito.admin_create_user.assert_called_once_with(
            UserPoolId=USER_POOL_ID, Username=OTHER_USER, MessageAction='RESEND', DesiredDeliveryMediums=['EMAIL'],
        )

    def test_does_not_attempt_a_password_reset_cognito_would_refuse(self):
        _reset_password('FORCE_CHANGE_PASSWORD')

        assert mock_cognito.admin_reset_user_password.call_count == 0

    def test_returns_500_with_the_routes_message_when_the_resend_fails(self):
        mock_cognito.admin_create_user.side_effect = cognito_failure('admin_create_user')

        assert _reset_password('FORCE_CHANGE_PASSWORD') == (500, {'error': 'Failed to reset password'})


class TestResetPasswordOfASignedInUser:
    @pytest.mark.parametrize('status', ['CONFIRMED', 'RESET_REQUIRED'])
    def test_answers_that_a_password_reset_was_sent(self, status):
        assert _reset_password(status) == (
            200, {'message': 'Password reset email sent to user', 'action': 'password_reset'},
        )

    def test_resets_the_password_without_resending_an_invite(self):
        _reset_password('CONFIRMED')

        assert (mock_cognito.admin_reset_user_password.call_count, mock_cognito.admin_create_user.call_count) == (1, 0)


class TestInviteGroupReporting:
    def test_reports_every_requested_group_when_all_were_added(self):
        _, body = _invite(['Users', 'Admin'])

        assert body['user']['groups'] == ['Users', 'Admin']

    def test_carries_no_warning_when_all_groups_were_added(self):
        _, body = _invite(['Users'])

        assert ('warning' in body, 'groups_failed' in body) == (False, False)

    def test_reports_only_the_groups_the_user_actually_joined(self):
        _refuse_group('Admin')

        _, body = _invite(['Users', 'Admin'])

        assert body['user']['groups'] == ['Users']

    def test_lists_the_groups_that_could_not_be_assigned(self):
        _refuse_group('Admin')

        _, body = _invite(['Users', 'Admin'])

        assert body['groups_failed'] == ['Admin']

    def test_warns_that_the_invite_went_out_without_the_failed_group(self):
        _refuse_group('Admin')

        status, body = _invite(['Users', 'Admin'])

        assert (status, body['warning']) == (
            200, 'The invitation was sent, but the user could not be added to: Admin',
        )
