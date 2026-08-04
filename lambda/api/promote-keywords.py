"""
Promote Keywords API Lambda

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

# Request-level limits (Req 7.1, 7.3).
MAX_KEYWORDS = 500
MAX_KEYWORD_LENGTH = 100

# Allowed status/priority values, matched exactly and case-sensitively (Req 3.1, 3.3).
ALLOWED_STATUSES = ('active', 'inactive', 'paused')
ALLOWED_PRIORITIES = ('high', 'normal', 'low')

# Values applied when status/priority is omitted or empty (Req 3.2, 3.4).
DEFAULT_STATUS = 'active'
DEFAULT_PRIORITY = 'normal'

# Item defaults reused from the `create_keyword` path in `manage-keywords.py`,
# which validates `region`/`language`/`category` with these same defaults.
DEFAULT_REGION = 'global'
DEFAULT_LANGUAGE = 'en'
DEFAULT_CATEGORY = ''

# Skip reasons reported in `skipped_keywords`. Only DUPLICATE entries are
# counted by the response's `skipped` number (Req 1.4, 2.5); EMPTY entries
# (Req 7.2) are reported but counted in neither `created` nor `skipped`.
REASON_DUPLICATE = 'duplicate'
REASON_EMPTY = 'empty'


@api_handler
@parse_json_body
def handler(event, context, body):
    """POST /api/keywords/promote - promote research keywords into Keywords_Table.

    Orchestrates validate -> read existing keys -> partition -> build items ->
    write -> respond, returning
    `{created, skipped, created_keywords, skipped_keywords}`.

    `skipped` is the DUPLICATE-ONLY count (Req 1.4, 2.5): the number of
    `skipped_keywords` entries whose reason is `duplicate`. It is NOT
    `len(skipped_keywords)`, because that list also carries `reason: 'empty'`
    entries (Req 7.2), which are counted in neither `created` nor `skipped`. The
    requirements Glossary defines a Duplicate_Keyword as one matching an EXISTING
    Active_Keyword, and an empty-text entry is not one.

    A rejected request returns 400 before any DynamoDB read or write; a failed
    read returns 500 with nothing created (Req 2.6).
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

    return success_response({
        'created': len(items),
        'skipped': sum(1 for entry in skipped if entry['reason'] == REASON_DUPLICATE),
        'created_keywords': items,
        'skipped_keywords': skipped,
    }, event)


def normalize_keyword(text):
    """Return the canonical comparison key: trimmed and lower-cased.

    Used both against existing active keywords and to collapse duplicates within
    a single request.
    """
    return text.strip().lower()


def build_notes(rk):
    """Build the `notes` value from a research keyword's context fields.

    Joins the present `intent`, `competition`, and `source` values in that fixed
    order, each labeled by its field name, separated by '; '. Absent or empty
    fields are omitted; with none present the result is ''.

    Example: 'intent: commercial; competition: high; source: expansion'
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
    """Apply the request-level promotion gates and resolve status/priority.

    Pure function: performs no IO. Every gate failure rejects the ENTIRE
    request, so this runs before any DynamoDB read or write.

    Gates, in this fixed order:
        1. `keywords` is present and non-empty (Req 1.6, 7.4)
        2. `keywords` holds at most MAX_KEYWORDS entries (Req 7.1)
        3. every trimmed text is at most MAX_KEYWORD_LENGTH chars (Req 7.3)
        4. at least one keyword has non-empty trimmed text (Req 7.4)
        5. `status` is one of ALLOWED_STATUSES (Req 3.5)
        6. `priority` is one of ALLOWED_PRIORITIES (Req 3.5)

    An individually-empty keyword is NOT a request-level failure: it is a
    per-item skip handled by `partition_keywords` (Req 7.2). Gate 4 only rejects
    when NO keyword carries non-empty trimmed text.

    `status` and `priority` are RESOLVED BEFORE gates 5 and 6, so an omitted
    (`None`) or empty value is valid and becomes the default (Req 3.2, 3.4).
    Present values are matched exactly and case-sensitively. Both gates are
    evaluated so an invalid status AND an invalid priority are each named.

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
    """Split validated research keywords into creations and reported skips.

    Pure function: performs no IO. Runs AFTER `validate_request` has accepted the
    request and AFTER the existing keys have been read, so every decision here is
    a PER-ITEM skip, never a request-level rejection. `existing_keys` members are
    ALREADY normalized (what `load_existing_keyword_keys` returns) and are never
    re-normalized.

    Classification, per entry, in this order:
        1. empty after trimming -> skipped, `reason: 'empty'` (Req 7.2)
        2. key in `existing_keys` -> skipped, `reason: 'duplicate'`
        3. key already accepted earlier in THIS request -> collapsed into that
           earlier creation (Req 2.3)
        4. otherwise -> created

    Documented decisions:
        - FIRST occurrence wins. Where several entries share a normalized key,
          the earliest one supplies the created item, so its original trimmed
          text (and its research context) is what gets stored.
        - Intra-request collapsed extras (case 3) are NOT reported in `skipped`.
          `skipped` reports only Duplicate_Keywords -- which the requirements
          Glossary defines as matching an EXISTING Active_Keyword -- and
          individually-empty keywords. A collapsed extra is neither: its text WAS
          promoted, via its equal sibling. Reporting it as a duplicate would also
          make the UI retain that variant in the selection forever (Req 6.5
          retains skipped duplicates), even though the keyword now exists. So
          `len(to_create) + len(skipped)` can be LESS than `len(keywords)` when a
          request carries equal texts.
        - Every OTHER skip is reported once per request entry, so each
          individually-empty and each duplicate entry appears in `skipped` with
          its own text (Req 2.4).

    Returns `(to_create, skipped)`; a `to_create` entry carries the trimmed
    `keyword` text (original case preserved) plus the research-context fields
    `build_notes` reads.
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
    """Read every existing Active_Keyword's normalized comparison key.

    De-duplication is defined against ANY item in the Keywords_Table (the
    requirements Glossary defines Active_Keyword as an item in that table, not
    only one whose `status` is `active`), so this reads the whole table via a
    paginated `scan` following `LastEvaluatedKey` until it is exhausted.

    The projection is limited to the `keyword` attribute and expressed through an
    `ExpressionAttributeNames` alias, so a DynamoDB reserved-word collision on
    the projected name is impossible.

    Any `scan` failure propagates to the caller, which aborts the request with
    zero writes (Req 2.6). Returns keys already run through `normalize_keyword`.
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
    """Put every created Active_Keyword through a `batch_writer`.

    Promotion only ADDS items: this issues `put_item` for the freshly built items
    and never touches pre-existing ones (Req 2.2). `batch_writer` batches the puts
    and retries unprocessed items on its own. When there is nothing to create no
    writer is opened at all, so an all-skipped request performs zero write calls.
    """
    if not items:
        return

    with table.batch_writer() as batch:
        for item in items:
            batch.put_item(Item=item)


def create_items(to_create, status, priority):
    """Build the Active_Keyword items for the accepted research keywords.

    Pure apart from `uuid4()` and the clock. Mirrors the item shape produced by
    `create_keyword` in `manage-keywords.py`, reusing that path's `region` /
    `language` / `category` defaults.

    Every item in a single call shares one `get_timestamp()` value, and each
    item's `created_at` equals its `updated_at` (Req 1.3). Each `id` is a fresh
    `uuid4()`. The stored `keyword` is the trimmed research text with its ORIGINAL
    casing -- not the normalized comparison key (Req 1.2). The `status` /
    `priority` arrive already resolved from `validate_request` and are applied to
    every item.
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
