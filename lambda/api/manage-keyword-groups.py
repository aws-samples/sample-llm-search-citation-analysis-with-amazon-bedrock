"""
Keyword Groups API Lambda

Groups are the customer's "folders" (typically one per hotel). A keyword may
belong to any number of groups; membership is the ``group_ids`` string set on
the Keywords-table item, so this module writes both tables.

Routes (all under the consolidated KeywordMgmt function):
    GET    /api/keyword-groups                 list groups with member counts
    POST   /api/keyword-groups                 create a group
    PUT    /api/keyword-groups/{id}            rename / describe a group
    DELETE /api/keyword-groups/{id}            delete a group and detach its keywords
    PUT    /api/keyword-groups/{id}/keywords   add/remove keyword memberships in bulk

Like the keyword routes themselves, these are open to every authenticated
user: organising keywords is content-team work, not an admin action.
"""

import logging
import sys
import uuid
from collections.abc import Callable
from functools import wraps
from typing import Any

import boto3
from botocore.exceptions import ClientError

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import api_response, not_found_response, success_response, validation_error
from shared.api_views import named_item_view
from shared.decorators import api_handler, parse_json_body, route_handler, validate
from shared.dynamodb_batch import collect_all_items
from shared.env_vars import resolve_table_env
from shared.keyword_groups import (
    KEYWORD_GROUPS_TABLE_ENV,
    MAX_GROUP_DESCRIPTION_LENGTH,
    MAX_GROUP_NAME_LENGTH,
    add_keyword_groups,
    build_group_item,
    normalize_group_name,
    serialize_keyword_item,
    validate_id_list,
)
from shared.utils import get_timestamp

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

KEYWORDS_TABLE = resolve_table_env('DYNAMODB_TABLE_KEYWORDS', 'KEYWORDS_TABLE')
GROUPS_TABLE = resolve_table_env(KEYWORD_GROUPS_TABLE_ENV)
keywords_table = dynamodb.Table(KEYWORDS_TABLE)
groups_table = dynamodb.Table(GROUPS_TABLE)

# Bulk membership edits are bounded so one request stays inside the API budget.
MAX_MEMBERSHIP_CHANGES = 500

_Route = Callable[..., dict[str, Any]]


class _InvalidGroupName(ValueError):
    """A group name the route answers with a 400 on the ``name`` field."""


def _member_counts() -> dict[str, int]:
    """Count keyword memberships per group id from the Keywords table."""
    counts: dict[str, int] = {}
    for item in collect_all_items(keywords_table.scan, ProjectionExpression='group_ids'):
        for group_id in item.get('group_ids') or ():
            counts[group_id] = counts.get(group_id, 0) + 1
    return counts


def _serialize_group(item: dict[str, Any], keyword_count: int) -> dict[str, Any]:
    return {
        **named_item_view(item),
        'keyword_count': keyword_count,
        'created_at': item.get('created_at', ''),
        'updated_at': item.get('updated_at', ''),
    }


def _name_taken(name: str, *, exclude_id: str | None = None) -> bool:
    """Case-insensitive uniqueness check across the (small) groups table."""
    name_key = normalize_group_name(name)
    for item in collect_all_items(groups_table.scan, ProjectionExpression='id, name_key'):
        if item.get('name_key') == name_key and item.get('id') != exclude_id:
            return True
    return False


def _group_name(name: Any) -> str:
    """The whitespace-collapsed group name, or ``_InvalidGroupName`` when it cannot be stored."""
    if not isinstance(name, str):
        raise _InvalidGroupName('name must be a string')
    text = ' '.join(name.split())
    if not text:
        raise _InvalidGroupName('name must not be empty')
    if len(text) > MAX_GROUP_NAME_LENGTH:
        raise _InvalidGroupName(f'name exceeds maximum length of {MAX_GROUP_NAME_LENGTH} characters')
    return text


def _duplicate_name_response(event: dict[str, Any]) -> dict[str, Any]:
    return api_response(409, {'error': 'A keyword group with this name already exists'}, event)


def _for_existing_group(route: _Route) -> _Route:
    """Answer 400/404 before ``route`` runs unless the ``{id}`` path parameter names a stored group."""
    @wraps(route)
    def wrapper(event: dict[str, Any], context: Any, *args: Any, **kwargs: Any) -> dict[str, Any]:
        group_id = kwargs.get('id')
        if not group_id:
            return validation_error('Group ID is required', event, 'id')
        if not groups_table.get_item(Key={'id': group_id}).get('Item'):
            return not_found_response(resource='Keyword group', event=event)
        return route(event, context, *args, **kwargs)
    return wrapper


def list_groups(event: dict[str, Any], context: Any, **_: Any) -> dict[str, Any]:
    """GET /api/keyword-groups"""
    counts = _member_counts()
    groups = [
        _serialize_group(item, counts.get(item['id'], 0))
        for item in collect_all_items(groups_table.scan)
        if item.get('id')
    ]
    groups.sort(key=lambda group: group['name'].casefold())
    return success_response({'groups': groups, 'count': len(groups)}, event)


@parse_json_body
@validate({
    'name': {'required': True, 'source': 'body'},
    'description': {'type': str, 'max_length': MAX_GROUP_DESCRIPTION_LENGTH, 'default': '', 'source': 'body'},
})
def create_group(event: dict[str, Any], context: Any, body: dict, name: Any, description: str, **_: Any) -> dict[str, Any]:
    """POST /api/keyword-groups"""
    try:
        text = _group_name(name)
    except _InvalidGroupName as exc:
        return validation_error(str(exc), event, 'name')
    if _name_taken(text):
        return _duplicate_name_response(event)

    item = build_group_item(str(uuid.uuid4()), text, description)
    groups_table.put_item(Item=item)
    return success_response(_serialize_group(item, 0), event, 201)


@parse_json_body
@validate({
    'name': {'source': 'body'},
    'description': {'type': str, 'max_length': MAX_GROUP_DESCRIPTION_LENGTH, 'source': 'body'},
})
@_for_existing_group
def update_group(event: dict[str, Any], context: Any, body: dict, name: Any, description: str | None, id: str, **_: Any) -> dict[str, Any]:
    """PUT /api/keyword-groups/{id}"""
    if name is None and description is None:
        return validation_error('Provide a name or a description to update', event)

    updates: dict[str, Any] = {'updated_at': get_timestamp()}
    if name is not None:
        try:
            text = _group_name(name)
        except _InvalidGroupName as exc:
            return validation_error(str(exc), event, 'name')
        if _name_taken(text, exclude_id=id):
            return _duplicate_name_response(event)
        updates['name'] = text
        updates['name_key'] = normalize_group_name(text)
    if description is not None:
        updates['description'] = description

    names = {f'#f{index}': field for index, field in enumerate(updates)}
    values = {f':v{index}': updates[field] for index, field in enumerate(updates)}
    expression = 'SET ' + ', '.join(f'{alias} = :v{alias[2:]}' for alias in names)
    response = groups_table.update_item(
        Key={'id': id},
        UpdateExpression=expression,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
        ReturnValues='ALL_NEW',
    )
    counts = _member_counts()
    return success_response(_serialize_group(response['Attributes'], counts.get(id, 0)), event)


@_for_existing_group
def delete_group(event: dict[str, Any], context: Any, id: str, **_: Any) -> dict[str, Any]:
    """DELETE /api/keyword-groups/{id} — also detaches the group from every keyword."""
    members = collect_all_items(
        keywords_table.scan,
        ProjectionExpression='id',
        FilterExpression='contains(group_ids, :gid)',
        ExpressionAttributeValues={':gid': id},
    )
    for member in members:
        keywords_table.update_item(
            Key={'id': member['id']},
            UpdateExpression='DELETE group_ids :gids',
            ExpressionAttributeValues={':gids': {id}},
        )
    groups_table.delete_item(Key={'id': id})
    return success_response({'message': 'Keyword group deleted', 'detached_keywords': len(members)}, event)


def _apply_membership(keyword_id: str, group_id: str, *, add: bool) -> dict[str, Any] | None:
    """Add or remove one membership; return the updated item or None when the keyword is missing."""
    if add:
        updated, _new_group_ids = add_keyword_groups(keywords_table, keyword_id, {group_id})
        return updated

    try:
        return keywords_table.update_item(
            Key={'id': keyword_id},
            UpdateExpression='DELETE group_ids :gids',
            ConditionExpression='attribute_exists(#id)',
            ExpressionAttributeNames={'#id': 'id'},
            ExpressionAttributeValues={':gids': {group_id}},
            ReturnValues='ALL_NEW',
        )['Attributes']
    except ClientError as error:
        if error.response.get('Error', {}).get('Code') != 'ConditionalCheckFailedException':
            raise
        return None


@parse_json_body
@_for_existing_group
def update_memberships(event: dict[str, Any], context: Any, body: dict, id: str, **_: Any) -> dict[str, Any]:
    """PUT /api/keyword-groups/{id}/keywords — body {"add": [keyword_id], "remove": [keyword_id]}"""
    add_ids, error = validate_id_list(body.get('add'), field='add', limit=MAX_MEMBERSHIP_CHANGES)
    if add_ids is None:
        # validate_id_list returns exactly one of (ids, None) / (None, error).
        return validation_error(str(error), event, 'add')
    remove_ids, error = validate_id_list(body.get('remove'), field='remove', limit=MAX_MEMBERSHIP_CHANGES)
    if remove_ids is None:
        return validation_error(str(error), event, 'remove')
    if not add_ids and not remove_ids:
        return validation_error('Provide keyword ids to add or remove', event)

    added: list[str] = []
    removed: list[str] = []
    missing: list[str] = []
    updated: dict[str, dict[str, Any]] = {}
    for keyword_id in add_ids:
        item = _apply_membership(keyword_id, id, add=True)
        (added if item else missing).append(keyword_id)
        if item:
            updated[keyword_id] = item
    for keyword_id in remove_ids:
        item = _apply_membership(keyword_id, id, add=False)
        (removed if item else missing).append(keyword_id)
        if item:
            updated[keyword_id] = item

    return success_response({
        'group_id': id,
        'added': added,
        'removed': removed,
        'missing': missing,
        'keywords': [serialize_keyword_item(item) for item in updated.values()],
    }, event)


@api_handler
@route_handler({
    ('PUT', '/keywords'): update_memberships,
    'GET': list_groups,
    'POST': create_group,
    'PUT': update_group,
    'DELETE': delete_group,
}, inject_path_params=True)
def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Routed entirely by ``route_handler``; see module docstring. This body is never reached."""
    ...
