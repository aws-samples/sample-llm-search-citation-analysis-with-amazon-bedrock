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
import hashlib
import json
from collections.abc import Iterable
from decimal import Decimal
from typing import Any

from shared.dynamo_decimal import plain_number

# Longest token any route accepts. Merged-partition cursors (one start key per
# provider) are the largest, about 2 KB.
MAX_CURSOR_LENGTH = 4096

CURSOR_ERROR_MESSAGE = 'Invalid next_token: pass the next_token of the previous page, with the same filters'

# The `@validate` schema entry for the `next_token` query parameter.
CURSOR_QUERY_PARAM: dict[str, dict[str, Any]] = {
    'next_token': {'type': str, 'max_length': MAX_CURSOR_LENGTH},
}


def _key_value(value: Any) -> Any:
    """``json.dumps`` default: DynamoDB numbers keep their numeric JSON form."""
    if isinstance(value, Decimal):
        return plain_number(value)
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
    return None if decoded is None else _offset(decoded['offset'])


def _offset(value: Any) -> int | None:
    """``value`` when it is a non-negative integer offset, else ``None``."""
    # bool is an int subclass; True must not read as offset 1.
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def query_binding(query: dict[str, Any]) -> str:
    """A short digest of the query a page belongs to, for ``encode_bound_offset_cursor``."""
    raw = json.dumps(query, separators=(',', ':'), sort_keys=True, default=str)
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()[:16]


def encode_bound_offset_cursor(offset: int, total: int, binding: str) -> str | None:
    """``encode_offset_cursor`` that also names its query (``query_binding``), or ``None`` at the list's end."""
    return encode_cursor({'offset': offset, 'query': binding}) if offset < total else None


def decode_bound_offset_cursor(token: str | None, binding: str) -> int | None:
    """The offset of an ``encode_bound_offset_cursor`` token: 0 without one, ``None`` when malformed or for another query."""
    if token is None:
        return 0
    decoded = decode_cursor(token, ('offset', 'query'))
    if decoded is None or decoded['query'] != binding:
        return None
    return _offset(decoded['offset'])
