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
from shared.keyword_store import (
    ALLOWED_KEYWORD_PRIORITIES,
    ALLOWED_KEYWORD_STATUSES,
    DEFAULT_KEYWORD_CATEGORY,
    DEFAULT_KEYWORD_LANGUAGE,
    DEFAULT_KEYWORD_PRIORITY,
    DEFAULT_KEYWORD_REGION,
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

NOTES_FIELDS = ('intent', 'competition', 'source')
MAX_KEYWORDS = 500
MAX_NOTES_LENGTH = 1000
# Longest slice of a rejected input value echoed back in a 400 message
# (bugs.md 2.4) — long enough to identify the value, bounded so the response
# can't reflect arbitrarily large request bodies.
MAX_ECHOED_VALUE_LENGTH = 50

# Enum values and defaults come from the shared keyword store (bugs.md 3.3);
# the local names remain this module's public vocabulary and are referenced
# by its property tests.
ALLOWED_STATUSES = ALLOWED_KEYWORD_STATUSES
ALLOWED_PRIORITIES = ALLOWED_KEYWORD_PRIORITIES
DEFAULT_STATUS = DEFAULT_KEYWORD_STATUS
DEFAULT_PRIORITY = DEFAULT_KEYWORD_PRIORITY
DEFAULT_REGION = DEFAULT_KEYWORD_REGION
DEFAULT_LANGUAGE = DEFAULT_KEYWORD_LANGUAGE
DEFAULT_CATEGORY = DEFAULT_KEYWORD_CATEGORY

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

    try:
        existing_keys = load_keyword_identities(keywords_table)
    except Exception as error:
        logger.error(
            f'Failed to read existing keywords for promotion: {error!s}',
            exc_info=True,
        )
        return error_response(error, event)

    to_create, skipped = partition_keywords(keywords, existing_keys)
    items = create_items(to_create, status, priority)
    created_items, concurrent_skips = write_items(keywords_table, items)
    skipped.extend(concurrent_skips)

    return success_response({
        'created': len(created_items),
        'skipped': sum(
            1 for entry in skipped if entry['reason'] == REASON_DUPLICATE
        ),
        'created_keywords': created_items,
        'skipped_keywords': skipped,
    }, event)


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


def validate_request(keywords, status, priority):
    """Validate the complete promotion request before any DynamoDB access."""
    if not isinstance(keywords, list) or not keywords:
        return _rejection('At least one keyword is required', 'keywords')

    if len(keywords) > MAX_KEYWORDS:
        return _rejection(f'Maximum {MAX_KEYWORDS} keywords per request', 'keywords')

    texts = []
    for index, research_keyword in enumerate(keywords):
        field_prefix = f'keywords[{index}]'
        if not isinstance(research_keyword, dict):
            return _rejection('Each keyword must be a JSON object', field_prefix)

        keyword_value = research_keyword.get('keyword')
        if keyword_value is None:
            # A missing keyword is a skip (reported by partition_keywords),
            # not a rejection — batch semantics.
            text = ''
        else:
            # empty_ok: this route skips empty-after-trim entries instead of
            # rejecting like manage-keywords does (bugs.md 3.3).
            text, message = validate_keyword_text(keyword_value, empty_ok=True)
            if message:
                return _rejection(message, f'{field_prefix}.keyword')
        texts.append(text)

        for notes_field in NOTES_FIELDS:
            notes_value = research_keyword.get(notes_field)
            if notes_value is not None and not isinstance(notes_value, str):
                return _rejection(
                    f'{notes_field} must be a string',
                    f'{field_prefix}.{notes_field}',
                )

        if len(build_notes(research_keyword)) > MAX_NOTES_LENGTH:
            return _rejection(
                f'Keyword notes exceed maximum length of {MAX_NOTES_LENGTH} characters',
                field_prefix,
            )

    if not any(texts):
        return _rejection('At least one non-empty keyword is required', 'keywords')

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


def create_items(to_create, status, priority):
    """Build keyword-table items for accepted research keywords."""
    timestamp = get_timestamp()

    return [
        build_keyword_item(
            entry['keyword'],
            timestamp=timestamp,
            status=status,
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
