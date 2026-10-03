"""Requests and checks shared by the ``promote-keywords.py`` suites."""

from __future__ import annotations

import json
from types import ModuleType
from typing import Any
from unittest.mock import MagicMock, patch

from testing.events import api_gateway_event, parse_response

PROMOTE_PATH = '/api/keywords/promote'


def promotion_event(body: object) -> dict[str, Any]:
    """``POST /api/keywords/promote`` whose body is ``body`` JSON-encoded, ``None`` included (``'null'``)."""
    return {**api_gateway_event('POST', PROMOTE_PATH, headers={}), 'body': json.dumps(body)}


def invoke_promotion(module: ModuleType, table: MagicMock, body: object) -> tuple[int, Any]:
    """Promote ``body`` with ``table`` as the Keywords table; returns ``(status, decoded body)``."""
    with patch.object(module, 'keywords_table', table):
        return parse_response(module.handler(promotion_event(body), None))


def assert_rejected_before_dynamodb(table: MagicMock) -> None:
    """The request never reached the Keywords table: no read, no write."""
    table.scan.assert_not_called()
    table.put_item.assert_not_called()
