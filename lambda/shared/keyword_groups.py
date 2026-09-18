"""
Keyword groups: validation, membership serialization and scope resolution.

A keyword group (the customer's "folder", typically one per hotel) is a row in
``CitationAnalysis-KeywordGroups``; membership lives on each Keywords-table
item as the string set ``group_ids`` so a keyword can belong to any number of
groups without a join table. Everything that turns a *scope* — all active
keywords, one or more groups, or an explicit list of keyword ids — into the
concrete keyword list of an analysis run goes through :func:`resolve_scope`,
so the trigger endpoints, ParseKeywords (schedules) and the report endpoints
agree on what "run group X" means: active keywords only, deduplicated,
deterministic order.
"""

from __future__ import annotations

from typing import Any

from boto3.dynamodb.conditions import Key

from shared.utils import get_timestamp

KEYWORD_GROUPS_TABLE_ENV = 'DYNAMODB_TABLE_KEYWORD_GROUPS'

MAX_GROUP_NAME_LENGTH = 100
MAX_GROUP_DESCRIPTION_LENGTH = 500
MAX_GROUPS_PER_KEYWORD = 50
MAX_GROUP_ID_LENGTH = 64
MAX_SCOPE_IDS = 1000

SCOPE_MODES = ('all', 'groups', 'keywords')
_SCOPE_ID_FIELDS = {'groups': 'group_ids', 'keywords': 'keyword_ids'}


def normalize_group_name(name: str) -> str:
    """Case-insensitive, whitespace-collapsed identity used for uniqueness."""
    return ' '.join(name.split()).casefold()


def build_group_item(group_id: str, name: str, description: str, *, timestamp: str | None = None) -> dict[str, Any]:
    """Canonical KeywordGroups-table item."""
    stamp = timestamp or get_timestamp()
    return {
        'id': group_id,
        'name': name,
        'name_key': normalize_group_name(name),
        'description': description,
        'created_at': stamp,
        'updated_at': stamp,
    }


def serialize_keyword_item(item: dict[str, Any]) -> dict[str, Any]:
    """Return a JSON-safe copy of a Keywords-table item.

    DynamoDB string sets come back as Python ``set`` objects, which the API
    encoder cannot serialize; expose ``group_ids`` as a sorted list. Items
    without memberships keep no ``group_ids`` key, matching what is stored.
    """
    serialized = dict(item)
    raw = serialized.get('group_ids')
    if isinstance(raw, set | frozenset | list | tuple):
        serialized['group_ids'] = sorted(str(value) for value in raw)
    elif 'group_ids' in serialized:
        del serialized['group_ids']
    return serialized


def validate_id_list(value: Any, *, field: str, limit: int) -> tuple[list[str] | None, str | None]:
    """Validate a request-supplied list of ids: strings, trimmed, deduplicated.

    Returns ``(ids, None)`` or ``(None, error_message)``; an empty list is
    valid and yields ``[]``.
    """
    if value is None:
        return [], None
    if not isinstance(value, list):
        return None, f'{field} must be an array of strings'
    if len(value) > limit:
        return None, f'{field} accepts at most {limit} entries'

    ids: list[str] = []
    seen: set[str] = set()
    for entry in value:
        if not isinstance(entry, str):
            return None, f'{field} must be an array of strings'
        candidate = entry.strip()
        if not candidate or len(candidate) > MAX_GROUP_ID_LENGTH:
            return None, f'{field} entries must be non-empty ids of at most {MAX_GROUP_ID_LENGTH} characters'
        if candidate not in seen:
            seen.add(candidate)
            ids.append(candidate)
    return ids, None


def validate_scope(value: Any) -> tuple[dict[str, Any] | None, str | None]:
    """Validate a scope descriptor.

    Shapes::

        {"mode": "all"}
        {"mode": "groups", "group_ids": ["..."]}
        {"mode": "keywords", "keyword_ids": ["..."]}
    """
    if not isinstance(value, dict):
        return None, 'scope must be an object'
    mode = value.get('mode')
    if mode not in SCOPE_MODES:
        return None, f"scope.mode must be one of {', '.join(SCOPE_MODES)}"
    if mode == 'all':
        return {'mode': 'all'}, None

    field = _SCOPE_ID_FIELDS[mode]
    ids, error = validate_id_list(value.get(field), field=f'scope.{field}', limit=MAX_SCOPE_IDS)
    if error:
        return None, error
    if not ids:
        return None, f'scope.{field} must contain at least one id'
    return {'mode': mode, field: ids}, None


def load_existing_group_ids(groups_table: Any, group_ids: list[str]) -> set[str]:
    """Return the subset of ``group_ids`` that exist in the groups table."""
    existing: set[str] = set()
    for group_id in group_ids:
        if groups_table.get_item(Key={'id': group_id}).get('Item'):
            existing.add(group_id)
    return existing


def query_active_keywords(keywords_table: Any) -> list[dict[str, Any]]:
    """Return every active keyword item, following StatusIndex pagination."""
    params: dict[str, Any] = {
        'IndexName': 'StatusIndex',
        'KeyConditionExpression': Key('status').eq('active'),
    }
    items: list[dict[str, Any]] = []
    while True:
        response = keywords_table.query(**params)
        items.extend(response.get('Items', []))
        last_key = response.get('LastEvaluatedKey')
        if not last_key:
            return items
        params['ExclusiveStartKey'] = last_key


def _group_ids_of(item: dict[str, Any]) -> set[str]:
    raw = item.get('group_ids')
    if isinstance(raw, set | frozenset | list | tuple):
        return {str(value) for value in raw}
    return set()


def resolve_scope(scope: dict[str, Any], keywords_table: Any) -> list[dict[str, Any]]:
    """Resolve a validated scope to active keyword items.

    Only active keywords are ever returned, regardless of mode, so a paused
    keyword inside a group is skipped exactly as it is for "all". The result
    is deduplicated by id and sorted by keyword text so two runs over the
    same scope produce the same order.
    """
    active = query_active_keywords(keywords_table)
    mode = scope.get('mode')

    if mode == 'groups':
        wanted = set(scope.get('group_ids', []))
        selected = [item for item in active if _group_ids_of(item) & wanted]
    elif mode == 'keywords':
        wanted = set(scope.get('keyword_ids', []))
        selected = [item for item in active if item.get('id') in wanted]
    else:
        selected = active

    by_id: dict[str, dict[str, Any]] = {}
    for item in selected:
        keyword = item.get('keyword')
        if not isinstance(keyword, str) or not keyword:
            continue
        key = str(item.get('id') or keyword)
        by_id.setdefault(key, item)
    return sorted(by_id.values(), key=lambda item: item['keyword'].casefold())


def describe_scope(scope: dict[str, Any]) -> str:
    """Short human-readable label for logs and API messages."""
    mode = scope.get('mode')
    if mode == 'groups':
        return f"{len(scope.get('group_ids', []))} group(s)"
    if mode == 'keywords':
        return f"{len(scope.get('keyword_ids', []))} selected keyword(s)"
    return 'all active keywords'
