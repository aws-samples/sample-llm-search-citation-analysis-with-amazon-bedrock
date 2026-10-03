"""Fixtures for the saved custom reports API (``lambda/api/manage-custom-reports.py``)."""

from __future__ import annotations

import json
import os
import uuid
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from decimal import Decimal
from pathlib import Path
from types import ModuleType
from typing import Any
from unittest.mock import MagicMock, patch

from testing.dynamodb_stubs import fake_table
from testing.env import setdefault_env
from testing.events import api_gateway_event, parse_response
from testing.module_loader import load_handler_module_offline

CUSTOM_REPORTS_TABLE_NAME = 'test-custom-reports'
REPORT_ID = '0b9a3c52-2f4e-4d39-9a51-6f1f0f6c1a11'
FROZEN_TIMESTAMP = '2026-09-21T09:30:00Z'
CALLER_EMAIL = 'Analyst@Example.com'
CALLER_USERNAME = 'analyst@example.com'
YOUTUBE_LINK = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

_API_DIRECTORY = os.path.join(os.path.dirname(__file__), '..', 'api')
# Resolved first: test modules put `lambda/api/..`-style entries on sys.path,
# and `Path.parents` does not collapse `..` (see test_keyword_identity.py).
_BLOCK_VECTORS_PATH = Path(__file__).resolve().parents[2] / 'test-fixtures' / 'custom-report-blocks.json'
CUSTOM_REPORT_BLOCK_VECTORS: Mapping[str, list[dict[str, Any]]] = json.loads(
    _BLOCK_VECTORS_PATH.read_text(encoding='utf-8')
)

# A member of the plain Users group, signed in with an email alias.
CALLER_CLAIMS: Mapping[str, str] = {
    'cognito:username': CALLER_USERNAME,
    'email': CALLER_EMAIL,
    'cognito:groups': 'Users',
}


def load_custom_reports_module(module_name: str) -> ModuleType:
    """Load the hyphenated handler under ``module_name`` with its table env in place."""
    setdefault_env({'DYNAMODB_TABLE_CUSTOM_REPORTS': CUSTOM_REPORTS_TABLE_NAME})
    return load_handler_module_offline(_API_DIRECTORY, 'manage-custom-reports.py', module_name)


def vector_description(vector: Mapping[str, Any]) -> str:
    """pytest id of one ``custom-report-blocks.json`` vector."""
    return str(vector['description'])


# The shared link vectors, split by the outcome both runtimes must agree on.
EMBEDDABLE_VIDEO_LINKS = [vector for vector in CUSTOM_REPORT_BLOCK_VECTORS['videoUrls'] if vector['embed'] is not None]
UNEMBEDDABLE_VIDEO_LINKS = [vector for vector in CUSTOM_REPORT_BLOCK_VECTORS['videoUrls'] if vector['embed'] is None]
VALID_IMAGE_LINKS = [vector for vector in CUSTOM_REPORT_BLOCK_VECTORS['imageUrls'] if vector['valid']]
INVALID_IMAGE_LINKS = [vector for vector in CUSTOM_REPORT_BLOCK_VECTORS['imageUrls'] if not vector['valid']]


def custom_report_event(
    method: str,
    *,
    body: Any = None,
    report_id: str | None = None,
    claims: Mapping[str, Any] = CALLER_CLAIMS,
) -> dict[str, Any]:
    """A collection request, or an item request when ``report_id`` is given."""
    collection = '/api/custom-reports'
    if report_id is None:
        return api_gateway_event(method, collection, resource=collection, body=body, claims=claims)
    return api_gateway_event(
        method,
        f'{collection}/{report_id}',
        resource=f'{collection}/{{id}}',
        body=body,
        path_params={'id': report_id},
        claims=claims,
    )


def report_body(**overrides: Any) -> dict[str, Any]:
    """A valid create/replace body: one heading and one data block."""
    body: dict[str, Any] = {
        'title': 'Quarterly visibility',
        'blocks': [
            {'type': 'heading', 'text': 'Where we stand', 'level': 2},
            {'type': 'sentiment_headline'},
        ],
        'days': 30,
    }
    body.update(overrides)
    return body


def single_block_body(block: Mapping[str, Any]) -> dict[str, Any]:
    """A valid body whose only block is ``block``."""
    return report_body(blocks=[dict(block)])


def stored_report(**overrides: Any) -> dict[str, Any]:
    """A report row as DynamoDB returns it: numbers come back as ``Decimal``."""
    item: dict[str, Any] = {
        'id': REPORT_ID,
        'title': 'Quarterly visibility',
        'blocks': [
            {'type': 'heading', 'text': 'Where we stand', 'level': Decimal(2)},
            {'type': 'sentiment_headline'},
        ],
        'days': Decimal(30),
        'created_at': '2026-09-01T08:00:00Z',
        'created_by': 'author@example.com',
        'updated_at': '2026-09-02T08:00:00Z',
        'updated_by': 'editor@example.com',
    }
    item.update(overrides)
    return item


def report_rows(count: int) -> list[dict[str, Any]]:
    """``count`` id-only rows, the shape the create route's limit scan projects."""
    return [{'id': f'report-{index:02d}'} for index in range(count)]


@contextmanager
def frozen_report_clock(module: ModuleType) -> Iterator[None]:
    """Pin the handler's timestamp and generated id to ``FROZEN_TIMESTAMP`` / ``REPORT_ID``."""
    with (
        patch.object(module, 'get_timestamp', return_value=FROZEN_TIMESTAMP),
        patch.object(module.uuid, 'uuid4', return_value=uuid.UUID(REPORT_ID)),
    ):
        yield


def call_custom_reports(
    module: ModuleType,
    table: MagicMock,
    method: str,
    *,
    body: Any = None,
    report_id: str | None = None,
    claims: Mapping[str, Any] = CALLER_CLAIMS,
) -> tuple[int, Any]:
    """Send one request through the handler against ``table``; ``(status, decoded body)``."""
    event = custom_report_event(method, body=body, report_id=report_id, claims=claims)
    with patch.object(module, 'reports_table', table), frozen_report_clock(module):
        return parse_response(module.handler(event, None))


def create_report_for_test(
    module: ModuleType,
    body: Any,
    *,
    existing: int = 0,
    claims: Mapping[str, Any] = CALLER_CLAIMS,
) -> tuple[int, Any, MagicMock]:
    """POST ``body`` with ``existing`` reports already saved; ``(status, decoded body, table)``."""
    table = fake_table(scan={'Items': report_rows(existing)})
    status, response = call_custom_reports(module, table, 'POST', body=body, claims=claims)
    return status, response, table


def post_raw_body(module: ModuleType, raw_body: str) -> tuple[int, Any, MagicMock]:
    """POST a raw (possibly malformed) request body; ``(status, decoded body, table)``."""
    table = fake_table(scan={'Items': []})
    event = custom_report_event('POST')
    event['body'] = raw_body
    with patch.object(module, 'reports_table', table):
        status, response = parse_response(module.handler(event, None))
    return status, response, table
