"""Promote keyword-research results into the active Keywords table."""

import logging
import sys

import boto3
from botocore.exceptions import ClientError

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import error_response, success_response, validation_error
from shared.decorators import api_handler, parse_json_body
from shared.env_vars import resolve_table_env
from shared.utils import (
    get_timestamp,
    is_unicode_scalar_text,
    keyword_id,
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
MAX_KEYWORD_LENGTH = 500
MAX_NOTES_LENGTH = 1000

ALLOWED_STATUSES = ('active', 'inactive', 'paused')
ALLOWED_PRIORITIES = ('high', 'normal', 'low')
DEFAULT_STATUS = 'active'
DEFAULT_PRIORITY = 'normal'

DEFAULT_REGION = 'global'
DEFAULT_LANGUAGE = 'en'
DEFAULT_CATEGORY = ''

REASON_DUPLICATE = 'duplicate'
REASON_EMPTY = 'empty'

# Compatibility name retained for the focused property tests and the handler's
# existing read/partition terminology.
load_existing_keyword_keys = load_keyword_identities


@api_handler
@parse_json_body
def handler(event, context, body):
    """Handle POST /api/keywords/promote."""
    if event.get('httpMethod') != 'POST':
        return validation_error('Method not allowed', event, 'httpMethod')

    if not isinstance(body, dict):
        return validation_error('Request body must be a JSON object', event, 'body')

    keywords = body.get('keywords')
    error, status, priority = validate_request(
        keywords, body.get('status'), body.get('priority')
    )
    if error:
        return validation_error(error['message'], event, error['field'])

    try:
        existing_keys = load_existing_keyword_keys(keywords_table)
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
        if keyword_value is not None and not isinstance(keyword_value, str):
            return _rejection('Keyword must be a string', f'{field_prefix}.keyword')
        if isinstance(keyword_value, str) and not is_unicode_scalar_text(keyword_value):
            return _rejection(
                'Keyword must contain valid Unicode scalar values',
                f'{field_prefix}.keyword',
            )

        text = trim_keyword(keyword_value) if isinstance(keyword_value, str) else ''
        texts.append(text)
        if len(text) > MAX_KEYWORD_LENGTH:
            return _rejection(
                f'Keyword exceeds maximum length of {MAX_KEYWORD_LENGTH} characters',
                f'{field_prefix}.keyword',
            )

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
            f"Invalid {field} '{value}' (allowed: {', '.join(allowed)})"
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
        try:
            table.put_item(
                Item=item,
                ConditionExpression='attribute_not_exists(#id)',
                ExpressionAttributeNames={'#id': 'id'},
            )
        except ClientError as error:
            error_code = error.response.get('Error', {}).get('Code')
            if error_code != 'ConditionalCheckFailedException':
                raise
            skipped.append({
                'keyword': item['keyword'],
                'reason': REASON_DUPLICATE,
            })
        else:
            created_items.append(item)

    return created_items, skipped


def create_items(to_create, status, priority):
    """Build keyword-table items for accepted research keywords."""
    timestamp = get_timestamp()

    return [
        {
            'id': keyword_id(entry['keyword']),
            'keyword': entry['keyword'],
            'status': status,
            'created_at': timestamp,
            'updated_at': timestamp,
            'region': DEFAULT_REGION,
            'language': DEFAULT_LANGUAGE,
            'category': DEFAULT_CATEGORY,
            'priority': priority,
            'notes': build_notes(entry),
        }
        for entry in to_create
    ]


def _rejection(message, field):
    """Build the failure form returned by ``validate_request``."""
    return {'message': message, 'field': field}, None, None
