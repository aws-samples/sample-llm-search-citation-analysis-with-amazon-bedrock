"""
Tests for manage-providers.py — the GET /providers health surface.

The provider-health pipeline is classify → persist → **surface** → render.
`shared/test_provider_health.py` proves the first two stages; the React specs
prove the last. Nothing proved the surface stage: `handle_get_providers` built
its response dict by hand and omitted every health field, so the
ProviderHealthBanner and the Settings badges — which render exclusively from
this endpoint — could never display anything. The 2026-08-14 incident fix
shipped dark (PR #103 review, blocker 1).

These tests pin the seam: the fields `record_provider_failure` writes to the
provider row must come back out of GET /providers, absent fields must stay
*absent* (the dashboard reads the presence of `last_error` as a live failure,
so `null` is not a safe stand-in), and DynamoDB's `Decimal` must not leak into
the JSON.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
from decimal import Decimal
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

_API_DIR = os.path.dirname(os.path.abspath(__file__))
_LAMBDA_DIR = os.path.dirname(_API_DIR)

# Make `from shared.xxx import` resolve (the layer puts shared/ at /opt/python/).
if _LAMBDA_DIR not in sys.path:
    sys.path.insert(0, _LAMBDA_DIR)

_ENV = {
    'CORS_ORIGIN_PARAM': '',
    'DYNAMODB_TABLE_PROVIDER_CONFIG': 'test-provider-config',
}

mock_secrets = MagicMock()
mock_table = MagicMock()
mock_dynamodb = MagicMock()
mock_dynamodb.Table.return_value = mock_table

_spec = importlib.util.spec_from_file_location(
    'manage_providers', os.path.join(_API_DIR, 'manage-providers.py')
)
_module = importlib.util.module_from_spec(_spec)

with patch('boto3.client', side_effect=lambda *a, **k: mock_secrets), \
     patch('boto3.resource', side_effect=lambda *a, **k: mock_dynamodb), \
     patch.dict(os.environ, _ENV):
    _spec.loader.exec_module(_module)

#: What `record_provider_failure` + `_disable_provider` leave on the row after
#: the 2026-08-14 outage reached the auto-disable threshold. `Decimal` because
#: that is what the boto3 resource layer actually returns for numbers.
CREDIT_EXHAUSTED_ROW = {
    'provider_id': 'claude',
    'enabled': False,
    'last_error': 'Your credit balance is too low to access the Anthropic API.',
    'last_error_at': '2026-08-19T10:00:00Z',
    'last_error_category': 'insufficient_credit',
    'last_success_at': '2026-08-13T22:15:00Z',
    'consecutive_failures': Decimal('3'),
    'auto_disabled': True,
    'disabled_reason': 'insufficient_credit',
    'updated_at': '2026-08-19T10:00:00Z',
}


def _serve_config_rows(rows: dict[str, dict[str, Any]]) -> None:
    """Answer `get_item` per provider: a row from `rows`, or no Item at all."""
    def get_item(**kwargs: Any) -> dict[str, Any]:
        provider_id = kwargs['Key']['provider_id']
        return {'Item': rows[provider_id]} if provider_id in rows else {}

    mock_table.get_item.side_effect = get_item


def _get_providers() -> tuple[int, dict[str, Any]]:
    """Call GET /providers as a group-less authenticated user; parse the response."""
    event = {
        'httpMethod': 'GET',
        'path': '/api/providers',
        'headers': {'origin': 'http://localhost:3000'},
        'requestContext': {
            'authorizer': {'claims': {'cognito:username': 'viewer@example.com'}}
        },
    }
    result = _module.handler(event, {})
    return result['statusCode'], json.loads(result['body'])


def _provider(body: dict[str, Any], provider_id: str) -> dict[str, Any]:
    matches = [p for p in body['providers'] if p['id'] == provider_id]
    assert matches != []
    return matches[0]


@pytest.fixture(autouse=True)
def _reset_mocks():
    """No secrets configured, no config rows, unless a test says otherwise."""
    mock_secrets.reset_mock(side_effect=True)
    mock_table.reset_mock(side_effect=True)
    mock_secrets.get_secret_value.side_effect = ClientError(
        {'Error': {'Code': 'ResourceNotFoundException'}}, 'GetSecretValue'
    )
    _serve_config_rows({})


class TestGetProvidersSurfacesHealth:
    """The response half of the health pipeline: row fields must reach the wire."""

    def test_returns_the_health_fields_recorded_on_the_provider_row(self):
        _serve_config_rows({'claude': CREDIT_EXHAUSTED_ROW})

        _, body = _get_providers()

        claude = _provider(body, 'claude')
        expected = {
            'last_error': 'Your credit balance is too low to access the Anthropic API.',
            'last_error_at': '2026-08-19T10:00:00Z',
            'last_error_category': 'insufficient_credit',
            'last_success_at': '2026-08-13T22:15:00Z',
            'consecutive_failures': 3,
            'auto_disabled': True,
            'disabled_reason': 'insufficient_credit',
        }
        assert {field: claude.get(field) for field in expected} == expected

    def test_serialises_consecutive_failures_as_an_integer(self):
        """
        boto3 hands the counter back as `Decimal('3')`; the generic encoder
        would render it `3.0`. The dashboard types it as a count, so it must
        arrive as `3`.
        """
        _serve_config_rows({'claude': CREDIT_EXHAUSTED_ROW})

        _, body = _get_providers()

        assert _provider(body, 'claude')['consecutive_failures'] == 3
        assert isinstance(_provider(body, 'claude')['consecutive_failures'], int)

    def test_returns_only_the_base_status_shape_when_a_provider_never_recorded_health(self):
        """
        Absence, not `null`: the dashboard's `hasFailure` reads the presence of
        `last_error` as a live failure, and `describeProviderHealth` reads the
        presence of `last_success_at` as "has run". A provider with no health
        history must therefore carry none of the keys at all.
        """
        _, body = _get_providers()

        assert _provider(body, 'gemini') == {
            'id': 'gemini',
            'name': 'Google Gemini',
            'description': 'Gemini Flash with Google Search grounding',
            'model': 'gemini-3-flash-preview',
            'docs_url': 'https://aistudio.google.com/apikey',
            'type': 'llm',
            'enabled': True,
            'configured': False,
            'masked_key': None,
            'last_updated': None,
        }

    def test_omits_health_fields_a_legacy_success_wrote_as_null(self):
        """
        `record_provider_success` used to SET `last_error = None`, which stores
        a DynamoDB NULL. Rows written by that version must not resurface the
        null through the API — JSON `null` would render a healthy provider as
        "Provider returned an unrecognised error".
        """
        _serve_config_rows({'openai': {
            'provider_id': 'openai',
            'enabled': True,
            'last_error': None,
            'last_error_category': None,
            'last_success_at': '2026-08-19T09:00:00Z',
        }})

        _, body = _get_providers()

        openai = _provider(body, 'openai')
        assert openai['last_success_at'] == '2026-08-19T09:00:00Z'
        assert 'last_error' not in openai
        assert 'last_error_category' not in openai

    def test_reports_health_to_a_caller_without_the_admin_group(self):
        """
        GET /providers is deliberately ungated: the health banner must be able
        to warn every signed-in user, not only administrators. The caller in
        `_get_providers` carries no group claim at all.
        """
        _serve_config_rows({'claude': CREDIT_EXHAUSTED_ROW})

        status, body = _get_providers()

        assert status == 200
        assert _provider(body, 'claude')['last_error_category'] == 'insufficient_credit'
