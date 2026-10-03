"""The optional ``group_ids`` a keyword write request may carry, checked against the groups table."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from shared.keyword_groups import load_existing_group_ids, validate_id_list


def validate_requested_group_ids(
    body: Mapping[str, Any],
    groups_table: Any | None,
    *,
    limit: int | None = None,
) -> tuple[list[str] | None, str | None]:
    """Validate ``body['group_ids']`` and confirm every id names an existing group.

    Returns ``(None, None)`` when the field is omitted, ``(group_ids, None)``
    when it is valid (possibly ``[]``), else ``(None, message)`` -- the message
    belongs to the ``group_ids`` field. ``groups_table`` is ``None`` on a
    deployment without the groups table, where only an empty list is accepted.
    """
    if 'group_ids' not in body:
        return None, None
    group_ids, message = validate_id_list(body.get('group_ids'), field='group_ids', limit=limit)
    if message:
        return None, message
    if group_ids and groups_table is None:
        return None, 'Keyword groups are not available on this deployment'
    if group_ids:
        unknown = sorted(set(group_ids) - load_existing_group_ids(groups_table, group_ids))
        if unknown:
            return None, f"Unknown keyword group ids: {', '.join(unknown)}"
    return group_ids, None
