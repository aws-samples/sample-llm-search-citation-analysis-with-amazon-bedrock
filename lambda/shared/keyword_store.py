"""
Shared keyword validation and persistence for routes writing the Keywords table.

``manage-keywords`` and ``promote-keywords`` write the same table and must
agree on the validation sequence (type → surrogate check → trim → length),
the item shape, and the conditional-put semantics. These were previously
duplicated per route (bugs.md 3.3); this module is the single home.

The one deliberate behavioral divergence between the two routes is
empty-after-trim handling: manage rejects, promote skips the entry. That
decision is the ``empty_ok`` parameter — everything else is identical by
construction.
"""

from __future__ import annotations

from typing import Any

from botocore.exceptions import ClientError

from shared.constants import MAX_KEYWORD_LENGTH
from shared.utils import is_unicode_scalar_text, keyword_id, trim_keyword

# Allowed enum values and item defaults. manage-keywords feeds them into its
# @validate schema; promote-keywords resolves request-level values against
# them.
ALLOWED_KEYWORD_STATUSES = ('active', 'inactive', 'paused')
ALLOWED_KEYWORD_PRIORITIES = ('high', 'normal', 'low')
DEFAULT_KEYWORD_STATUS = 'active'
DEFAULT_KEYWORD_PRIORITY = 'normal'
DEFAULT_KEYWORD_REGION = 'global'
DEFAULT_KEYWORD_LANGUAGE = 'en'
DEFAULT_KEYWORD_CATEGORY = ''


def validate_keyword_text(
    keyword: Any,
    *,
    empty_ok: bool = False,
) -> tuple[str | None, str | None]:
    """Validate raw keyword input and return ``(text, error_message)``.

    Exactly one element is ``None``: on success the explicitly trimmed text
    comes back (possibly ``''`` when ``empty_ok``), on failure the
    caller-facing message. The sequence (type → surrogate check → trim →
    length) and the message texts are shared verbatim by manage-keywords and
    promote-keywords and are pinned by both routes' test suites.

    Args:
        keyword: Raw request value.
        empty_ok: Empty-after-trim policy — manage rejects (``False``),
            promote skips the entry instead (``True``).
    """
    if not isinstance(keyword, str):
        return None, 'Keyword must be a string'
    if not is_unicode_scalar_text(keyword):
        return None, 'Keyword must contain valid Unicode scalar values'

    text = trim_keyword(keyword)
    if not text and not empty_ok:
        return None, 'Keyword must not be empty'
    if len(text) > MAX_KEYWORD_LENGTH:
        return None, f'Keyword exceeds maximum length of {MAX_KEYWORD_LENGTH} characters'
    return text, None


def build_keyword_item(
    text: str,
    *,
    timestamp: str,
    status: str = DEFAULT_KEYWORD_STATUS,
    priority: str = DEFAULT_KEYWORD_PRIORITY,
    region: str = DEFAULT_KEYWORD_REGION,
    language: str = DEFAULT_KEYWORD_LANGUAGE,
    category: str = DEFAULT_KEYWORD_CATEGORY,
    notes: str = '',
) -> dict[str, Any]:
    """Build the canonical Keywords-table item for validated keyword text.

    ``timestamp`` is explicit so batch writers (promote) can stamp every
    item of one request identically — a property their tests pin.
    """
    return {
        'id': keyword_id(text),
        'keyword': text,
        'status': status,
        'created_at': timestamp,
        'updated_at': timestamp,
        'region': region,
        'language': language,
        'category': category,
        'priority': priority,
        'notes': notes,
    }


def put_keyword_if_absent(table: Any, item: dict[str, Any]) -> bool:
    """Conditionally create ``item``; return ``False`` when the id is taken.

    Uses ``attribute_not_exists(id)`` so two concurrent creates cannot both
    win. Every non-conditional ``ClientError`` propagates unchanged.
    """
    try:
        table.put_item(
            Item=item,
            ConditionExpression='attribute_not_exists(#id)',
            ExpressionAttributeNames={'#id': 'id'},
        )
    except ClientError as error:
        if error.response.get('Error', {}).get('Code') != 'ConditionalCheckFailedException':
            raise
        return False
    return True
