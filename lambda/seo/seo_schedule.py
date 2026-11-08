"""The Admin route that turns a weekly paid snapshot sweep on or off (``PUT /api/seo/.../snapshots/schedule``).

Shared by the domain and backlink snapshots: Admin only, a JSON ``{"enabled": bool}`` body, and the choice stored
with who made it and when (``shared.snapshot_schedule``).
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from shared.api_response import success_response
from shared.auth import ADMIN_GROUP, get_caller_identity, require_group
from shared.decorators import json_object_body, validate
from shared.snapshot_schedule import SCHEDULE_SCHEMA
from shared.utils import get_timestamp

Handler = Callable[..., dict[str, Any]]


def schedule_setter(save: Callable[..., None]) -> Handler:
    """The route handler that calls ``save(enabled=, updated_by=, updated_at=)`` and answers ``{schedule_enabled}``."""

    @require_group(ADMIN_GROUP)
    @json_object_body
    @validate(SCHEDULE_SCHEMA)
    def handle_schedule(event: dict[str, Any], _context: Any, *, enabled: bool, **_request: Any) -> dict[str, Any]:
        save(enabled=enabled, updated_by=get_caller_identity(event), updated_at=get_timestamp())
        return success_response({'schedule_enabled': enabled}, event)

    return handle_schedule


__all__ = ['schedule_setter']
