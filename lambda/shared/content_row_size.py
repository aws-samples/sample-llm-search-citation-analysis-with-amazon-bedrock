"""
Keep a Content Studio row under DynamoDB's 400 KB item limit.

A row stores the idea it was generated from (``idea_data``, up to the worker
event bound of 240 KB), the parsed ``generated_content`` and the model's
``raw_content``. An ``update_item`` that would push the row past 400 KB is
rejected with a ValidationException, and the generation result is lost while
the row stays ``generating``. ``fit_generation_result`` decides, before the
write, what can be stored:

1. everything, when it fits;
2. without ``raw_content`` (the unparsed model text, kept for debugging only);
3. otherwise a failed result with a clear message, so the row is terminal and
   the user knows to shorten the brief.

Sizes are estimated as UTF-8 JSON (``ensure_ascii=False``), which is close to
DynamoDB's own accounting (UTF-8 attribute names and values) and slightly
above it for maps and lists, plus a fixed allowance for the row's small
attributes (ids, keyword, timestamps, batch metadata, lease fields).
"""

from __future__ import annotations

import json
from typing import Any

from shared.dynamo_decimal import DecimalEncoder

DYNAMODB_ITEM_LIMIT_BYTES = 400 * 1024
# Ids, keyword, title, angle, status, timestamps, batch and lease fields.
_ROW_OVERHEAD_BYTES = 16 * 1024
ITEM_BUDGET_BYTES = DYNAMODB_ITEM_LIMIT_BYTES - _ROW_OVERHEAD_BYTES

CONTENT_TOO_LARGE_ERROR_TYPE = 'content_too_large'


def stored_bytes(value: Any) -> int:
    """UTF-8 size of ``value`` as JSON without ASCII escaping (close to DynamoDB's item accounting)."""
    return len(json.dumps(value, cls=DecimalEncoder, ensure_ascii=False, default=str).encode('utf-8'))


def _row_bytes(idea: Any, result: dict[str, Any]) -> int:
    return stored_bytes({
        'idea_data': idea,
        'generated_content': result.get('content', {}),
        'raw_content': result.get('raw_content', ''),
        'content_warning': result.get('content_warning'),
        'error_message': result.get('error', ''),
    })


def _too_large_failure(size: int) -> dict[str, Any]:
    kilobytes = size // 1024
    return {
        'success': False,
        'error': (
            f'The generated content is too large to store ({kilobytes} KB; the limit is '
            f'{ITEM_BUDGET_BYTES // 1024} KB including the brief). Shorten the brief or ask for less content.'
        ),
        'error_type': CONTENT_TOO_LARGE_ERROR_TYPE,
        'raw_content': '',
    }


def fit_generation_result(idea: Any, status: str, result: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """The ``(status, result)`` to persist so the row stays within ``ITEM_BUDGET_BYTES``."""
    size = _row_bytes(idea, result)
    if size <= ITEM_BUDGET_BYTES:
        return status, result
    without_raw = {**result, 'raw_content': ''}
    if _row_bytes(idea, without_raw) <= ITEM_BUDGET_BYTES:
        return status, without_raw
    return 'failed', _too_large_failure(size)
