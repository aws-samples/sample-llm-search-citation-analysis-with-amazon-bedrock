"""Promote keyword-research results into the active Keywords table."""

import logging
import sys

import boto3

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import error_response, success_response, validation_error

# Redundant-alias form: re-exported for this module's property tests, which
# derive their over-length fixtures from `promotion_handler.MAX_KEYWORD_LENGTH`.
from shared.constants import MAX_KEYWORD_LENGTH as MAX_KEYWORD_LENGTH
from shared.decorators import api_handler, parse_json_body, route_handler
from shared.env_vars import resolve_table_env
from shared.keyword_groups import (
    KEYWORD_GROUPS_TABLE_ENV,
    add_keyword_groups,
    load_existing_group_ids,
    serialize_keyword_item,
    validate_id_list,
)
from shared.keyword_store import (
    ALLOWED_KEYWORD_PRIORITIES,
    ALLOWED_KEYWORD_STATUSES,
    DEFAULT_KEYWORD_PRIORITY,
    DEFAULT_KEYWORD_STATUS,
    build_keyword_item,
    put_keyword_if_absent,
    validate_keyword_text,
)
from shared.utils import (
    get_timestamp,
    load_keyword_identities,
    normalize_keyword,
    trim_keyword,
)

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

KEYWORDS_TABLE = resolve_table_env('DYNAMODB_TABLE_KEYWORDS', 'KEYWORDS_TABLE')
keywords_table = dynamodb.Table(KEYWORDS_TABLE)
# Optional until every deployment carries the groups table.
GROUPS_TABLE = resolve_table_env(KEYWORD_GROUPS_TABLE_ENV, required=False)
groups_table = dynamodb.Table(GROUPS_TABLE) if GROUPS_TABLE else None

NOTES_FIELDS = ('intent', 'competition', 'source')
MAX_KEYWORDS = 500
MAX_NOTES_LENGTH = 1000
# Longest slice of a rejected input value echoed back in a 400 message
# (bugs.md 2.4) — long enough to identify the value, bounded so the response
# can't reflect arbitrarily large request bodies.
MAX_ECHOED_VALUE_LENGTH = 50

# Enum values and defaults come from the shared keyword store (bugs.md 3.3);
# the local names remain this module's public vocabulary and are referenced
# by its property tests. Region/language/category defaults are applied by
# `build_keyword_item` and are not re-exported here.
ALLOWED_STATUSES = ALLOWED_KEYWORD_STATUSES
ALLOWED_PRIORITIES = ALLOWED_KEYWORD_PRIORITIES
DEFAULT_STATUS = DEFAULT_KEYWORD_STATUS
DEFAULT_PRIORITY = DEFAULT_KEYWORD_PRIORITY

REASON_DUPLICATE = 'duplicate'
REASON_EMPTY = 'empty'


@parse_json_body
def _promote_keywords(event, context, body):
    """Promote validated research keywords into the Keywords table."""
    if not isinstance(body, dict):
        return validation_error('Request body must be a JSON object', event, 'body')

    keywords = body.get('keywords')
    error, status, priority = validate_request(
        keywords, body.get('status'), body.get('priority')
    )
    if error:
        return validation_error(error['message'], event, error['field'])

    group_ids, group_error = _validated_group_ids(body)
    if group_error:
        return validation_error(group_error['message'], event, group_error['field'])

    try:
        if group_ids:
            existing_items = load_keyword_items_by_identity(keywords_table)
            existing_keys = set(existing_items)
        else:
            existing_items = {}
            existing_keys = load_keyword_identities(keywords_table)
    except Exception as error:
        logger.error(
            f'Failed to read existing keywords for promotion: {error!s}',
            exc_info=True,
        )
        return error_response(error, event)

    to_create, skipped = partition_keywords(keywords, existing_keys)
    items = create_items(to_create, status, priority)
    grouped_keywords = []
    if group_ids:
        requested_group_ids = set(group_ids)
        for item in items:
            item['group_ids'] = requested_group_ids
        grouped_keywords.extend(
            group_existing_keywords(
                keywords_table,
                existing_items,
                skipped,
                requested_group_ids,
            )
        )
        created_items, concurrent_skips, concurrently_grouped = write_grouped_items(
            keywords_table,
            items,
            requested_group_ids,
        )
        grouped_keywords.extend(concurrently_grouped)
    else:
        created_items, concurrent_skips = write_items(keywords_table, items)
    skipped.extend(concurrent_skips)

    return success_response({
        'created': len(created_items),
        'skipped': sum(
            1 for entry in skipped if entry['reason'] == REASON_DUPLICATE
        ),
        'created_keywords': [serialize_keyword_item(item) for item in created_items],
        'skipped_keywords': skipped,
        'grouped_keywords': grouped_keywords,
    }, event)


def _validated_group_ids(body):
    """Validate the optional ``group_ids`` list (target groups for every keyword)."""
    if 'group_ids' not in body:
        return None, None
    group_ids, message = validate_id_list(body.get('group_ids'), field='group_ids')
    if message:
        return None, {'message': message, 'field': 'group_ids'}
    if group_ids and groups_table is None:
        return None, {'message': 'Keyword groups are not available on this deployment', 'field': 'group_ids'}
    if group_ids:
        unknown = sorted(set(group_ids) - load_existing_group_ids(groups_table, group_ids))
        if unknown:
            return None, {'message': f"Unknown keyword group ids: {', '.join(unknown)}", 'field': 'group_ids'}
    return group_ids, None


@api_handler
@route_handler({'POST': _promote_keywords})
def handler(event, context):
    """Handle POST /api/keywords/promote."""


def build_notes(research_keyword):
    """Build bounded notes from validated research context fields."""
    parts = []
    for field in NOTES_FIELDS:
        value = research_keyword.get(field)
        if not isinstance(value, str):
            continue
        trimmed = value.strip()
        if trimmed:
            parts.append(f'{field}: {trimmed}')

    return '; '.join(parts)


def _entry_status_error(index, research_keyword):
    """Field-specific rejection for an invalid per-keyword status override, else ``None``."""
    if 'status' not in research_keyword:
        return None
    status = research_keyword['status']
    field = f'keywords[{index}].status'
    if not isinstance(status, str):
        return _rejection('status must be a string', field)
    if status not in ALLOWED_STATUSES:
        return _rejection(
            f"Invalid status '{_echoed(status)}' (allowed: {', '.join(ALLOWED_STATUSES)})",
            field,
        )
    return None


def _validate_keyword_entry(index, research_keyword):
    """Validate one promotion entry; ``(text, None)`` or ``(None, rejection)``.

    A missing ``keyword`` is a skip (reported by ``partition_keywords``), not a
    rejection — batch semantics — so it yields ``''``. An empty-after-trim text
    is likewise skipped rather than rejected as manage-keywords does (bugs.md 3.3).
    An entry may carry its own ``status`` override, checked before the text.
    """
    field_prefix = f'keywords[{index}]'
    if not isinstance(research_keyword, dict):
        return None, _rejection('Each keyword must be a JSON object', field_prefix)

    entry_status_error = _entry_status_error(index, research_keyword)
    if entry_status_error is not None:
        return None, entry_status_error

    keyword_value = research_keyword.get('keyword')
    text = ''
    if keyword_value is not None:
        text, message = validate_keyword_text(keyword_value, empty_ok=True)
        if message:
            return None, _rejection(message, f'{field_prefix}.keyword')

    for notes_field in NOTES_FIELDS:
        notes_value = research_keyword.get(notes_field)
        if notes_value is not None and not isinstance(notes_value, str):
            return None, _rejection(f'{notes_field} must be a string', f'{field_prefix}.{notes_field}')

    if len(build_notes(research_keyword)) > MAX_NOTES_LENGTH:
        return None, _rejection(
            f'Keyword notes exceed maximum length of {MAX_NOTES_LENGTH} characters',
            field_prefix,
        )
    return text, None


def _resolve_status_and_priority(status, priority):
    """Apply the defaults and allowed-value checks; ``(None, status, priority)`` or a rejection."""
    if status is not None and not isinstance(status, str):
        return _rejection('status must be a string', 'status')
    if priority is not None and not isinstance(priority, str):
        return _rejection('priority must be a string', 'priority')

    resolved_status = DEFAULT_STATUS if status is None or status == '' else status
    resolved_priority = DEFAULT_PRIORITY if priority is None or priority == '' else priority

    invalid = []
    if resolved_status not in ALLOWED_STATUSES:
        invalid.append(('status', resolved_status, ALLOWED_STATUSES))
    if resolved_priority not in ALLOWED_PRIORITIES:
        invalid.append(('priority', resolved_priority, ALLOWED_PRIORITIES))

    if invalid:
        message = '; '.join(
            f"Invalid {field} '{_echoed(value)}' (allowed: {', '.join(allowed)})"
            for field, value, allowed in invalid
        )
        return _rejection(
            message,
            ', '.join(field for field, _value, _allowed in invalid),
        )

    return None, resolved_status, resolved_priority


def validate_request(keywords, status, priority):
    """Validate the complete promotion request before any DynamoDB access."""
    if not isinstance(keywords, list) or not keywords:
        return _rejection('At least one keyword is required', 'keywords')

    if len(keywords) > MAX_KEYWORDS:
        return _rejection(f'Maximum {MAX_KEYWORDS} keywords per request', 'keywords')

    texts = []
    for index, research_keyword in enumerate(keywords):
        text, rejection = _validate_keyword_entry(index, research_keyword)
        if rejection is not None:
            return rejection
        texts.append(text)

    if not any(texts):
        return _rejection('At least one non-empty keyword is required', 'keywords')

    return _resolve_status_and_priority(status, priority)


def load_keyword_items_by_identity(table):
    """Load stored keyword items by normalized identity, preserving legacy ids."""
    items_by_identity = {}
    scan_params = {
        'ProjectionExpression': '#id, #kw',
        'ExpressionAttributeNames': {'#id': 'id', '#kw': 'keyword'},
        'ConsistentRead': True,
    }

    while True:
        response = table.scan(**scan_params)
        for item in response.get('Items', []):
            stored_id = item.get('id')
            stored_keyword = item.get('keyword')
            if not isinstance(stored_id, str) or not isinstance(stored_keyword, str):
                continue
            identity = normalize_keyword(stored_keyword)
            if identity:
                items_by_identity.setdefault(identity, item)

        last_key = response.get('LastEvaluatedKey')
        if not last_key:
            return items_by_identity
        scan_params['ExclusiveStartKey'] = last_key


def partition_keywords(keywords, existing_keys):
    """Split validated keywords into creations and reported skips."""
    to_create = []
    skipped = []
    accepted_keys = set()

    for research_keyword in keywords:
        keyword_value = research_keyword.get('keyword')
        text = trim_keyword(keyword_value) if isinstance(keyword_value, str) else ''

        if not text:
            skipped.append({'keyword': text, 'reason': REASON_EMPTY})
            continue

        key = normalize_keyword(text)
        if not key:
            skipped.append({'keyword': '', 'reason': REASON_EMPTY})
            continue
        if key in existing_keys:
            skipped.append({'keyword': text, 'reason': REASON_DUPLICATE})
            continue

        if key in accepted_keys:
            continue

        accepted_keys.add(key)
        to_create.append({**research_keyword, 'keyword': text})

    return to_create, skipped


def group_existing_keywords(table, existing_items, skipped, group_ids):
    """Union groups into distinct stored duplicates and report actual additions."""
    grouped_keywords = []
    processed_identities = set()

    for entry in skipped:
        if entry['reason'] != REASON_DUPLICATE:
            continue
        identity = normalize_keyword(entry['keyword'])
        if identity in processed_identities:
            continue
        processed_identities.add(identity)
        existing_item = existing_items.get(identity)
        if not existing_item:
            continue
        _updated, added_group_ids = add_keyword_groups(
            table,
            existing_item['id'],
            group_ids,
        )
        if added_group_ids:
            grouped_keywords.append(entry['keyword'])

    return grouped_keywords


def write_items(table, items):
    """Conditionally create items and report concurrent duplicate writes."""
    created_items = []
    skipped = []

    for item in items:
        if put_keyword_if_absent(table, item):
            created_items.append(item)
        else:
            skipped.append({
                'keyword': item['keyword'],
                'reason': REASON_DUPLICATE,
            })

    return created_items, skipped


def write_grouped_items(table, items, group_ids):
    """Create grouped items and attach groups when a concurrent creator wins."""
    created_items = []
    skipped = []
    grouped_keywords = []

    for item in items:
        if put_keyword_if_absent(table, item):
            created_items.append(item)
            continue

        skipped.append({
            'keyword': item['keyword'],
            'reason': REASON_DUPLICATE,
        })
        _updated, added_group_ids = add_keyword_groups(table, item['id'], group_ids)
        if added_group_ids:
            grouped_keywords.append(item['keyword'])

    return created_items, skipped, grouped_keywords


def create_items(to_create, status, priority):
    """Build keyword-table items, applying each optional status override."""
    timestamp = get_timestamp()

    return [
        build_keyword_item(
            entry['keyword'],
            timestamp=timestamp,
            status=entry.get('status', status),
            priority=priority,
            notes=build_notes(entry),
        )
        for entry in to_create
    ]


def _echoed(value):
    """Cap a reflected input value before echoing it in a validation message."""
    if len(value) <= MAX_ECHOED_VALUE_LENGTH:
        return value
    return f'{value[:MAX_ECHOED_VALUE_LENGTH]}...'


def _rejection(message, field):
    """Build the failure form returned by ``validate_request``."""
    return {'message': message, 'field': field}, None, None
