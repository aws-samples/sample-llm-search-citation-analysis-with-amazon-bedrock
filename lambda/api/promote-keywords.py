"""Promote Keywords API Lambda.

Handles POST /api/keywords/promote - promotes research keywords into the
active Keywords table, de-duplicating against existing active keywords.
"""

import logging
import sys
import uuid

import boto3

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import error_response, success_response, validation_error
from shared.decorators import api_handler, parse_json_body
from shared.env_vars import resolve_table_env
from shared.utils import get_timestamp

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables (audit #12 canonical naming).
KEYWORDS_TABLE = resolve_table_env('DYNAMODB_TABLE_KEYWORDS', 'KEYWORDS_TABLE')
keywords_table = dynamodb.Table(KEYWORDS_TABLE)

# Research-context fields recorded in `notes`, in the order they appear.
NOTES_FIELDS = ('intent', 'competition', 'source')

# Request-level limits.
MAX_KEYWORDS = 500
MAX_KEYWORD_LENGTH = 100

# Allowed status/priority values, matched exactly and case-sensitively.
ALLOWED_STATUSES = ('active', 'inactive', 'paused')
ALLOWED_PRIORITIES = ('high', 'normal', 'low')

# Applied when status/priority is omitted or empty.
DEFAULT_STATUS = 'active'
DEFAULT_PRIORITY = 'normal'

# Item defaults mirrored from the `create_keyword` path in `manage-keywords.py`.
DEFAULT_REGION = 'global'
DEFAULT_LANGUAGE = 'en'
DEFAULT_CATEGORY = ''

# Skip reasons reported in `skipped_keywords`.
REASON_DUPLICATE = 'duplicate'
REASON_EMPTY = 'empty'


@api_handler
@parse_json_body
def handler(event, context, body):
    """POST /api/keywords/promote - promote research keywords into Keywords_Table.

    Orchestrates validate -> read existing keys -> partition -> build items ->
    write -> respond, returning `{created, skipped, created_keywords,
    skipped_keywords}`. A rejected request returns 400 before any DynamoDB
    access; a failed read returns 500 with nothing created.
    """
    keywords = body.get('keywords')

    error, status, priority = validate_request(
        keywords, body.get('status'), body.get('priority')
    )
    if error:
        return validation_error(error['message'], event, error['field'])

    # Only the read is wrapped: a read failure must abort with nothing created
    # (Req 2.6). Write failures stay with `@api_handler`'s sanitized 500.
    try:
        existing_keys = load_existing_keyword_keys(keywords_table)
    except Exception as e:
        logger.error(f'Failed to read existing keywords for promotion: {e!s}', exc_info=True)
        return error_response(e, event)

    to_create, skipped = partition_keywords(keywords, existing_keys)
    items = create_items(to_create, status, priority)

    write_items(keywords_table, items)

    # `skipped` is the DUPLICATE-ONLY count, not len(skipped_keywords): that list
    # also holds reason:'empty' entries, which count toward neither created nor skipped.
    return success_response({
        'created': len(items),
        'skipped': sum(1 for entry in skipped if entry['reason'] == REASON_DUPLICATE),
        'created_keywords': items,
        'skipped_keywords': skipped,
    }, event)


def normalize_keyword(text):
    """Return the canonical comparison key: trimmed and lower-cased."""
    return text.strip().lower()


def build_notes(rk):
    """Build `notes` from present intent/competition/source, in that fixed order.

    Each present value is labeled by its field name and joined with '; '; absent
    or empty fields are omitted, so with none present the result is ''.
    """
    parts = []
    for field in NOTES_FIELDS:
        value = rk.get(field)
        if not value:
            continue
        value = str(value).strip()
        if value:
            parts.append(f'{field}: {value}')

    return '; '.join(parts)


def validate_request(keywords, status, priority):
    """Apply request-level promotion gates and resolve status/priority (no IO).

    Every gate failure rejects the ENTIRE request. Gates run in fixed order:
    keywords present/non-empty, at most MAX_KEYWORDS, each trimmed text within
    MAX_KEYWORD_LENGTH, at least one non-empty text, status in ALLOWED_STATUSES,
    priority in ALLOWED_PRIORITIES. An individually-empty keyword is a per-item
    skip (see `partition_keywords`), not a request failure. status/priority are
    RESOLVED BEFORE their gates, so an omitted/empty value is valid and defaults.

    Returns `(None, status, priority)` on success, or
    `({'message', 'field'}, None, None)` on rejection.
    """
    if not keywords:
        return _rejection('At least one keyword is required', 'keywords')

    if len(keywords) > MAX_KEYWORDS:
        return _rejection(f'Maximum {MAX_KEYWORDS} keywords per request', 'keywords')

    texts = [str(rk.get('keyword') or '').strip() for rk in keywords]

    if any(len(text) > MAX_KEYWORD_LENGTH for text in texts):
        return _rejection(
            f'Keyword exceeds maximum length of {MAX_KEYWORD_LENGTH} characters', 'keywords'
        )

    if not any(texts):
        return _rejection('At least one non-empty keyword is required', 'keywords')

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
        return _rejection(message, ', '.join(field for field, _value, _allowed in invalid))

    return None, resolved_status, resolved_priority


def partition_keywords(keywords, existing_keys):
    """Split validated research keywords into creations and reported skips (no IO).

    Runs after validation and after existing keys are read, so every decision is
    a PER-ITEM skip. `existing_keys` members are already normalized and are not
    re-normalized. Per entry, in order: empty-after-trim -> skip reason 'empty';
    key in existing_keys -> skip reason 'duplicate'; key already accepted earlier
    in this request -> collapsed into that creation; otherwise -> created.

    First occurrence wins: the earliest entry of a shared normalized key supplies
    the created item (original trimmed text and context). Intra-request collapsed
    extras are NOT reported in `skipped` -- a Duplicate_Keyword is defined against
    an EXISTING keyword, and a collapsed extra's text was already promoted -- so
    `len(to_create) + len(skipped)` can be LESS than `len(keywords)`.

    Returns `(to_create, skipped)`; each `to_create` entry carries the trimmed
    `keyword` text (original case) plus the fields `build_notes` reads.
    """
    to_create = []
    skipped = []
    accepted_keys = set()

    for rk in keywords:
        text = str(rk.get('keyword') or '').strip()

        if not text:
            skipped.append({'keyword': text, 'reason': REASON_EMPTY})
            continue

        key = normalize_keyword(text)

        if key in existing_keys:
            skipped.append({'keyword': text, 'reason': REASON_DUPLICATE})
            continue

        if key in accepted_keys:
            continue

        accepted_keys.add(key)
        to_create.append({**rk, 'keyword': text})

    return to_create, skipped


def load_existing_keyword_keys(table):
    """Read every existing keyword's normalized comparison key via a paginated scan.

    De-duplication is defined against any item in the table, so this scans the
    whole table following `LastEvaluatedKey` until exhausted. The projection is
    limited to `keyword` via an `ExpressionAttributeNames` alias to avoid a
    reserved-word collision. Any scan failure propagates so the caller aborts
    with zero writes. Returns keys already run through `normalize_keyword`.
    """
    existing_keys = set()
    scan_params = {
        'ProjectionExpression': '#kw',
        'ExpressionAttributeNames': {'#kw': 'keyword'},
    }

    while True:
        response = table.scan(**scan_params)

        for item in response.get('Items', []):
            key = normalize_keyword(str(item.get('keyword') or ''))
            if key:
                existing_keys.add(key)

        last_key = response.get('LastEvaluatedKey')
        if not last_key:
            return existing_keys

        scan_params['ExclusiveStartKey'] = last_key


def write_items(table, items):
    """Put every created keyword through a `batch_writer` (adds only, no updates).

    When there is nothing to create no writer is opened, so an all-skipped
    request performs zero write calls.
    """
    if not items:
        return

    with table.batch_writer() as batch:
        for item in items:
            batch.put_item(Item=item)


def create_items(to_create, status, priority):
    """Build the keyword items for accepted research keywords.

    Mirrors the item shape from `create_keyword` in `manage-keywords.py`, reusing
    its region/language/category defaults. Every item in a call shares one
    `get_timestamp()` (created_at == updated_at), each `id` is a fresh uuid4, and
    the stored `keyword` is the trimmed research text with ORIGINAL casing (not
    the normalized key). status/priority arrive already resolved.
    """
    timestamp = get_timestamp()

    return [
        {
            'id': str(uuid.uuid4()),
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
    """Build the failure form of the `validate_request` return value."""
    return {'message': message, 'field': field}, None, None
