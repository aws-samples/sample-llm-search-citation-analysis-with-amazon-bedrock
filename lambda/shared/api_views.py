"""API views of stored rows: the fields every user-named item exposes.

Keyword groups (``manage-keyword-groups.py``) and research-agent templates
(``keyword-research.py``) are both rows a user names and may describe; their
API views open with the same three fields and then add their own.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


def named_item_view(item: Mapping[str, Any]) -> dict[str, Any]:
    """``id``, ``name`` and ``description`` of a row; the optional two default to ``''``."""
    return {
        'id': item['id'],
        'name': item.get('name', ''),
        'description': item.get('description', ''),
    }
