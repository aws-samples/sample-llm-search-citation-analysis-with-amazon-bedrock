"""
Opaque ``next_token`` continuation tokens.

Every paginated route hands out the same kind of token: URL-safe base64 of a
compact JSON object, unpadded. What the object holds is the route's business
(a DynamoDB ``LastEvaluatedKey``, an offset into a sorted aggregate, one
start key per merged partition); clients only echo it back.

``decode_cursor`` is strict: anything that is not a JSON object with exactly
the expected keys is rejected, so a tampered or stale token answers 400
(``CURSOR_ERROR_MESSAGE``) instead of starting a read at an arbitrary key.
Tokens are not signed. They only ever select a position inside data the
caller is already allowed to read; never put an authorization decision in one.
"""

from __future__ import annotations

import base64
import json
from collections.abc import Iterable
from decimal import Decimal
from typing import Any

# Longest token any route accepts. Merged-partition cursors (one start key per
# provider) are the largest, about 2 KB.
MAX_CURSOR_LENGTH = 4096

CURSOR_ERROR_MESSAGE = 'Invalid next_token'

# The `@validate` schema entry for the `next_token` query parameter.
CURSOR_QUERY_PARAM: dict[str, dict[str, Any]] = {
    'next_token': {'type': str, 'max_length': MAX_CURSOR_LENGTH},
}


def _key_value(value: Any) -> Any:
    """``json.dumps`` default: DynamoDB numbers keep their numeric JSON form."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    return str(value)


def encode_cursor(payload: dict[str, Any] | None) -> str | None:
    """The token for ``payload``, or ``None`` (no further page) when it is empty.

    DynamoDB numbers stay numbers, so a ``LastEvaluatedKey`` with a number
    attribute (a GSI sort key such as ``citation_count``) decodes back into a
    valid ``ExclusiveStartKey``.
    """
    if not payload:
        return None
    raw = json.dumps(payload, separators=(',', ':'), sort_keys=True, default=_key_value)
    return base64.urlsafe_b64encode(raw.encode('utf-8')).decode('ascii').rstrip('=')


def decode_cursor(token: str, required_keys: Iterable[str]) -> dict[str, Any] | None:
    """The object ``token`` encodes when its keys are exactly ``required_keys``; ``None`` otherwise.

    Fractional numbers decode as ``Decimal`` (boto3 rejects ``float``).
    """
    if len(token) > MAX_CURSOR_LENGTH:
        return None
    padded = token + '=' * (-len(token) % 4)
    try:
        raw = base64.b64decode(padded.encode('ascii'), altchars=b'-_', validate=True)
        decoded = json.loads(raw.decode('utf-8'), parse_float=Decimal)
    # binascii.Error, UnicodeError and JSONDecodeError are all ValueErrors.
    except ValueError:
        return None
    if not isinstance(decoded, dict) or set(decoded) != set(required_keys):
        return None
    return decoded


def encode_offset_cursor(offset: int, total: int) -> str | None:
    """Token for the next page of a sorted, in-memory list, or ``None`` at its end."""
    return encode_cursor({'offset': offset}) if offset < total else None


def decode_offset_cursor(token: str | None) -> int | None:
    """The offset an ``encode_offset_cursor`` token carries: 0 without a token, ``None`` when malformed."""
    if token is None:
        return 0
    decoded = decode_cursor(token, ('offset',))
    if decoded is None:
        return None
    offset = decoded['offset']
    # bool is an int subclass; True must not read as offset 1.
    if isinstance(offset, bool) or not isinstance(offset, int) or offset < 0:
        return None
    return offset
