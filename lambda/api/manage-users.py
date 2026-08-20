"""
User Management API
Manages Cognito users: list, invite, update, enable/disable, reset password
"""

import concurrent.futures
import logging
import os
import sys
from typing import Any

import boto3
from botocore.exceptions import ClientError

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import (
    api_response,
    forbidden_response,
    not_found_response,
    sanitize_error_message,
    success_response,
    validation_error,
)
from shared.auth import ADMIN_GROUP, is_self_reference, require_group
from shared.decorators import api_handler, cors_preflight, paginate, parse_json_body, route_handler

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

cognito_client = boto3.client('cognito-idp')

# Fail-fast: Required environment variables
USER_POOL_ID = os.environ['USER_POOL_ID']


def format_user(user: dict) -> dict:
    """Format Cognito user response for frontend."""
    attributes = {attr['Name']: attr['Value'] for attr in user.get('Attributes', user.get('UserAttributes', []))}

    return {
        'username': user.get('Username'),
        'email': attributes.get('email', ''),
        'email_verified': attributes.get('email_verified', 'false') == 'true',
        'status': user.get('UserStatus', 'UNKNOWN'),
        'enabled': user.get('Enabled', True),
        'created_at': user.get('UserCreateDate').isoformat() if user.get('UserCreateDate') else None,
        'updated_at': user.get('UserLastModifiedDate').isoformat() if user.get('UserLastModifiedDate') else None,
        'groups': []  # Will be populated separately if needed
    }


# Cap on how many Cognito pages we'll fetch in a single request. Each page
# is up to 60 users, so the default caps at ~3000 users per list call. When
# the frontend needs more, the migration path is to surface Cognito's own
# PaginationToken (see audit item 17 follow-up).
_MAX_COGNITO_PAGES = 50

# Max concurrent admin_list_groups_for_user calls. Cognito has no batch API
# so we fan out; 10 threads keeps us well under the 120 RPS soft limit.
_GROUPS_FANOUT = 10


def _fetch_user_groups(username: str) -> list[str]:
    """Return the list of Cognito groups for a single user, empty on error."""
    try:
        response = cognito_client.admin_list_groups_for_user(
            Username=username, UserPoolId=USER_POOL_ID,
        )
        return [g['GroupName'] for g in response.get('Groups', [])]
    except ClientError:
        return []


def handle_list_users(event: dict, context: Any, limit: int, offset: int, **kwargs) -> dict:
    """GET /users - List all Cognito users with pagination.

    Fetches Cognito pages up to `_MAX_COGNITO_PAGES` (hard cap; the previous
    unbounded loop would hang the Lambda on a pagination-token bug). The
    per-user group lookup is N+1 — Cognito has no batch API — so we fan out
    with a ThreadPoolExecutor. See audit items 16 and 17.
    """
    try:
        users: list[dict] = []
        pagination_token = None
        pages_fetched = 0

        while pages_fetched < _MAX_COGNITO_PAGES:
            params: dict[str, Any] = {
                'UserPoolId': USER_POOL_ID,
                'Limit': 60,  # Max allowed by Cognito
            }
            if pagination_token:
                params['PaginationToken'] = pagination_token

            response = cognito_client.list_users(**params)
            users.extend([format_user(u) for u in response.get('Users', [])])
            pagination_token = response.get('PaginationToken')
            pages_fetched += 1

            if not pagination_token:
                break

        truncated = pagination_token is not None
        if truncated:
            logger.warning(
                "Cognito list_users hit the %d-page cap; returning %d users.",
                _MAX_COGNITO_PAGES, len(users),
            )

        # Parallel group lookup. Cognito has no batch API so we fan out —
        # the previous serial loop was 50ms x N seconds linear.
        if users:
            with concurrent.futures.ThreadPoolExecutor(max_workers=_GROUPS_FANOUT) as pool:
                results = pool.map(
                    _fetch_user_groups, [u['username'] for u in users]
                )
                for user, groups in zip(users, results, strict=False):
                    user['groups'] = groups

        # Apply offset/limit pagination against the fetched page set.
        total = len(users)
        paginated = users[offset:offset + limit]

        return success_response({
            'users': paginated,
            'total': total,
            'limit': limit,
            'offset': offset,
            'has_more': offset + limit < total,
            'truncated': truncated,
        }, event)

    except ClientError as e:
        logger.error(f"Error listing users: {e!s}")
        return api_response(500, {'error': 'Failed to list users'}, event)


def handle_get_user(event: dict, context: Any, **kwargs) -> dict:
    """GET /users/{username} - Get user details."""
    path_params = event.get('pathParameters') or {}
    username = path_params.get('username')

    if not username:
        return validation_error('Username required', event)

    try:
        response = cognito_client.admin_get_user(
            UserPoolId=USER_POOL_ID,
            Username=username
        )
        user = format_user(response)

        # Get user groups
        groups_response = cognito_client.admin_list_groups_for_user(
            Username=username,
            UserPoolId=USER_POOL_ID
        )
        user['groups'] = [g['GroupName'] for g in groups_response.get('Groups', [])]

        return success_response({'user': user}, event)

    except cognito_client.exceptions.UserNotFoundException:
        return not_found_response(f'User {username}', event)
    except ClientError as e:
        logger.error(f"Error getting user: {e!s}")
        return api_response(500, {'error': 'Failed to get user'}, event)


@parse_json_body
def handle_invite_user(event: dict, context: Any, body: dict | None = None, **kwargs) -> dict:
    """POST /users - Invite a new user."""
    body = body or {}
    email = body.get('email', '').strip().lower()

    if not email:
        return validation_error('Email required', event, 'email')

    # Basic email validation
    if '@' not in email or '.' not in email:
        return validation_error('Invalid email format', event, 'email')

    groups = body.get('groups', [])
    if not isinstance(groups, list):
        groups = [groups] if groups else []

    try:
        # Create user with temporary password (Cognito will send invite email)
        response = cognito_client.admin_create_user(
            UserPoolId=USER_POOL_ID,
            Username=email,
            UserAttributes=[
                {'Name': 'email', 'Value': email},
                {'Name': 'email_verified', 'Value': 'true'}
            ],
            DesiredDeliveryMediums=['EMAIL']
        )

        user = format_user(response['User'])

        # Add to groups if specified
        for group in groups:
            try:
                cognito_client.admin_add_user_to_group(
                    UserPoolId=USER_POOL_ID,
                    Username=email,
                    GroupName=group
                )
            except ClientError as e:
                logger.warning(f"Failed to add user to group {group}: {e!s}")

        user['groups'] = groups

        return success_response({
            'user': user,
            'message': 'User invited successfully. They will receive an email with login instructions.'
        }, event)

    except cognito_client.exceptions.UsernameExistsException:
        return api_response(409, {'error': 'User with this email already exists'}, event)
    except ClientError as e:
        logger.error(f"Error inviting user: {e!s}")
        return api_response(500, {'error': 'Failed to invite user'}, event)


@parse_json_body
def handle_update_user(event: dict, context: Any, body: dict | None = None, **kwargs) -> dict:
    """PUT /users/{username} - Update user (enable/disable, groups).

    Requires Admin (gated on `handler`). Self-modification of the two
    privilege-bearing fields is refused on top of that — see the guard below.
    """
    path_params = event.get('pathParameters') or {}
    username = path_params.get('username')

    if not username:
        return validation_error('Username required', event)

    body = body or {}

    # Refused regardless of the caller's group: an Admin editing their own
    # `groups` is indistinguishable on the wire from the escalation path in
    # AUDIT-2026-08-19 §0.1, and an Admin disabling their own account can lock
    # the last administrator out of the deployment. Editing *another* user's
    # groups remains allowed — that is the legitimate admin workflow.
    privileged_edits = [field for field in ('groups', 'enabled') if field in body]
    if privileged_edits and is_self_reference(event, username):
        logger.warning(
            "Refused self-modification of %s by %r", privileged_edits, username
        )
        return forbidden_response(
            'You cannot change your own group membership or account status', event
        )

    # `set()` over a non-iterable raises TypeError, and over a bare string
    # silently yields one bogus group per character ('Admin' -> {'A','d',...}),
    # which would then hit Cognito five times. Validate the shape first.
    if 'groups' in body:
        groups_input = body['groups']
        if not isinstance(groups_input, list) or not all(
            isinstance(group, str) for group in groups_input
        ):
            return validation_error('groups must be an array of strings', event, 'groups')

    try:
        # Enable/disable user
        if 'enabled' in body:
            if body['enabled']:
                cognito_client.admin_enable_user(
                    UserPoolId=USER_POOL_ID,
                    Username=username
                )
            else:
                cognito_client.admin_disable_user(
                    UserPoolId=USER_POOL_ID,
                    Username=username
                )

        # Update groups
        if 'groups' in body:
            new_groups = set(body['groups'])

            # Get current groups
            current_groups_response = cognito_client.admin_list_groups_for_user(
                Username=username,
                UserPoolId=USER_POOL_ID
            )
            current_groups = set(g['GroupName'] for g in current_groups_response.get('Groups', []))

            # Remove from groups no longer assigned
            for group in current_groups - new_groups:
                cognito_client.admin_remove_user_from_group(
                    UserPoolId=USER_POOL_ID,
                    Username=username,
                    GroupName=group
                )

            # Add to new groups
            for group in new_groups - current_groups:
                cognito_client.admin_add_user_to_group(
                    UserPoolId=USER_POOL_ID,
                    Username=username,
                    GroupName=group
                )

        # Get updated user
        response = cognito_client.admin_get_user(
            UserPoolId=USER_POOL_ID,
            Username=username
        )
        user = format_user(response)

        groups_response = cognito_client.admin_list_groups_for_user(
            Username=username,
            UserPoolId=USER_POOL_ID
        )
        user['groups'] = [g['GroupName'] for g in groups_response.get('Groups', [])]

        return success_response({'user': user}, event)

    except cognito_client.exceptions.UserNotFoundException:
        return not_found_response(f'User {username}', event)
    except ClientError as e:
        logger.error(f"Error updating user: {e!s}")
        return api_response(500, {'error': 'Failed to update user'}, event)


def handle_delete_user(event: dict, context: Any, **kwargs) -> dict:
    """DELETE /users/{username} - Delete a user.

    Requires Admin (gated on `handler`). Self-deletion is refused because
    `admin_delete_user` is irreversible and the caller may be the last Admin.
    """
    path_params = event.get('pathParameters') or {}
    username = path_params.get('username')

    if not username:
        return validation_error('Username required', event)

    if is_self_reference(event, username):
        logger.warning("Refused self-deletion of %r", username)
        return forbidden_response('You cannot delete your own account', event)

    try:
        cognito_client.admin_delete_user(
            UserPoolId=USER_POOL_ID,
            Username=username
        )

        return success_response({'message': f'User {username} deleted successfully'}, event)

    except cognito_client.exceptions.UserNotFoundException:
        return not_found_response(f'User {username}', event)
    except ClientError as e:
        logger.error(f"Error deleting user: {e!s}")
        return api_response(500, {'error': 'Failed to delete user'}, event)


@parse_json_body
def handle_reset_password(event: dict, context: Any, body: dict | None = None, **kwargs) -> dict:
    """POST /users/{username}/reset-password - Reset user password."""
    path_params = event.get('pathParameters') or {}
    username = path_params.get('username')

    if not username:
        return validation_error('Username required', event)

    try:
        # This sends a password reset email to the user
        cognito_client.admin_reset_user_password(
            UserPoolId=USER_POOL_ID,
            Username=username
        )

        return success_response({
            'message': 'Password reset email sent to user'
        }, event)

    except cognito_client.exceptions.UserNotFoundException:
        return not_found_response(f'User {username}', event)
    except cognito_client.exceptions.InvalidParameterException as e:
        # botocore's str(e) carries the full AWS request context; route it
        # through the sanitizer like every other error path in the codebase.
        logger.error(f"Invalid parameter resetting password: {e!s}")
        return api_response(400, {'error': sanitize_error_message(e)}, event)
    except ClientError as e:
        logger.error(f"Error resetting password: {e!s}")
        return api_response(500, {'error': 'Failed to reset password'}, event)


def handle_list_groups(event: dict, context: Any, **kwargs) -> dict:
    """GET /users/groups - List available groups."""
    try:
        response = cognito_client.list_groups(
            UserPoolId=USER_POOL_ID,
            Limit=60
        )

        groups = [{
            'name': g['GroupName'],
            'description': g.get('Description', ''),
            'precedence': g.get('Precedence', 0)
        } for g in response.get('Groups', [])]

        return success_response({'groups': groups}, event)

    except ClientError as e:
        logger.error(f"Error listing groups: {e!s}")
        return api_response(500, {'error': 'Failed to list groups'}, event)


def handle_get_users_route(event: dict, context: Any, **kwargs) -> dict:
    """GET /users or GET /users/{username} - dispatch on the path parameter.

    `route_handler`'s `('GET', None)` key is a method-only match, so one entry
    cannot separate the collection route from the parametric item route — the
    username is dynamic, so there is no static segment to match on. Without
    this split the method-only key swallowed every GET and
    `GET /api/users/{username}` returned the entire roster, leaving
    `handle_get_user` unreachable.
    """
    path_params = event.get('pathParameters') or {}

    if path_params.get('username'):
        return handle_get_user(event, context, **kwargs)

    return handle_list_users(event, context, **kwargs)


@api_handler
@cors_preflight
@require_group(ADMIN_GROUP)
@paginate(default_limit=50, max_limit=100)
@route_handler({
    ('GET', '/groups'): handle_list_groups,
    ('GET', '/reset-password'): lambda e, _c, **_k: validation_error('Use POST method', e),
    ('POST', '/reset-password'): handle_reset_password,
    ('GET', None): handle_get_users_route,
    ('POST', None): handle_invite_user,
    ('PUT', None): handle_update_user,
    ('DELETE', None): handle_delete_user,
})
def handler(event: dict, context: Any) -> dict:
    """
    User Management API Lambda Handler

    Every route here is Admin-only, including the reads: `handle_list_users`
    hands back the full roster and `handle_list_groups` enumerates the group
    names an attacker needs for the escalation path in AUDIT-2026-08-19 §0.1.
    So the gate sits on the whole surface rather than per route.

    `@require_group` is below `@cors_preflight` so browser preflight (an
    OPTIONS request, which carries no Authorization header) still answers 200,
    and above `@paginate`/`@route_handler` so an unauthorized request is
    refused before any input is parsed.

    Endpoints:
    - GET /users - List all users
    - GET /users/groups - List available groups
    - GET /users/{username} - Get user details
    - POST /users - Invite new user
    - PUT /users/{username} - Update user (enable/disable, groups)
    - DELETE /users/{username} - Delete user
    - POST /users/{username}/reset-password - Reset user password
    """
    pass  # Routes handle everything
