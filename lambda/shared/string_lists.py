"""
Validate a request-supplied list of strings: bounded, normalized per entry,
deduplicated in first-seen order.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any


def normalize_string_list(
    value: Any,
    *,
    limit: int | None,
    normalize: Callable[[str], str | None],
    type_error: str,
    limit_error: str,
    entry_error: str,
) -> tuple[list[str] | None, str | None]:
    """``(entries, None)`` or ``(None, error_message)``.

    ``value`` must be a list of at most ``limit`` entries (``None``: any count)
    of strings (``type_error``, ``limit_error`` otherwise). ``normalize`` maps
    each entry to its stored form, or to ``None`` when the entry is invalid
    (``entry_error``). Normalized duplicates are dropped, first one kept.
    """
    if not isinstance(value, list):
        return None, type_error
    if limit is not None and len(value) > limit:
        return None, limit_error

    entries: list[str] = []
    seen: set[str] = set()
    for entry in value:
        if not isinstance(entry, str):
            return None, type_error
        normalized = normalize(entry)
        if normalized is None:
            return None, entry_error
        if normalized not in seen:
            seen.add(normalized)
            entries.append(normalized)
    return entries, None
