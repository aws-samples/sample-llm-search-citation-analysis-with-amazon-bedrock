"""An Admin's on/off setting for a weekly paid snapshot sweep, stored as one item in the snapshots' own table.

The domain and backlink snapshot sweeps are recurring paid DataForSEO work, so both stay off until an Admin turns
them on. Each keeps its setting under a key no snapshot can use (``#`` never starts a domain) and records who made
the choice and when (TENETS.md, D4).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

#: ``PUT .../schedule`` body: ``{"enabled": bool}``.
SCHEDULE_SCHEMA: dict[str, dict[str, Any]] = {'enabled': {'required': True, 'type': bool}}


def schedule_enabled(table: Any, key: Mapping[str, str]) -> bool:
    """Whether the setting under ``key`` is on (off when it was never set)."""
    item = table.get_item(Key=dict(key)).get('Item') or {}
    return item.get('enabled') is True


def set_schedule(table: Any, key: Mapping[str, str], *, enabled: bool, updated_by: str | None, updated_at: str) -> None:
    """Record the choice under ``key``, with who made it and when."""
    table.put_item(Item={**key, 'enabled': enabled, 'updated_by': updated_by or 'unknown', 'updated_at': updated_at})


__all__ = ['SCHEDULE_SCHEMA', 'schedule_enabled', 'set_schedule']
