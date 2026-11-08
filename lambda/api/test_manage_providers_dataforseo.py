"""Settings > AI Providers for DataForSEO and Google AI Overviews.

``dataforseo`` holds the ``login:password`` credential (type ``seo``); ``google_ai_overview``
is an answer engine that reads it (``credential_from``) and takes no key of its own. The key
probe is the free ``GET /v3/appendix/user_data``; no DataForSEO call is made (``requests`` is a stub).
"""

from __future__ import annotations

import base64
import json
import os
import sys
from collections.abc import Iterator
from types import ModuleType, SimpleNamespace
from unittest.mock import MagicMock, patch

import botocore.exceptions
import pytest

from testing.admin_authz_fixtures import caller_event, invoke
from testing.handler_fixtures import handler_fixture

_LOGIN = 'seo@example.com'
_CREDENTIAL = f'{_LOGIN}:example-password'

providers_api = handler_fixture(
    os.path.dirname(os.path.abspath(__file__)),
    'manage-providers.py',
    'manage_providers_dataforseo',
    env={'CORS_ORIGIN_PARAM': '', 'DYNAMODB_TABLE_PROVIDER_CONFIG': 'test-provider-config'},
)


class StubTimeout(Exception):
    """Stands in for ``requests.Timeout``."""


def _reply(status: int, payload: object = None) -> MagicMock:
    response = MagicMock(status_code=status)
    response.json.return_value = payload
    return response


def _envelope(task_status: int = 20000) -> dict:
    """A ``user_data`` answer whose task carries ``task_status``."""
    return {'status_code': 20000, 'tasks': [{'status_code': task_status, 'cost': 0,
                                             'result': [{'login': _LOGIN, 'money': {'balance': 12.5}}]}]}


@pytest.fixture
def aws(providers_api: ModuleType) -> Iterator[SimpleNamespace]:
    """Secrets Manager and the ProviderConfig table, empty unless a test stores something."""
    secrets, table = MagicMock(), MagicMock()
    secrets.get_secret_value.side_effect = botocore.exceptions.ClientError({'Error': {'Code': 'ResourceNotFoundException'}}, 'GetSecretValue')
    table.get_item.return_value = {}
    with (
        patch.object(providers_api, 'secrets_client', secrets),
        patch.object(providers_api.dynamodb, 'Table', return_value=table),
    ):
        yield SimpleNamespace(secrets=secrets, table=table)


@pytest.fixture
def probe() -> Iterator[MagicMock]:
    """``requests.request`` answering every probe with a valid ``user_data`` envelope."""
    request = MagicMock(name='requests.request', return_value=_reply(200, _envelope()))
    with patch.dict(sys.modules, {'requests': SimpleNamespace(request=request, Timeout=StubTimeout)}):
        yield request


def _store_credential(aws: SimpleNamespace, value: str = _CREDENTIAL) -> None:
    aws.secrets.get_secret_value.side_effect = None
    aws.secrets.get_secret_value.return_value = {'SecretString': json.dumps({'api_key': value})}


def _listed(module: ModuleType, provider_id: str) -> dict:
    _, body = invoke(module, caller_event('GET', '/api/providers', groups=None, caller='viewer@example.com'))
    return next(item for item in body['providers'] if item['id'] == provider_id)


def _put(module: ModuleType, provider_id: str, body: dict) -> tuple[int, dict]:
    return invoke(module, caller_event('PUT', f'/api/providers/{provider_id}', body=body, path_params={'id': provider_id}))


def _validate(module: ModuleType, provider_id: str, body: dict) -> tuple[int, dict]:
    event = caller_event('POST', f'/api/providers/{provider_id}/validate', body=body, path_params={'id': provider_id})
    return invoke(module, event)


class TestListing:
    def test_lists_dataforseo_as_seo_credential_with_login_and_password_fields(self, providers_api, aws):
        listed = _listed(providers_api, 'dataforseo')

        assert {key: listed[key] for key in ('type', 'name', 'credential_fields', 'docs_url', 'model')} == {
            'type': 'seo', 'name': 'DataForSEO', 'credential_fields': ['login', 'password'],
            'docs_url': 'https://app.dataforseo.com/api-access', 'model': None,
        }

    def test_lists_overviews_as_answer_engine_reading_dataforseo_login(self, providers_api, aws):
        listed = _listed(providers_api, 'google_ai_overview')

        assert {key: listed[key] for key in ('type', 'name', 'credential_from', 'model_configurable')} == {
            'type': 'llm', 'name': 'Google AI Overviews', 'credential_from': 'dataforseo', 'model_configurable': False,
        }

    def test_shows_only_login_when_dataforseo_credential_is_stored(self, providers_api, aws):
        _store_credential(aws)

        assert _listed(providers_api, 'dataforseo')['masked_key'] == _LOGIN

    def test_marks_overviews_configured_when_dataforseo_credential_is_stored(self, providers_api, aws):
        _store_credential(aws)

        listed = _listed(providers_api, 'google_ai_overview')

        assert (listed['configured'], listed['masked_key']) == (True, _LOGIN)

    def test_marks_overviews_unconfigured_when_dataforseo_has_no_credential(self, providers_api, aws):
        assert _listed(providers_api, 'google_ai_overview')['configured'] is False

    def test_lists_overviews_off_until_an_admin_switches_it_on_even_with_the_login_saved(self, providers_api, aws):
        _store_credential(aws)

        assert _listed(providers_api, 'google_ai_overview')['enabled'] is False

    def test_lists_overviews_off_when_its_row_holds_only_health_bookkeeping(self, providers_api, aws):
        aws.table.get_item.return_value = {'Item': {'provider_id': 'google_ai_overview', 'consecutive_failures': 0}}

        assert _listed(providers_api, 'google_ai_overview')['enabled'] is False

    def test_lists_overviews_on_once_switched_on(self, providers_api, aws):
        aws.table.get_item.return_value = {'Item': {'provider_id': 'google_ai_overview', 'enabled': True}}

        assert _listed(providers_api, 'google_ai_overview')['enabled'] is True

    def test_lists_a_provider_without_config_on_as_before(self, providers_api, aws):
        assert _listed(providers_api, 'dataforseo')['enabled'] is True

    def test_keeps_secret_name_shared_by_both_entries(self, providers_api):
        names = {providers_api.PROVIDERS[provider_id]['secret_name'] for provider_id in ('dataforseo', 'google_ai_overview')}

        assert [name.rsplit('/', 1)[-1] for name in names] == ['dataforseo-key']


class TestFormatCheck:
    @pytest.mark.parametrize('value', ['no-separator', ':password', f'{_LOGIN}:', ':'])
    def test_refuses_credential_when_not_login_colon_password(self, providers_api, aws, probe, value):
        status, body = _put(providers_api, 'dataforseo', {'api_key': value})

        assert (status, body['error'], probe.call_count) == (
            400, 'Enter the DataForSEO login and API password as login:password', 0,
        )

    def test_accepts_password_containing_colon_when_login_has_none(self, providers_api):
        assert providers_api.dataforseo_format_error(f'{_LOGIN}:pass:word') is None

    def test_refuses_credential_on_validate_when_not_login_colon_password(self, providers_api, aws, probe):
        assert _validate(providers_api, 'dataforseo', {'api_key': 'no-separator'})[0] == 400


class TestProbe:
    def test_probes_free_user_data_endpoint_when_saving_dataforseo_login(self, providers_api, aws, probe):
        _put(providers_api, 'dataforseo', {'api_key': _CREDENTIAL})

        assert (probe.call_args.kwargs['method'], probe.call_args.kwargs['url']) == (
            'get', 'https://api.dataforseo.com/v3/appendix/user_data',
        )

    def test_sends_candidate_login_as_basic_auth_when_probing(self, providers_api, aws, probe):
        _put(providers_api, 'dataforseo', {'api_key': _CREDENTIAL})

        token = base64.b64encode(_CREDENTIAL.encode()).decode()
        assert probe.call_args.kwargs['headers']['Authorization'] == f'Basic {token}'

    def test_stores_login_as_api_key_json_when_probe_accepts_it(self, providers_api, aws, probe):
        _put(providers_api, 'dataforseo', {'api_key': f'  {_CREDENTIAL}  '})

        assert aws.secrets.put_secret_value.call_args.kwargs['SecretString'] == json.dumps({'api_key': _CREDENTIAL})

    @pytest.mark.parametrize(
        ('reply', 'error'),
        [
            pytest.param(_reply(401), 'DataForSEO rejected the login or API password', id='http-401'),
            pytest.param(_reply(200, _envelope(40100)), 'DataForSEO rejected the login or API password', id='task-40100'),
            pytest.param(_reply(200, _envelope(40104)), 'DataForSEO rejected the login or API password', id='task-40104'),
            pytest.param(_reply(200, {'status_code': 40100, 'status_message': 'You are not authorized.', 'tasks': []}),
                         'DataForSEO rejected the login or API password', id='top-level-40100'),
            pytest.param(_reply(403), 'DataForSEO rejected the login or API password', id='http-403'),
            pytest.param(_reply(200, _envelope(40101)), 'Unexpected DataForSEO status 40101', id='task-40101-is-upstream'),
            pytest.param(_reply(200, 'not an object'), 'Invalid response format', id='not-an-envelope'),
            pytest.param(_reply(200, _envelope(40200)), 'The connected DataForSEO account has a billing or balance issue',
                         id='task-40200'),
            pytest.param(_reply(500), 'Unexpected DataForSEO status 500', id='http-500'),
        ],
    )
    def test_reports_reason_when_probe_refutes_login(self, providers_api, reply, error):
        assert providers_api._dataforseo_result(reply) == {'valid': False, 'error': error}

    def test_refuses_to_save_login_when_probe_refutes_it(self, providers_api, aws, probe):
        probe.return_value = _reply(401)

        status, _ = _put(providers_api, 'dataforseo', {'api_key': _CREDENTIAL})

        assert (status, aws.secrets.put_secret_value.call_count) == (400, 0)


class TestOverviewsHasNoKey:
    def test_refuses_api_key_when_put_on_overviews(self, providers_api, aws, probe):
        status, body = _put(providers_api, 'google_ai_overview', {'api_key': _CREDENTIAL})

        assert (status, body['error'], aws.secrets.put_secret_value.call_count) == (
            400, 'This provider uses the DataForSEO login; set it on DataForSEO', 0,
        )

    def test_validates_stored_dataforseo_login_when_overviews_checked(self, providers_api, aws, probe):
        _store_credential(aws)

        status, body = _validate(providers_api, 'google_ai_overview', {})

        assert (status, body, probe.call_args.kwargs['url']) == (
            200, {'valid': True}, 'https://api.dataforseo.com/v3/appendix/user_data',
        )

    def test_refuses_check_when_dataforseo_has_no_login(self, providers_api, aws, probe):
        status, _ = _validate(providers_api, 'google_ai_overview', {})

        assert (status, probe.call_count) == (400, 0)

    def test_proves_stored_login_when_overviews_enabled(self, providers_api, aws, probe):
        _store_credential(aws)

        status, _ = _put(providers_api, 'google_ai_overview', {'enabled': True})

        assert (status, probe.call_count) == (200, 1)

    def test_refuses_model_change_when_put_on_overviews(self, providers_api, aws):
        assert _put(providers_api, 'google_ai_overview', {'model': 'gemini-3.6-flash'})[0] == 400


def test_enables_dataforseo_without_probe_when_switched_on(providers_api, aws, probe):
    _store_credential(aws)

    status, _ = _put(providers_api, 'dataforseo', {'enabled': True})

    assert (status, probe.call_count) == (200, 0)


class TestDailyCallLimit:
    """Settings > AI Providers > SEO data: the paid one-off DataForSEO calls each user may make per UTC day."""

    def test_lists_the_default_of_100_until_an_admin_sets_one(self, providers_api, aws):
        assert _listed(providers_api, 'dataforseo')['daily_call_limit'] == 100

    def test_lists_the_limit_an_admin_set(self, providers_api, aws):
        aws.table.get_item.return_value = {'Item': {'provider_id': 'dataforseo', 'daily_call_limit': 250}}

        assert _listed(providers_api, 'dataforseo')['daily_call_limit'] == 250

    def test_lists_no_limit_on_any_other_provider(self, providers_api, aws):
        assert 'daily_call_limit' not in _listed(providers_api, 'google_ai_overview')

    @pytest.mark.parametrize('value', [0, 100, 100_000])
    def test_saves_a_limit_from_zero_to_the_maximum_on_the_dataforseo_row_only(self, providers_api, aws, value):
        status, _body = _put(providers_api, 'dataforseo', {'daily_call_limit': value})

        update = aws.table.update_item.call_args.kwargs
        assert (status, update['Key'], update['ExpressionAttributeValues'][':limit']) == (
            200, {'provider_id': 'dataforseo'}, value,
        )

    @pytest.mark.parametrize('value', [-1, 100_001, 2.5, True, '50', None])
    def test_refuses_a_limit_that_is_not_a_whole_number_in_range(self, providers_api, aws, value):
        status, body = _put(providers_api, 'dataforseo', {'daily_call_limit': value})

        assert (status, body.get('field'), aws.table.update_item.called) == (400, 'daily_call_limit', False)

    def test_refuses_a_limit_on_another_provider(self, providers_api, aws):
        status, body = _put(providers_api, 'google_ai_overview', {'daily_call_limit': 10})

        assert (status, body['error']) == (400, 'Only DataForSEO has a daily call limit')

    def test_lets_only_an_admin_set_it(self, providers_api, aws):
        event = caller_event('PUT', '/api/providers/dataforseo', body={'daily_call_limit': 10_000},
                             path_params={'id': 'dataforseo'}, groups=None, caller='viewer@example.com')

        status, _body = invoke(providers_api, event)

        assert (status, aws.table.update_item.called) == (403, False)

    def test_audits_who_changed_the_limit_and_from_what(self, providers_api, aws, monkeypatch):
        monkeypatch.setenv('DYNAMODB_TABLE_MCP_STATE', 'test-mcp-state')
        aws.table.get_item.return_value = {'Item': {'provider_id': 'dataforseo', 'daily_call_limit': 100}}

        _put(providers_api, 'dataforseo', {'daily_call_limit': 40})

        audit = aws.table.put_item.call_args.kwargs['Item']
        assert {key: audit[key] for key in ('pk', 'tool', 'operation', 'outcome', 'previous_limit', 'limit')} == {
            'pk': 'audit#admin@example.com', 'tool': 'settings', 'operation': 'PUT /api/providers/dataforseo',
            'outcome': 'saved', 'previous_limit': 100, 'limit': 40,
        }
