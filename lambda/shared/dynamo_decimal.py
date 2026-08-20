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
from decimal import Decimal
from typing import Any


class DecimalEncoder(json.JSONEncoder):
    """JSON encoder that handles Decimal types from DynamoDB."""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        return super().default(obj)


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


def convert_floats_to_decimal(obj: Any) -> Any:
    """Recursively convert floats to Decimal for DynamoDB compatibility."""
    if isinstance(obj, float):
        return Decimal(str(obj))
    elif isinstance(obj, dict):
        return {k: convert_floats_to_decimal(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_floats_to_decimal(item) for item in obj]
    return obj
