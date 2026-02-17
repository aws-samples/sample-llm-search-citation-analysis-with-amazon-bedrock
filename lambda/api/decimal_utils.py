"""
Decimal Utilities for DynamoDB

DynamoDB returns numeric values as Decimal types. These utilities
convert them to native Python types for arithmetic operations.
"""

from decimal import Decimal


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


def to_float(value, default=0.0) -> float:
    """Convert Decimal or any numeric to float."""
    if value is None:
        return default
    if isinstance(value, Decimal):
        return float(value)
    try:
        return float(value) if value else default
    except (ValueError, TypeError):
        return default
