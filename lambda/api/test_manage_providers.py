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

import json
import logging
import os
import sys
from collections.abc import Iterator
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from testing.module_loader import load_handler_module

_ENV = {
    'CORS_ORIGIN_PARAM': '',
    'DYNAMODB_TABLE_PROVIDER_CONFIG': 'test-provider-config',
}

mock_secrets = MagicMock()
mock_table = MagicMock()
mock_dynamodb = MagicMock()
mock_dynamodb.Table.return_value = mock_table

with patch('boto3.client', side_effect=lambda *a, **k: mock_secrets), \
     patch('boto3.resource', side_effect=lambda *a, **k: mock_dynamodb), \
     patch.dict(os.environ, _ENV):
    _module = load_handler_module(os.path.dirname(__file__), 'manage-providers.py', 'manage_providers')

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
            'description': 'Google Search grounding',
            'model': 'gemini-3-flash-preview',
            'default_model': 'gemini-3-flash-preview',
            'model_configurable': True,
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


def _put_provider(provider_id: str, body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    """Call PUT /providers/{id} as an administrator; return status and parsed body."""
    event = {
        'httpMethod': 'PUT',
        'path': f'/api/providers/{provider_id}',
        'pathParameters': {'id': provider_id},
        'headers': {'origin': 'http://localhost:3000'},
        'body': json.dumps(body),
        'requestContext': {
            'authorizer': {'claims': {
                'cognito:username': 'admin@example.com',
                'cognito:groups': 'Admin',
            }}
        },
    }
    result = _module.handler(event, {})
    return result['statusCode'], json.loads(result['body'])


def _only_update() -> dict[str, Any]:
    """The keyword arguments of the single `update_item` the toggle issued."""
    assert mock_table.update_item.call_count == 1
    return mock_table.update_item.call_args.kwargs


class TestToggleKeepsTheRestOfTheRow:
    """
    PUT /providers/{id} with `enabled` used to `put_item` a fresh row holding
    only `enabled`/`updated_at`, silently erasing the health record (and any
    configured model) on every toggle in Settings.
    """

    def test_never_replaces_the_provider_row(self):
        _put_provider('claude', {'enabled': False})

        assert mock_table.put_item.call_args_list == []

    def test_disabling_sets_only_the_flag_and_timestamp(self):
        _put_provider('claude', {'enabled': False})

        assert _only_update()['UpdateExpression'] == 'SET enabled = :enabled, updated_at = :ts'

    def test_disabling_targets_the_provider_row(self):
        _put_provider('claude', {'enabled': False})

        update = _only_update()
        assert update['Key'] == {'provider_id': 'claude'}
        assert update['ExpressionAttributeValues'][':enabled'] is False

    def test_stamps_the_write_with_the_current_time(self):
        with patch.object(_module, 'get_timestamp', return_value='2026-09-28T12:00:00Z'):
            _put_provider('claude', {'enabled': False})

        assert _only_update()['ExpressionAttributeValues'] == {
            ':enabled': False,
            ':ts': '2026-09-28T12:00:00Z',
        }

    def test_enabling_clears_the_auto_disable_record_and_restarts_the_streak(self):
        """
        Re-enabling is the administrator's "fixed it" decision. Keeping the
        retained streak of 3 would let the next terminal failure switch the
        provider straight back off.
        """
        _put_provider('claude', {'enabled': True})

        assert _only_update()['UpdateExpression'] == (
            'SET enabled = :enabled, updated_at = :ts, consecutive_failures = :zero '
            'REMOVE auto_disabled, disabled_reason, disabled_at'
        )

    def test_enabling_keeps_the_last_error_until_a_success_clears_it(self):
        _put_provider('claude', {'enabled': True})

        update = _only_update()
        assert 'last_error' not in update['UpdateExpression']
        assert update['ExpressionAttributeValues'][':zero'] == 0

    def test_answers_500_when_the_write_fails(self):
        mock_table.update_item.side_effect = ClientError(
            {'Error': {'Code': 'ProvisionedThroughputExceededException'}}, 'UpdateItem'
        )

        assert _put_provider('claude', {'enabled': False}) == (500, {'error': 'Failed to save configuration'})


class ProbeTimeout(Exception):
    """Stands in for ``requests.Timeout``."""


@pytest.fixture
def requests_stub() -> Iterator[MagicMock]:
    """A stand-in ``requests`` module answering every probe with a 200.

    The real library ships in the Lambda layer, not the dev venv, and
    `validate_api_key` imports it lazily — so the stub only has to be in
    `sys.modules` while the probe runs.
    """
    request = MagicMock(name='requests.request', return_value=MagicMock(status_code=200))
    stub = SimpleNamespace(request=request, Timeout=ProbeTimeout)
    with patch.dict(sys.modules, {'requests': stub}):
        yield request


class TestKeyProbeTimeouts:
    """
    Every outbound key probe is bounded. Without a timeout a stalled provider
    would hold the Lambda for its whole duration, and API Gateway would answer
    the administrator with a 504 while the probe kept running.
    """

    @pytest.mark.parametrize(('provider_id', 'timeout'), [
        ('openai', 5),
        ('gemini', 5),
        ('brave', 5),
        ('tavily', 5),
        ('exa', 5),
        ('serpapi', 5),
        ('perplexity', 10),
        ('claude', 10),
        ('firecrawl', 10),
    ])
    def test_sends_the_probe_with_the_providers_timeout(self, requests_stub, provider_id, timeout):
        _module.validate_api_key(provider_id, 'sk-test-key-1234')

        assert requests_stub.call_args.kwargs['timeout'] == timeout

    def test_covers_every_listed_provider(self):
        assert set(_module._KEY_PROBES) == set(_module.PROVIDERS)

    def test_reports_a_timed_out_probe_as_invalid_without_raising(self, requests_stub):
        requests_stub.side_effect = ProbeTimeout()

        assert _module.validate_api_key('claude', 'sk-test-key-1234') == {
            'valid': False,
            'error': 'Validation request timed out',
        }



# --- Model selection (2.17.0) -------------------------------------------------

def _store_key(api_key: str = 'sk-stored-key-1234') -> None:
    """Every secret read answers with ``api_key``."""
    mock_secrets.get_secret_value.side_effect = None
    mock_secrets.get_secret_value.return_value = {'SecretString': json.dumps({'api_key': api_key})}


def _reply(status: int, payload: Any = None) -> MagicMock:
    """An HTTP response carrying ``status`` and a JSON ``payload``."""
    response = MagicMock(status_code=status)
    response.json.return_value = payload
    return response


def _list_models(provider_id: str, groups: str = 'Admin') -> tuple[int, dict[str, Any]]:
    """Call GET /providers/{id}/models; return status and parsed body."""
    event = {
        'httpMethod': 'GET',
        'path': f'/api/providers/{provider_id}/models',
        'pathParameters': {'id': provider_id},
        'headers': {'origin': 'http://localhost:3000'},
        'requestContext': {
            'authorizer': {'claims': {'cognito:username': 'admin@example.com', 'cognito:groups': groups}}
        },
    }
    result = _module.handler(event, {})
    return result['statusCode'], json.loads(result['body'])


class TestGetProvidersReportsTheModel:
    """GET /providers tells Settings which model a run will actually use."""

    def test_reports_the_configured_model_and_when_it_changed(self):
        _serve_config_rows({'openai': {
            'provider_id': 'openai', 'model': 'gpt-5.2', 'model_updated_at': '2026-09-28T10:00:00Z',
        }})

        _, body = _get_providers()

        openai = _provider(body, 'openai')
        assert {key: openai.get(key) for key in ('model', 'default_model', 'model_configurable', 'model_updated_at')} == {
            'model': 'gpt-5.2',
            'default_model': 'gpt-5-mini',
            'model_configurable': True,
            'model_updated_at': '2026-09-28T10:00:00Z',
        }

    def test_reports_a_stored_claude_model_as_configurable(self):
        _serve_config_rows({'claude': {'provider_id': 'claude', 'model': 'claude-opus-4-7'}})

        _, body = _get_providers()

        assert (_provider(body, 'claude')['model'], _provider(body, 'claude')['model_configurable']) == (
            'claude-opus-4-7', True,
        )

    def test_reports_perplexity_as_configurable_with_its_default(self):
        _, body = _get_providers()

        assert (_provider(body, 'perplexity')['model'], _provider(body, 'perplexity')['model_configurable']) == (
            'sonar', True,
        )

    def test_keeps_the_static_label_for_a_search_provider(self):
        _, body = _get_providers()

        brave = _provider(body, 'brave')
        assert {key: brave.get(key) for key in ('model', 'default_model', 'model_configurable')} == {
            'model': 'web-search', 'default_model': None, 'model_configurable': False,
        }


class TestUpdateModel:
    """PUT /providers/{id} with `model`: prove it answers, then store it."""

    def test_stores_a_model_that_answered_the_check(self, requests_stub):
        _store_key()

        with patch.object(_module, 'get_timestamp', return_value='2026-09-28T12:00:00Z'):
            status, _ = _put_provider('gemini', {'model': 'gemini-2.5-pro'})

        assert status == 200
        assert _only_update() == {
            'Key': {'provider_id': 'gemini'},
            'UpdateExpression': 'SET model = :model, model_updated_at = :ts, updated_at = :ts',
            'ExpressionAttributeValues': {':model': 'gemini-2.5-pro', ':ts': '2026-09-28T12:00:00Z'},
        }

    def test_checks_openai_with_the_exact_web_search_payload_runs_send(self, requests_stub):
        _store_key('sk-stored-key-1234')

        _put_provider('openai', {'model': 'gpt-5.2'})

        assert requests_stub.call_args.kwargs == {
            'timeout': 20,
            'method': 'post',
            'url': 'https://api.openai.com/v1/responses',
            'headers': {'Authorization': 'Bearer sk-stored-key-1234', 'Content-Type': 'application/json'},
            'json': {
                'model': 'gpt-5.2',
                'tools': [{'type': 'web_search_preview'}],
                'tool_choice': 'auto',
                'include': ['web_search_call.action.sources'],
                'input': 'Reply with the single word OK.',
            },
        }

    def test_checks_gemini_against_the_models_own_grounded_endpoint(self, requests_stub):
        _store_key('gm-stored-key-1234')

        _put_provider('gemini', {'model': 'gemini-2.5-pro'})

        kwargs = requests_stub.call_args.kwargs
        assert (kwargs['url'], kwargs['headers']['x-goog-api-key'], kwargs['json']['tools']) == (
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent',
            'gm-stored-key-1234',
            [{'googleSearch': {}}],
        )

    def test_checks_perplexity_with_the_sonar_chat_body_runs_send(self, requests_stub):
        _store_key('pplx-stored-key-1234')

        _put_provider('perplexity', {'model': 'sonar-pro'})

        assert requests_stub.call_args.kwargs == {
            'timeout': 20,
            'method': 'post',
            'url': 'https://api.perplexity.ai/chat/completions',
            'headers': {'Authorization': 'Bearer pplx-stored-key-1234', 'Content-Type': 'application/json'},
            'json': {
                'model': 'sonar-pro',
                'messages': [{'role': 'user', 'content': 'Reply with the single word OK.'}],
            },
        }

    def test_checks_claude_with_the_web_search_tool_runs_send(self, requests_stub):
        _store_key('sk-ant-stored-1234')

        _put_provider('claude', {'model': 'claude-sonnet-4-6'})

        assert requests_stub.call_args.kwargs == {
            'timeout': 20,
            'method': 'post',
            'url': 'https://api.anthropic.com/v1/messages',
            'headers': {'x-api-key': 'sk-ant-stored-1234', 'anthropic-version': '2023-06-01', 'content-type': 'application/json'},
            'json': {
                'model': 'claude-sonnet-4-6',
                'max_tokens': 64,
                'messages': [{'role': 'user', 'content': 'Reply with the single word OK.'}],
                'tools': [{'type': 'web_search_20250305', 'name': 'web_search', 'max_uses': 1}],
            },
        }

    def test_refuses_a_claude_model_without_web_search_and_stores_nothing(self, requests_stub):
        _store_key()
        requests_stub.return_value = _reply(400, {
            'type': 'error', 'error': {'type': 'invalid_request_error', 'message': 'web_search is not supported on this model'},
        })

        status, body = _put_provider('claude', {'model': 'claude-3-haiku-20240307'})

        assert (status, body['details'], mock_table.update_item.call_args_list) == (
            400, 'web_search is not supported on this model', [],
        )

    def test_refuses_a_model_the_provider_rejects_and_stores_nothing(self, requests_stub):
        _store_key()
        requests_stub.return_value = _reply(400, {'error': {'message': "Tool 'web_search_preview' is not supported with gpt-3.5-turbo."}})

        status, body = _put_provider('openai', {'model': 'gpt-3.5-turbo'})

        assert (status, body) == (400, {
            'error': 'Model check failed',
            'details': "Tool 'web_search_preview' is not supported with gpt-3.5-turbo.",
        })
        assert mock_table.update_item.call_args_list == []

    def test_reports_a_rejected_key_rather_than_a_bad_model(self, requests_stub):
        _store_key()
        requests_stub.return_value = _reply(401, {'error': {'message': 'Incorrect API key provided'}})

        _, body = _put_provider('openai', {'model': 'gpt-5.2'})

        assert body['details'] == 'The stored API key was rejected'

    def test_reports_the_status_when_the_provider_gives_no_reason(self, requests_stub):
        _store_key()
        requests_stub.return_value = _reply(500, 'not json')

        _, body = _put_provider('openai', {'model': 'gpt-5.2'})

        assert body['details'] == 'Unexpected status 500'

    @pytest.mark.parametrize('model', ['gemini-2.5-pro:streamGenerateContent', '../../v1/files', 'model id', 'x' * 101, 7])
    def test_refuses_an_id_that_is_not_a_safe_model_id(self, requests_stub, model):
        """The id is interpolated into Gemini's URL path; nothing but a plain id may get there."""
        _store_key()

        status, body = _put_provider('gemini', {'model': model})

        assert (status, body.get('field'), requests_stub.call_args_list) == (400, 'model', [])

    @pytest.mark.parametrize('model', [None, '', '   ', 'gpt-5-mini'])
    def test_returns_to_the_default_by_removing_the_override(self, requests_stub, model):
        """Blank, null or the default itself store no id, so a future default moves this provider too."""
        status, _ = _put_provider('openai', {'model': model})

        assert (status, _only_update()['UpdateExpression'], requests_stub.call_args_list) == (
            200, 'SET model_updated_at = :ts, updated_at = :ts REMOVE model', [],
        )

    def test_refuses_to_change_a_provider_without_a_model(self, requests_stub):
        status, body = _put_provider('brave', {'model': 'claude-opus-9'})

        assert (status, body.get('field'), mock_table.update_item.call_args_list) == (400, 'model', [])

    def test_asks_for_a_key_before_a_model_can_be_checked(self, requests_stub):
        status, body = _put_provider('openai', {'model': 'gpt-5.2'})

        assert (status, body.get('error'), requests_stub.call_args_list) == (
            400, 'Configure an API key before choosing a model', [],
        )

    def test_stores_without_the_check_when_validation_is_switched_off(self, requests_stub):
        status, _ = _put_provider('openai', {'model': 'gpt-5.2', 'validate': False})

        assert (status, _only_update()['ExpressionAttributeValues'][':model'], requests_stub.call_args_list) == (
            200, 'gpt-5.2', [],
        )

    def test_answers_500_when_the_model_cannot_be_saved(self, requests_stub):
        _store_key()
        mock_table.update_item.side_effect = ClientError({'Error': {'Code': 'InternalServerError'}}, 'UpdateItem')

        assert _put_provider('openai', {'model': 'gpt-5.2'}) == (500, {'error': 'Failed to save model'})

    def test_reports_the_model_now_in_effect(self, requests_stub):
        _store_key()
        _serve_config_rows({'openai': {'provider_id': 'openai', 'model': 'gpt-5.2'}})

        _, body = _put_provider('openai', {'model': 'gpt-5.2'})

        assert (body['model'], body['default_model']) == ('gpt-5.2', 'gpt-5-mini')


OPENAI_LISTING = {'data': [
    {'id': 'gpt-4.1', 'created': 1_700_000_000},
    {'id': 'gpt-5.2', 'created': 1_760_000_000},
    {'id': 'o4-mini', 'created': 1_740_000_000},
    {'id': 'gpt-4o-audio-preview', 'created': 1_750_000_000},
    {'id': 'gpt-4o-search-preview', 'created': 1_750_000_000},
    {'id': 'gpt-realtime', 'created': 1_750_000_000},
    {'id': 'text-embedding-3-large', 'created': 1_750_000_000},
    {'id': 'dall-e-3', 'created': 1_750_000_000},
    {'id': 'omni-moderation-latest', 'created': 1_750_000_000},
    {'id': 'gpt-5-mini'},
]}

GEMINI_LISTING = {'models': [
    {'name': 'models/gemini-3-flash-preview', 'supportedGenerationMethods': ['generateContent', 'countTokens']},
    {'name': 'models/gemini-2.5-pro', 'supportedGenerationMethods': ['generateContent']},
    {'name': 'models/gemini-embedding-001', 'supportedGenerationMethods': ['embedContent']},
    {'name': 'models/gemini-2.5-flash-preview-tts', 'supportedGenerationMethods': ['generateContent']},
    {'name': 'models/gemini-2.0-flash-live-001', 'supportedGenerationMethods': ['bidiGenerateContent']},
    {'name': 'models/gemma-3-27b-it', 'supportedGenerationMethods': ['generateContent']},
    {'name': 'models/imagen-4.0-generate-001', 'supportedGenerationMethods': ['predict']},
]}

CLAUDE_LISTING = {'data': [
    {'type': 'model', 'id': 'claude-opus-4-7', 'display_name': 'Claude Opus 4.7'},
    {'type': 'model', 'id': 'claude-sonnet-4-6', 'display_name': 'Claude Sonnet 4.6'},
    {'type': 'model', 'id': 'claude-haiku-4-5-20251001', 'display_name': 'Claude Haiku 4.5'},
    {'type': 'model', 'id': 'claude-3-7-sonnet-20250219', 'display_name': 'Claude Sonnet 3.7'},
    {'type': 'model', 'id': 'claude-3-haiku-20240307', 'display_name': 'Claude Haiku 3'},
    {'type': 'model', 'id': 'not-a-claude-model'},
    {'type': 'model', 'id': 'claude-bad id'},
    'not an entry',
], 'has_more': False}


class TestListModels:
    """GET /providers/{id}/models feeds the Settings picker from the stored key."""

    def test_offers_openai_answer_models_newest_first(self, requests_stub):
        _store_key()
        requests_stub.return_value = _reply(200, OPENAI_LISTING)

        status, body = _list_models('openai')

        assert (status, body['models']) == (200, ['gpt-5.2', 'o4-mini', 'gpt-4.1', 'gpt-5-mini'])

    def test_offers_gemini_models_that_can_generate_content(self, requests_stub):
        _store_key()
        requests_stub.return_value = _reply(200, GEMINI_LISTING)

        _, body = _list_models('gemini')

        assert body['models'] == ['gemini-3-flash-preview', 'gemini-2.5-pro']

    def test_asks_gemini_for_the_whole_list_in_one_page(self, requests_stub):
        _store_key('gm-stored-key-1234')
        requests_stub.return_value = _reply(200, GEMINI_LISTING)

        _list_models('gemini')

        kwargs = requests_stub.call_args.kwargs
        assert (kwargs['url'], kwargs['params'], kwargs['headers']) == (
            'https://generativelanguage.googleapis.com/v1beta/models',
            {'pageSize': 1000},
            {'x-goog-api-key': 'gm-stored-key-1234'},
        )

    def test_reports_the_model_in_effect_alongside_the_list(self, requests_stub):
        _store_key()
        _serve_config_rows({'openai': {'provider_id': 'openai', 'model': 'gpt-5.2'}})
        requests_stub.return_value = _reply(200, OPENAI_LISTING)

        _, body = _list_models('openai')

        assert (body['id'], body['model'], body['default_model']) == ('openai', 'gpt-5.2', 'gpt-5-mini')

    def test_answers_502_with_the_providers_reason_when_listing_fails(self, requests_stub):
        _store_key()
        requests_stub.return_value = _reply(429, {'error': {'message': 'Rate limit reached'}})

        assert _list_models('openai') == (502, {'error': 'Could not list models', 'details': 'Rate limit reached'})

    def test_answers_502_when_the_listing_is_not_json(self, requests_stub):
        _store_key()
        response = _reply(200)
        response.json.side_effect = ValueError('no json')
        requests_stub.return_value = response

        assert _list_models('gemini')[1]['details'] == 'Invalid response format'

    def test_offers_nothing_from_a_listing_without_a_model_list(self, requests_stub):
        _store_key()
        requests_stub.return_value = _reply(200, {'object': 'list'})

        assert _list_models('openai')[1]['models'] == []

    def test_offers_claude_4_and_later_in_the_apis_order(self, requests_stub):
        _store_key()
        requests_stub.return_value = _reply(200, CLAUDE_LISTING)

        assert _list_models('claude')[1]['models'] == ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001']

    def test_asks_anthropic_for_the_whole_list_in_one_page(self, requests_stub):
        _store_key('sk-ant-stored-1234')
        requests_stub.return_value = _reply(200, CLAUDE_LISTING)

        _list_models('claude')

        kwargs = requests_stub.call_args.kwargs
        assert (kwargs['method'], kwargs['url'], kwargs['params'], kwargs['headers']) == (
            'get',
            'https://api.anthropic.com/v1/models',
            {'limit': 1000},
            {'x-api-key': 'sk-ant-stored-1234', 'anthropic-version': '2023-06-01', 'content-type': 'application/json'},
        )

    def test_offers_the_sonar_models_without_calling_perplexity(self, requests_stub):
        _store_key()

        status, body = _list_models('perplexity')

        assert (status, body['models'], requests_stub.call_args_list) == (
            200, ['sonar', 'sonar-pro', 'sonar-reasoning-pro'], [],
        )

    def test_asks_for_a_key_before_listing(self, requests_stub):
        status, body = _list_models('gemini')

        assert (status, body['error'], requests_stub.call_args_list) == (
            400, 'Configure an API key before choosing a model', [],
        )

    def test_refuses_a_provider_without_a_model(self, requests_stub):
        _store_key()

        assert _list_models('brave')[0] == 400

    def test_refuses_a_caller_outside_the_admin_group(self, requests_stub):
        _store_key()

        assert (_list_models('openai', groups='Viewer')[0], requests_stub.call_args_list) == (403, [])



class TestStoredKeys:
    """The masked key on the card and the uncached key the model check uses."""

    def test_masks_the_stored_key_on_the_provider_card(self):
        _store_key('sk-stored-key-1234')

        _, body = _get_providers()

        assert _provider(body, 'openai')['masked_key'] == 'sk-s...1234'

    @pytest.mark.parametrize('response', [{'SecretString': '{}'}, {'SecretBinary': b'binary'}])
    def test_reads_no_key_from_a_secret_without_one(self, response):
        mock_secrets.get_secret_value.side_effect = None
        mock_secrets.get_secret_value.return_value = response

        assert _module.stored_api_key('citation-analysis/openai-key') == ''

    def test_reads_no_key_quietly_when_the_secret_does_not_exist(self, caplog):
        with caplog.at_level(logging.ERROR):
            assert _module.stored_api_key('citation-analysis/openai-key') == ''

        assert caplog.records == []

    def test_logs_a_secret_read_that_failed_for_another_reason(self, caplog):
        mock_secrets.get_secret_value.side_effect = ClientError({'Error': {'Code': 'AccessDeniedException'}}, 'GetSecretValue')

        with caplog.at_level(logging.ERROR):
            assert _module.stored_api_key('citation-analysis/openai-key') == ''

        assert [record.getMessage() for record in caplog.records] == ['Error reading API key']


class TestUpdateApiKey:
    """PUT /providers/{id} with `api_key` (moved into `_apply_api_key` in 2.17.0)."""

    def test_stores_a_key_the_provider_accepted(self, requests_stub):
        requests_stub.return_value = _reply(200, {'data': []})

        status, _ = _put_provider('openai', {'api_key': '  sk-new-key-5678  '})

        assert (status, mock_secrets.put_secret_value.call_args.kwargs) == (200, {
            # The prefix comes from SECRETS_PREFIX at import, which other suites set.
            'SecretId': _module.PROVIDERS['openai']['secret_name'],
            'SecretString': json.dumps({'api_key': 'sk-new-key-5678'}),
        })
        assert _module.PROVIDERS['openai']['secret_name'].endswith('openai-key')

    def test_checks_the_key_by_default(self, requests_stub):
        _put_provider('openai', {'api_key': 'sk-new-key-5678'})

        assert requests_stub.call_args.kwargs['url'] == 'https://api.openai.com/v1/models'

    def test_refuses_a_key_the_provider_rejects(self, requests_stub):
        requests_stub.return_value = _reply(401)

        assert _put_provider('openai', {'api_key': 'sk-bad-key-5678'}) == (400, {
            'error': 'Invalid API key', 'details': 'Invalid API key',
        })

    def test_stores_without_the_check_when_validation_is_switched_off(self, requests_stub):
        _put_provider('openai', {'api_key': 'sk-new-key-5678', 'validate': False})

        assert (requests_stub.call_args_list, mock_secrets.put_secret_value.call_count) == ([], 1)

    @pytest.mark.parametrize(('length', 'status'), [(500, 200), (501, 400)])
    def test_accepts_keys_up_to_500_characters(self, requests_stub, length, status):
        assert _put_provider('openai', {'api_key': 'k' * length, 'validate': False})[0] == status

    def test_names_the_reason_a_key_is_too_long(self, requests_stub):
        assert _put_provider('openai', {'api_key': 'k' * 501})[1] == {'error': 'API key too long'}

    def test_answers_500_when_the_key_cannot_be_stored(self, requests_stub):
        requests_stub.return_value = _reply(200, {'data': []})
        mock_secrets.put_secret_value.side_effect = ClientError({'Error': {'Code': 'InternalServiceError'}}, 'PutSecretValue')

        assert _put_provider('openai', {'api_key': 'sk-new-key-5678'}) == (500, {'error': 'Failed to update API key'})

    def test_stops_before_the_model_when_the_key_is_refused(self, requests_stub):
        status, body = _put_provider('openai', {'api_key': 'k' * 501, 'model': 'gpt-5.2'})

        assert (status, body, mock_table.update_item.call_args_list) == (400, {'error': 'API key too long'}, [])

    def test_reports_the_masked_key_after_an_update(self, requests_stub):
        _store_key('sk-stored-key-1234')

        assert _put_provider('openai', {'enabled': True})[1]['masked_key'] == 'sk-s...1234'


class TestModelChecksAndListingsInDetail:
    """The verdicts `validate_model` / `list_models` return, beyond what the routes show."""

    def test_accepts_a_model_that_answered(self, requests_stub):
        assert _module.validate_model('openai', 'sk-test', 'gpt-5.2') == {'valid': True}

    @pytest.mark.parametrize('status', [401, 403])
    def test_blames_the_key_when_the_provider_refuses_it(self, requests_stub, status):
        requests_stub.return_value = _reply(status, {'error': {'message': 'nope'}})

        assert _module.validate_model('openai', 'sk-test', 'gpt-5.2') == {
            'valid': False, 'error': 'The stored API key was rejected',
        }

    def test_passes_on_the_providers_reason_for_an_unknown_model(self, requests_stub):
        requests_stub.return_value = _reply(404, {'error': {'message': 'models/gemini-9 is not found'}})

        assert _module.validate_model('gemini', 'gm-test', 'gemini-9') == {
            'valid': False, 'error': 'models/gemini-9 is not found',
        }

    def test_truncates_the_providers_reason_to_300_characters(self, requests_stub):
        requests_stub.return_value = _reply(400, {'error': {'message': 'x' * 400}})

        assert _module.validate_model('openai', 'sk-test', 'gpt-5.2')['error'] == 'x' * 300

    def test_falls_back_to_the_status_when_the_reason_is_not_text(self, requests_stub):
        requests_stub.return_value = _reply(400, {'error': {'message': 5}})

        assert _module.validate_model('openai', 'sk-test', 'gpt-5.2')['error'] == 'Unexpected status 400'

    def test_sends_gemini_the_json_headers(self, requests_stub):
        _module.validate_model('gemini', 'gm-test', 'gemini-2.5-pro')

        assert requests_stub.call_args.kwargs['headers'] == {'x-goog-api-key': 'gm-test', 'Content-Type': 'application/json'}

    def test_reports_a_refused_listing_as_invalid(self, requests_stub):
        requests_stub.return_value = _reply(500, 'not json')

        assert _module.list_models('openai', 'sk-test') == {'valid': False, 'error': 'Unexpected status 500'}

    def test_reports_a_listing_that_is_not_json_as_invalid(self, requests_stub):
        response = _reply(200)
        response.json.side_effect = ValueError('no json')
        requests_stub.return_value = response

        assert _module.list_models('openai', 'sk-test') == {'valid': False, 'error': 'Invalid response format'}

    def test_keeps_one_letter_o_series_ids_and_skips_a_bare_o(self, requests_stub):
        requests_stub.return_value = _reply(200, {'data': [{'id': 'o'}, {'id': 'o3', 'created': 5}, {'id': 'omni-x'}]})

        assert _module.list_models('openai', 'sk-test') == {'valid': True, 'models': ['o3']}

    def test_orders_models_without_a_date_as_the_oldest(self, requests_stub):
        requests_stub.return_value = _reply(200, {'data': [{'id': 'gpt-b'}, {'id': 'gpt-a', 'created': 0}]})

        assert _module.list_models('openai', 'sk-test')['models'] == ['gpt-a', 'gpt-b']

    def test_skips_gemini_entries_that_are_not_models(self, requests_stub):
        requests_stub.return_value = _reply(200, {'models': [
            'gemini-2.5-pro',
            {'supportedGenerationMethods': ['generateContent']},
            {'name': 'models/gemini-2.5-pro', 'supportedGenerationMethods': ['generateContent']},
        ]})

        assert _module.list_models('gemini', 'gm-test') == {'valid': True, 'models': ['gemini-2.5-pro']}

    @pytest.mark.parametrize('model_id', [
        'gpt-4o-audio-preview', 'gpt-realtime', 'gpt-4o-transcribe', 'gpt-4o-mini-tts',
        'gpt-image-1', 'gpt-4o-search-preview', 'gpt-3.5-turbo-instruct',
    ])
    def test_leaves_openai_models_that_cannot_answer_out_of_the_picker(self, requests_stub, model_id):
        requests_stub.return_value = _reply(200, {'data': [{'id': model_id}, {'id': 'gpt-5.2'}]})

        assert _module.list_models('openai', 'sk-test')['models'] == ['gpt-5.2']

    @pytest.mark.parametrize('model_id', [
        'gemini-embedding-exp', 'gemini-2.5-flash-preview-tts', 'gemini-2.5-flash-image',
        'gemini-live-2.5-flash', 'gemini-2.5-flash-native-audio',
    ])
    def test_leaves_gemini_models_that_cannot_answer_out_of_the_picker(self, requests_stub, model_id):
        requests_stub.return_value = _reply(200, {'models': [
            {'name': f'models/{model_id}', 'supportedGenerationMethods': ['generateContent']},
            {'name': 'models/gemini-2.5-pro', 'supportedGenerationMethods': ['generateContent']},
        ]})

        assert _module.list_models('gemini', 'gm-test')['models'] == ['gemini-2.5-pro']

    def test_falls_back_to_the_status_when_an_error_body_is_not_json(self, requests_stub):
        response = _reply(502)
        response.json.side_effect = ValueError('no json')
        requests_stub.return_value = response

        assert _module.validate_model('openai', 'sk-test', 'gpt-5.2')['error'] == 'Unexpected status 502'

    @pytest.mark.parametrize(('call', 'label'), [
        (lambda: _module.validate_api_key('openai', 'sk-test'), 'API key validation for openai'),
        (lambda: _module.validate_model('gemini', 'gm-test', 'gemini-2.5-pro'), 'model check for gemini'),
        (lambda: _module.list_models('openai', 'sk-test'), 'model listing for openai'),
    ])
    def test_logs_which_outbound_call_failed(self, requests_stub, caplog, call, label):
        requests_stub.side_effect = ConnectionError('boom')

        with caplog.at_level(logging.ERROR):
            assert call() == {'valid': False, 'error': 'Validation failed'}

        assert [record.getMessage() for record in caplog.records] == [f'Error during {label}']

    def test_refuses_a_key_check_for_an_unknown_provider(self, requests_stub):
        assert _module.validate_api_key('acme', 'sk-test') == {'valid': False, 'error': 'Unknown provider'}


class TestRefusalDetails:
    """The field a refusal names, so the Settings form can point at it."""

    def test_names_the_model_field_when_no_key_is_stored(self, requests_stub):
        assert _put_provider('openai', {'model': 'gpt-5.2'})[1]['field'] == 'model'

    def test_names_the_provider_when_listing_a_provider_without_a_model(self, requests_stub):
        _store_key()

        assert _list_models('brave')[1] == {'error': 'The model of this provider cannot be changed', 'field': 'id'}

    def test_names_the_provider_when_listing_without_a_key(self, requests_stub):
        assert _list_models('gemini')[1]['field'] == 'id'

    def test_explains_why_a_search_provider_model_cannot_be_changed(self, requests_stub):
        assert _put_provider('brave', {'model': 'claude-opus-9'})[1]['error'] == 'The model of this provider cannot be changed'

    def test_explains_what_a_model_id_may_contain(self, requests_stub):
        assert _put_provider('gemini', {'model': 'bad id'})[1]['error'] == (
            'Model ids contain only letters, digits, dots, dashes and underscores (100 characters at most)'
        )

    def test_logs_a_model_that_could_not_be_saved(self, requests_stub, caplog):
        mock_table.update_item.side_effect = ClientError({'Error': {'Code': 'InternalServerError'}}, 'UpdateItem')

        with caplog.at_level(logging.ERROR):
            _put_provider('openai', {'model': None})

        assert 'Error saving provider model' in [record.getMessage() for record in caplog.records]

    def test_stamps_a_return_to_the_default(self, requests_stub):
        with patch.object(_module, 'get_timestamp', return_value='2026-09-28T12:00:00Z'):
            _put_provider('openai', {'model': None})

        assert _only_update()['ExpressionAttributeValues'] == {':ts': '2026-09-28T12:00:00Z'}

    def test_describes_openai_by_how_it_searches(self):
        _, body = _get_providers()

        assert _provider(body, 'openai')['description'] == 'Native web search via the Responses API'
