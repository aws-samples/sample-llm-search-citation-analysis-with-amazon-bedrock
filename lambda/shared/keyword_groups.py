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
from botocore.exceptions import ClientError

from shared.dynamodb_batch import collect_all_items
from shared.dynamodb_conditions import is_conditional_check_failure
from shared.markets import GLOBAL_MARKET_ID, MAX_MARKETS, is_market_filter_id, keyword_market_id
from shared.string_lists import normalize_string_list
from shared.utils import get_timestamp

KEYWORD_GROUPS_TABLE_ENV = 'DYNAMODB_TABLE_KEYWORD_GROUPS'

MAX_GROUP_NAME_LENGTH = 100
MAX_GROUP_DESCRIPTION_LENGTH = 500
# Backward-compatible sentinel for callers predating unbounded memberships.
MAX_GROUPS_PER_KEYWORD = None
MAX_GROUP_ID_LENGTH = 64
MAX_SCOPE_IDS = 1000
#: Every configured market plus the global one.
MAX_SCOPE_MARKET_IDS = MAX_MARKETS + 1

SCOPE_MODES = ('all', 'groups', 'keywords')
_SCOPE_ID_FIELDS = {'groups': 'group_ids', 'keywords': 'keyword_ids'}

# The only status an analysis run will accept. Anything that reports "how many
# keywords would this scope run" has to agree with `resolve_scope`, which
# returns active keywords in every mode, so the value lives here rather than as
# a literal in each caller.
ACTIVE_KEYWORD_STATUS = 'active'


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


def validate_id_list(
    value: Any,
    *,
    field: str,
    limit: int | None = None,
) -> tuple[list[str] | None, str | None]:
    """Validate a request-supplied list of ids: strings, trimmed, deduplicated.

    Returns ``(ids, None)`` or ``(None, error_message)``; an empty list is
    valid and yields ``[]``. ``limit=None`` permits any count that fits the
    surrounding DynamoDB item and request limits.
    """
    if value is None:
        return [], None
    return normalize_string_list(
        value,
        limit=limit,
        normalize=_group_id_entry,
        type_error=f'{field} must be an array of strings',
        limit_error=f'{field} accepts at most {limit} entries',
        entry_error=f'{field} entries must be non-empty ids of at most {MAX_GROUP_ID_LENGTH} characters',
    )


def _group_id_entry(entry: str) -> str | None:
    """``entry`` trimmed, or ``None`` when that leaves nothing or more than ``MAX_GROUP_ID_LENGTH`` characters."""
    candidate = entry.strip()
    return candidate if candidate and len(candidate) <= MAX_GROUP_ID_LENGTH else None


def _validate_market_ids(value: Any) -> tuple[list[str] | None, str | None]:
    """The optional ``scope.market_ids`` filter: ``(None, None)`` when absent, else the deduplicated ids."""
    if value is None:
        return None, None
    if not isinstance(value, list) or not value:
        return None, 'scope.market_ids must be a non-empty array of market ids'
    if len(value) > MAX_SCOPE_MARKET_IDS:
        return None, f'scope.market_ids accepts at most {MAX_SCOPE_MARKET_IDS} entries'
    ids: list[str] = []
    for entry in value:
        if not is_market_filter_id(entry):
            return None, f"scope.market_ids entries must be market ids or '{GLOBAL_MARKET_ID}'"
        if entry not in ids:
            ids.append(entry)
    return ids, None


def validate_scope(value: Any) -> tuple[dict[str, Any] | None, str | None]:
    """Validate a scope descriptor.

    Shapes::

        {"mode": "all"}
        {"mode": "groups", "group_ids": ["..."]}
        {"mode": "keywords", "keyword_ids": ["..."]}

    Every mode takes an optional ``"market_ids": ["cl-es", "global", ...]``
    that keeps only the keywords of those markets (``'global'`` is the
    keywords without one); absent means every market.
    """
    if not isinstance(value, dict):
        return None, 'scope must be an object'
    mode = value.get('mode')
    if mode not in SCOPE_MODES:
        return None, f"scope.mode must be one of {', '.join(SCOPE_MODES)}"
    market_ids, market_error = _validate_market_ids(value.get('market_ids'))
    if market_error:
        return None, market_error
    markets = {} if market_ids is None else {'market_ids': market_ids}
    if mode == 'all':
        return {'mode': 'all', **markets}, None

    field = _SCOPE_ID_FIELDS[mode]
    ids, error = validate_id_list(value.get(field), field=f'scope.{field}', limit=MAX_SCOPE_IDS)
    if error:
        return None, error
    if not ids:
        return None, f'scope.{field} must contain at least one id'
    return {'mode': mode, field: ids, **markets}, None


def load_existing_group_ids(groups_table: Any, group_ids: list[str]) -> set[str]:
    """Return the subset of ``group_ids`` that exist in the groups table."""
    existing: set[str] = set()
    for group_id in group_ids:
        if groups_table.get_item(Key={'id': group_id}).get('Item'):
            existing.add(group_id)
    return existing


def query_active_keywords(keywords_table: Any) -> list[dict[str, Any]]:
    """Return every active keyword item, following StatusIndex pagination."""
    return collect_all_items(
        keywords_table.query,
        IndexName='StatusIndex',
        KeyConditionExpression=Key('status').eq(ACTIVE_KEYWORD_STATUS),
    )


def keyword_group_ids(item: dict[str, Any]) -> set[str]:
    raw = item.get('group_ids')
    if isinstance(raw, set | frozenset | list | tuple):
        return {str(value) for value in raw}
    return set()


def add_keyword_groups(
    keywords_table: Any,
    keyword_id: str,
    group_ids: set[str],
) -> tuple[dict[str, Any] | None, set[str]]:
    """Atomically union groups into one keyword and report newly added ids.

    ``ADD`` preserves every existing membership and is idempotent when all
    requested memberships are already present. The prior item is returned by
    DynamoDB so callers can distinguish an actual membership change without a
    read-before-write race. A missing keyword returns ``(None, set())``.
    """
    try:
        response = keywords_table.update_item(
            Key={'id': keyword_id},
            UpdateExpression='ADD group_ids :gids',
            ConditionExpression='attribute_exists(#id)',
            ExpressionAttributeNames={'#id': 'id'},
            ExpressionAttributeValues={':gids': group_ids},
            ReturnValues='ALL_OLD',
        )
    except ClientError as error:
        if not is_conditional_check_failure(error):
            raise
        return None, set()

    previous = response['Attributes']
    previous_group_ids = keyword_group_ids(previous)
    updated = dict(previous)
    updated['group_ids'] = previous_group_ids | group_ids
    return updated, group_ids - previous_group_ids


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
        selected = [item for item in active if keyword_group_ids(item) & wanted]
    elif mode == 'keywords':
        wanted = set(scope.get('keyword_ids', []))
        selected = [item for item in active if item.get('id') in wanted]
    else:
        selected = active
    market_ids = scope.get('market_ids')
    if market_ids is not None:
        markets = set(market_ids)
        selected = [item for item in selected if keyword_market_id(item) in markets]

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
    return _describe_keywords(scope) + _describe_markets(scope.get('market_ids'))


def _describe_keywords(scope: dict[str, Any]) -> str:
    mode = scope.get('mode')
    if mode == 'groups':
        return f"{len(scope.get('group_ids', []))} group(s)"
    if mode == 'keywords':
        return f"{len(scope.get('keyword_ids', []))} selected keyword(s)"
    return 'all active keywords'


def _describe_markets(market_ids: Any) -> str:
    if not isinstance(market_ids, list) or not market_ids:
        return ''
    if len(market_ids) == 1:
        return f', market {market_ids[0]}'
    return f', {len(market_ids)} markets'
