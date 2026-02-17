"""
User Management API
Manages Cognito users: list, invite, update, enable/disable, reset password
"""

import json
import os
import logging
import sys
import boto3
from botocore.exceptions import ClientError
from datetime import datetime
from typing import Any

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.decorators import api_handler, parse_json_body, route_handler, cors_preflight, paginate
from shared.api_response import (
    success_response, validation_error, 
    not_found_response, api_response
)

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


def handle_list_users(event: dict, context: Any, limit: int, offset: int, **kwargs) -> dict:
    """GET /users - List all Cognito users with pagination."""
    try:
        users = []
        pagination_token = None
        
        # Cognito uses token-based pagination, we need to fetch all and slice
        while True:
            params = {
                'UserPoolId': USER_POOL_ID,
                'Limit': 60  # Max allowed by Cognito
            }
            if pagination_token:
                params['PaginationToken'] = pagination_token
            
            response = cognito_client.list_users(**params)
            users.extend([format_user(u) for u in response.get('Users', [])])
            
            pagination_token = response.get('PaginationToken')
            if not pagination_token:
                break
        
        # Get groups for each user
        for user in users:
            try:
                groups_response = cognito_client.admin_list_groups_for_user(
                    Username=user['username'],
                    UserPoolId=USER_POOL_ID
                )
                user['groups'] = [g['GroupName'] for g in groups_response.get('Groups', [])]
            except ClientError:
                user['groups'] = []
        
        # Apply offset/limit pagination
        total = len(users)
        paginated = users[offset:offset + limit]
        
        return success_response({
            'users': paginated,
            'total': total,
            'limit': limit,
            'offset': offset,
            'has_more': offset + limit < total
        }, event)
        
    except ClientError as e:
        logger.error(f"Error listing users: {str(e)}")
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
        logger.error(f"Error getting user: {str(e)}")
        return api_response(500, {'error': 'Failed to get user'}, event)


@parse_json_body
def handle_invite_user(event: dict, context: Any, body: dict = None, **kwargs) -> dict:
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
                logger.warning(f"Failed to add user to group {group}: {str(e)}")
        
        user['groups'] = groups
        
        return success_response({
            'user': user,
            'message': 'User invited successfully. They will receive an email with login instructions.'
        }, event)
        
    except cognito_client.exceptions.UsernameExistsException:
        return api_response(409, {'error': 'User with this email already exists'}, event)
    except ClientError as e:
        logger.error(f"Error inviting user: {str(e)}")
        return api_response(500, {'error': 'Failed to invite user'}, event)


@parse_json_body
def handle_update_user(event: dict, context: Any, body: dict = None, **kwargs) -> dict:
    """PUT /users/{username} - Update user (enable/disable, groups)."""
    path_params = event.get('pathParameters') or {}
    username = path_params.get('username')
    
    if not username:
        return validation_error('Username required', event)
    
    body = body or {}
    
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
        logger.error(f"Error updating user: {str(e)}")
        return api_response(500, {'error': 'Failed to update user'}, event)


def handle_delete_user(event: dict, context: Any, **kwargs) -> dict:
    """DELETE /users/{username} - Delete a user."""
    path_params = event.get('pathParameters') or {}
    username = path_params.get('username')
    
    if not username:
        return validation_error('Username required', event)
    
    try:
        cognito_client.admin_delete_user(
            UserPoolId=USER_POOL_ID,
            Username=username
        )
        
        return success_response({'message': f'User {username} deleted successfully'}, event)
        
    except cognito_client.exceptions.UserNotFoundException:
        return not_found_response(f'User {username}', event)
    except ClientError as e:
        logger.error(f"Error deleting user: {str(e)}")
        return api_response(500, {'error': 'Failed to delete user'}, event)


@parse_json_body
def handle_reset_password(event: dict, context: Any, body: dict = None, **kwargs) -> dict:
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
        return api_response(400, {'error': str(e)}, event)
    except ClientError as e:
        logger.error(f"Error resetting password: {str(e)}")
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
        logger.error(f"Error listing groups: {str(e)}")
        return api_response(500, {'error': 'Failed to list groups'}, event)


@api_handler
@cors_preflight
@paginate(default_limit=50, max_limit=100)
@route_handler({
    ('GET', '/groups'): handle_list_groups,
    ('GET', '/reset-password'): lambda e, c, **k: validation_error('Use POST method', e),
    ('POST', '/reset-password'): handle_reset_password,
    ('GET', None): handle_list_users,
    ('POST', None): handle_invite_user,
    ('PUT', None): handle_update_user,
    ('DELETE', None): handle_delete_user,
})
def handler(event: dict, context: Any) -> dict:
    """
    User Management API Lambda Handler
    
    Endpoints:
    - GET /users - List all users
    - GET /users/groups - List available groups
    - GET /users/{username} - Get user details
    - POST /users - Invite new user
    - PUT /users/{username} - Update user (enable/disable, groups)
    - DELETE /users/{username} - Delete user
    - POST /users/{username}/reset-password - Reset user password
    """
    # Check if this is a single user request
    path_params = event.get('pathParameters') or {}
    if path_params.get('username'):
        method = event.get('httpMethod', 'GET').upper()
        path = event.get('path', '')
        
        if 'reset-password' in path:
            return handle_reset_password(event, context)
        elif method == 'GET':
            return handle_get_user(event, context)
        elif method == 'PUT':
            return handle_update_user(event, context)
        elif method == 'DELETE':
            return handle_delete_user(event, context)
    
    # Route handler will handle the rest
    pass
