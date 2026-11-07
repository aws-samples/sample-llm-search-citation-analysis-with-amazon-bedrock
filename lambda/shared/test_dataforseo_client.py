"""Behaviour of the DataForSEO transport and status ladder."""

from __future__ import annotations

import base64
import json
import logging

import pytest

from shared import dataforseo_client
from shared.dataforseo_client import (
    UPSTREAM_FAILURE_STATUS_CODES,
    DataForSeoError,
    account_summary,
    configured_credentials,
    escape_keyword,
    get_free,
    post_live,
)
from testing.dataforseo_fixtures import (
    TEST_LOGIN,
    TEST_STORED_KEY,
    install_transport,
    ok_envelope,
    task_error_envelope,
    top_level_error,
    user_data_envelope,
)

LABS_PATH = '/v3/dataforseo_labs/google/keyword_ideas/live'
SERP_PATH = '/v3/serp/google/organic/live/advanced'
TASK = {'keywords': ['example shoes'], 'location_code': 2840, 'language_code': 'en'}


@pytest.fixture(autouse=True)
def _default_base_url(monkeypatch):
    monkeypatch.delenv('DATAFORSEO_BASE_URL', raising=False)


def _error(callable_, *args, **kwargs) -> DataForSeoError:
    with pytest.raises(DataForSeoError) as excinfo:
        callable_(*args, **kwargs)
    return excinfo.value


# --- success path ------------------------------------------------------------------------------------------


def test_returns_result_and_cost_when_live_task_succeeds(monkeypatch):
    install_transport(monkeypatch, ok_envelope([{'keyword': 'example shoes'}], cost=0.0132))

    result = post_live(LABS_PATH, TASK)

    assert result.result == [{'items': [{'keyword': 'example shoes'}]}]
    assert result.cost_usd == 0.0132
    assert result.no_results is False


def test_posts_one_element_task_array_when_calling_live_endpoint(monkeypatch):
    transport = install_transport(monkeypatch, ok_envelope())

    post_live(LABS_PATH, TASK)

    assert transport.calls[0].task == TASK


def test_sends_basic_auth_of_stored_login_when_key_is_configured(monkeypatch):
    transport = install_transport(monkeypatch, ok_envelope())

    post_live(LABS_PATH, TASK)

    expected = base64.b64encode(TEST_STORED_KEY.encode()).decode()
    assert transport.calls[0].headers['Authorization'] == f'Basic {expected}'


@pytest.mark.parametrize(('base_url', 'host'), [
    pytest.param(None, 'https://api.dataforseo.com', id='env-unset'),
    pytest.param('https://sandbox.dataforseo.com/', 'https://sandbox.dataforseo.com', id='sandbox'),
])
def test_posts_to_configured_host_when_base_url_env_is_read(monkeypatch, base_url, host):
    if base_url:
        monkeypatch.setenv('DATAFORSEO_BASE_URL', base_url)
    transport = install_transport(monkeypatch, ok_envelope())

    post_live(LABS_PATH, TASK)

    assert transport.calls[0].url == f'{host}{LABS_PATH}'


def test_returns_empty_result_list_when_task_result_is_null(monkeypatch):
    install_transport(monkeypatch, {'status_code': 20000, 'tasks': [{'status_code': 20000, 'result': None}]})

    result = post_live(LABS_PATH, TASK)

    assert result.result == []
    assert result.cost_usd == 0.0


def test_accepts_task_created_status_when_path_is_task_post(monkeypatch):
    install_transport(monkeypatch, ok_envelope(status_code=20100, cost=0.0006))

    result = post_live('/v3/serp/google/organic/task_post', TASK, idempotent=False)

    assert result.cost_usd == 0.0006


# --- credentials -------------------------------------------------------------------------------------------


def test_returns_stored_login_and_password_when_key_is_well_formed(monkeypatch):
    install_transport(monkeypatch, stored_key=f' {TEST_STORED_KEY} ')

    assert configured_credentials() == TEST_STORED_KEY


@pytest.mark.parametrize('stored_key', [None, '', 'login-only', 'login:', ':password'])
def test_returns_no_credentials_when_key_is_missing_or_malformed(monkeypatch, stored_key):
    install_transport(monkeypatch, stored_key=stored_key)

    assert configured_credentials() is None


def test_raises_not_configured_without_any_request_when_secret_is_missing(monkeypatch):
    transport = install_transport(monkeypatch, stored_key=None)

    error = _error(post_live, LABS_PATH, TASK)

    assert error.code == 'NOT_CONFIGURED'
    assert transport.calls == []


# --- status ladder ----------------------------------------------------------------------------------------


def test_raises_internal_error_when_http_200_carries_failed_task(monkeypatch):
    install_transport(monkeypatch, task_error_envelope(40400, 'Not Found.'))

    error = _error(post_live, LABS_PATH, TASK)

    assert error.code == 'INTERNAL_ERROR'
    assert error.provider_status == 40400


def test_returns_billed_empty_success_when_task_says_no_search_results(monkeypatch):
    install_transport(monkeypatch, task_error_envelope(40501, 'No Search Results.', cost=0.002))

    result = post_live(SERP_PATH, TASK, treat_no_results_as_empty=True)

    assert result.no_results is True
    assert result.result == []
    assert result.cost_usd == 0.002


def test_raises_when_no_search_results_is_not_treated_as_empty(monkeypatch):
    install_transport(monkeypatch, task_error_envelope(40501, 'No Search Results.', cost=0.002))

    error = _error(post_live, SERP_PATH, TASK)

    assert error.code == 'INTERNAL_ERROR'
    assert error.cost_usd == 0.002


def test_raises_validation_error_naming_sent_value_when_invalid_field_is_unbilled(monkeypatch):
    install_transport(monkeypatch, task_error_envelope(
        40501, "Invalid Field: 'language_code'.", cost=0.0, data={'language_code': 'xx'},
    ))

    error = _error(post_live, LABS_PATH, TASK, treat_no_results_as_empty=True)

    assert error.code == 'VALIDATION_ERROR'
    assert str(error) == "Invalid Field: 'language_code'. (sent language_code=\"xx\")"


def test_keeps_cost_as_internal_error_when_invalid_field_was_billed(monkeypatch):
    install_transport(monkeypatch, task_error_envelope(40501, "Invalid Field: 'target'.", cost=0.012))

    error = _error(post_live, LABS_PATH, TASK)

    assert error.code == 'INTERNAL_ERROR'
    assert error.cost_usd == 0.012


@pytest.mark.parametrize('status_code', sorted(UPSTREAM_FAILURE_STATUS_CODES))
def test_raises_upstream_unavailable_when_task_fails_with_upstream_code(monkeypatch, status_code):
    install_transport(monkeypatch, task_error_envelope(status_code, 'Internal Error.'))

    error = _error(post_live, LABS_PATH, TASK)

    assert error.code == 'UPSTREAM_UNAVAILABLE'
    assert error.provider_status == status_code


def test_raises_upstream_unavailable_when_top_level_status_is_internal_error(monkeypatch):
    install_transport(monkeypatch, top_level_error(50000, 'Internal Server Error.'))

    error = _error(post_live, LABS_PATH, TASK)

    assert error.code == 'UPSTREAM_UNAVAILABLE'


def test_raises_internal_error_when_task_status_is_not_implemented(monkeypatch):
    install_transport(monkeypatch, task_error_envelope(50100, 'Not Implemented.'))

    error = _error(post_live, LABS_PATH, TASK)

    assert error.code == 'INTERNAL_ERROR'


def test_keeps_cost_when_charged_task_fails_upstream(monkeypatch):
    install_transport(monkeypatch, task_error_envelope(40101, 'Internal SE Server Error.', cost=0.0035))

    error = _error(post_live, SERP_PATH, TASK)

    assert error.code == 'UPSTREAM_UNAVAILABLE'
    assert error.cost_usd == 0.0035


@pytest.mark.parametrize(('status_code', 'message'), [
    (40200, 'Payment Required.'),
    (40210, 'Insufficient Funds.'),
    (40000, 'Your balance is too low.'),
])
def test_raises_billing_issue_without_cost_when_labs_task_reports_balance_failure(monkeypatch, status_code, message):
    install_transport(monkeypatch, task_error_envelope(status_code, message, cost=0.0))

    error = _error(post_live, LABS_PATH, TASK)

    assert error.code == 'BILLING_ISSUE'
    assert error.cost_usd is None


def test_raises_billing_issue_when_top_level_reports_payment_required(monkeypatch):
    install_transport(monkeypatch, top_level_error(40200, 'Payment Required.'))

    error = _error(post_live, SERP_PATH, TASK)

    assert error.code == 'BILLING_ISSUE'


@pytest.mark.parametrize('body', ['', 'not json', '[]'])
def test_raises_internal_error_when_body_is_not_an_envelope(monkeypatch, body):
    install_transport(monkeypatch, (200, body))

    error = _error(post_live, LABS_PATH, TASK)

    assert error.code == 'INTERNAL_ERROR'


def test_raises_internal_error_when_response_has_no_task(monkeypatch):
    install_transport(monkeypatch, {'status_code': 20000, 'tasks': []})

    error = _error(post_live, LABS_PATH, TASK)

    assert str(error) == 'DataForSEO response missing task'


# --- HTTP ladder and retries ------------------------------------------------------------------------------


@pytest.mark.parametrize(('status', 'code'), [
    (401, 'AUTH_FAILED'),
    (402, 'BILLING_ISSUE'),
    (429, 'RATE_LIMITED'),
    (404, 'INTERNAL_ERROR'),
])
def test_maps_http_status_to_error_code_when_response_is_not_2xx(monkeypatch, status, code):
    install_transport(monkeypatch, (status, '{"status_message": "nope"}'))

    error = _error(post_live, LABS_PATH, TASK)

    assert error.code == code
    assert error.provider_status == status


def test_makes_one_attempt_when_http_429_is_returned(monkeypatch):
    transport = install_transport(monkeypatch, (429, ''), ok_envelope())

    _error(post_live, LABS_PATH, TASK)

    assert len(transport.calls) == 1


def test_retries_twice_then_raises_upstream_when_idempotent_call_keeps_failing_with_5xx(monkeypatch):
    transport = install_transport(monkeypatch, (502, ''), (503, ''), (500, ''), ok_envelope())

    error = _error(post_live, LABS_PATH, TASK)

    assert error.code == 'UPSTREAM_UNAVAILABLE'
    assert len(transport.calls) == 3


def test_returns_result_when_idempotent_call_succeeds_after_5xx(monkeypatch):
    install_transport(monkeypatch, (500, ''), (502, ''), ok_envelope(cost=0.03))

    assert post_live(LABS_PATH, TASK).cost_usd == 0.03


def test_backs_off_linearly_when_retrying_5xx(monkeypatch):
    install_transport(monkeypatch, (500, ''), (500, ''), ok_envelope())
    sleeps: list[float] = []
    monkeypatch.setattr(dataforseo_client, '_sleep', sleeps.append)

    post_live(LABS_PATH, TASK)

    assert sleeps == [0.25, 0.5]


@pytest.mark.parametrize(('path', 'first_response', 'idempotent'), [
    pytest.param('/v3/serp/google/organic/task_post', (500, ''), False, id='5xx-on-non-idempotent-call'),
    pytest.param(LABS_PATH, TimeoutError('read timed out'), True, id='timeout'),
    pytest.param(LABS_PATH, ConnectionError('ConnectionError'), True, id='connection-error'),
    pytest.param(LABS_PATH, (500, ''), True, id='5xx-when-backoff-would-pass-the-shared-deadline'),
])
def test_makes_one_attempt_and_raises_upstream_when_failure_must_not_be_retried(
    monkeypatch, path, first_response, idempotent,
):
    clock = iter([0.0, 0.0, 0.9, 0.9, 0.9])
    monkeypatch.setattr(dataforseo_client, '_monotonic', lambda: next(clock))
    transport = install_transport(monkeypatch, first_response, ok_envelope())

    error = _error(post_live, path, TASK, idempotent=idempotent, timeout_s=1.0)

    assert error.code == 'UPSTREAM_UNAVAILABLE'
    assert len(transport.calls) == 1


def test_passes_remaining_deadline_as_timeout_when_retrying(monkeypatch):
    clock = iter([0.0, 0.0, 0.0, 10.0, 10.0, 10.0])
    monkeypatch.setattr(dataforseo_client, '_monotonic', lambda: next(clock))
    transport = install_transport(monkeypatch, (500, ''), ok_envelope())

    post_live(LABS_PATH, TASK, timeout_s=25.0)

    assert [call.timeout_s for call in transport.calls] == [25.0, 15.0]


# --- logging -----------------------------------------------------------------------------------------------


def test_logs_one_structured_line_with_path_status_and_cost_when_call_succeeds(monkeypatch, caplog):
    install_transport(monkeypatch, ok_envelope(cost=0.0132))
    caplog.set_level(logging.INFO, logger=dataforseo_client.__name__)

    post_live(LABS_PATH, TASK)

    line = json.loads(caplog.records[-1].getMessage())
    assert (line['path'], line['status_code'], line['task_status_code'], line['cost_usd']) == (
        LABS_PATH, 200, 20000, 0.0132)


def test_never_logs_the_credential_when_call_fails(monkeypatch, caplog):
    install_transport(monkeypatch, (401, 'Unauthorized'))
    caplog.set_level(logging.DEBUG)

    _error(post_live, LABS_PATH, TASK)

    encoded = base64.b64encode(TEST_STORED_KEY.encode()).decode()
    assert 'example-pass' not in caplog.text
    assert encoded not in caplog.text


# --- free endpoints and keyword escaping -------------------------------------------------------------------


def test_sends_get_without_body_when_reading_free_endpoint(monkeypatch):
    transport = install_transport(monkeypatch, user_data_envelope())

    get_free('/v3/appendix/user_data')

    assert (transport.calls[0].method, transport.calls[0].body) == ('GET', None)
    assert 'Content-Type' not in transport.calls[0].headers


def test_returns_login_and_balance_when_account_summary_is_read(monkeypatch):
    install_transport(monkeypatch, user_data_envelope(balance=42.5))

    assert account_summary() == {'login': TEST_LOGIN, 'balance_usd': 42.5}


def test_returns_null_balance_when_user_data_has_no_balance(monkeypatch):
    install_transport(monkeypatch, user_data_envelope(balance=None))

    assert account_summary() == {'login': TEST_LOGIN, 'balance_usd': None}


@pytest.mark.parametrize(('keyword', 'escaped'), [
    ('100% cotton+linen', '100%25 cotton%2Blinen'),
    ('c++ tutorial', 'c%2B%2B tutorial'),
    ('already %2B', 'already %252B'),
    ('plain keyword', 'plain keyword'),
])
def test_escapes_percent_and_plus_when_keyword_is_posted(keyword, escaped):
    assert escape_keyword(keyword) == escaped
