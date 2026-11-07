"""
Decimal ⇄ native conversions for DynamoDB values.

boto3 returns DynamoDB numbers as ``Decimal`` and rejects ``float`` on
write. The conversions previously lived in three homes (bugs.md 3.4):
``search/handler.py:convert_floats_to_decimal``,
``api/decimal_utils.py:to_int`` (bundled per API Lambda and imported bare),
and ``shared.api_response.DecimalEncoder``. This module is the single home;
``api_response`` re-exports ``DecimalEncoder`` for its existing importers.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from decimal import Decimal
from typing import Any


class DecimalEncoder(json.JSONEncoder):
    """JSON encoder that handles Decimal types from DynamoDB."""
    def default(self, o):
        if isinstance(o, Decimal):
            return float(o)
        return super().default(o)


def to_int(value, default=0) -> int:
    """Convert Decimal or any numeric to int."""
    if value is None:
        return default
    if isinstance(value, Decimal):
        return int(value)
    try:
        return int(value) if value else default
    except (ValueError, TypeError):
        return default


def positive_int(value: object) -> int | None:
    """``value`` when it is an ``int`` of at least 1 (a ``bool`` is not); ``None`` for anything else.

    For counts and counters in workflow payloads, where a string, float or
    ``Decimal`` means the payload is not the shape the step wrote.
    """
    return value if isinstance(value, int) and not isinstance(value, bool) and value >= 1 else None


def convert_floats_to_decimal(obj: Any) -> Any:
    """Recursively convert floats to Decimal for DynamoDB compatibility."""
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: convert_floats_to_decimal(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [convert_floats_to_decimal(item) for item in obj]
    return obj


def plain_number(value: Decimal) -> int | float:
    """A DynamoDB ``Decimal`` as an ``int`` when it is whole, a ``float`` otherwise."""
    return int(value) if value == value.to_integral_value() else float(value)


def plain(value: Any) -> Any:
    """``value`` with DynamoDB's ``Decimal`` numbers turned back into ``int`` (when whole) / ``float``, recursively."""
    if isinstance(value, Decimal):
        return plain_number(value)
    if isinstance(value, Mapping):
        return {key: plain(entry) for key, entry in value.items()}
    if isinstance(value, list | tuple | set):
        return [plain(entry) for entry in value]
    return value
