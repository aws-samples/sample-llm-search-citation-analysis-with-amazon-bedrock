"""Auth and billing classification of the DataForSEO status ladder, and ``response_error``."""

from __future__ import annotations

import pytest

from shared.dataforseo_client import DataForSeoError, post_live, response_error
from testing.dataforseo_fixtures import install_transport, ok_envelope, task_error_envelope, top_level_error

SERP_PATH = '/v3/serp/google/organic/live/advanced'
USER_DATA_PATH = '/v3/appendix/user_data'
TASK = {'keyword': 'example shoes', 'location_code': 2840, 'language_code': 'en'}


def _error(monkeypatch, response) -> DataForSeoError:
    """The error ``post_live`` raises when DataForSEO answers ``response``."""
    install_transport(monkeypatch, response)
    try:
        post_live(SERP_PATH, TASK)
    except DataForSeoError as error:
        return error
    raise AssertionError('post_live returned instead of raising')


@pytest.mark.parametrize('status', [40100, 40104])
def test_raises_auth_failed_when_task_status_rejects_the_login(monkeypatch, status):
    error = _error(monkeypatch, task_error_envelope(status, 'You are not authorized.'))

    assert (error.code, error.provider_status) == ('AUTH_FAILED', status)


@pytest.mark.parametrize('status', [40100, 40104])
def test_raises_auth_failed_when_top_level_status_rejects_the_login(monkeypatch, status):
    error = _error(monkeypatch, top_level_error(status, 'Please verify your account.'))

    assert (error.code, error.provider_status) == ('AUTH_FAILED', status)


def test_raises_auth_failed_when_http_status_is_403(monkeypatch):
    assert _error(monkeypatch, (403, '')).code == 'AUTH_FAILED'


def test_keeps_40101_an_upstream_failure_when_task_reports_it(monkeypatch):
    assert _error(monkeypatch, task_error_envelope(40101, 'Internal SE Server Error.')).code == 'UPSTREAM_UNAVAILABLE'


@pytest.mark.parametrize('message', [
    "Invalid Field: 'balance'.",
    'Billing details are attached to this task.',
])
def test_keeps_billed_cost_when_failure_message_only_mentions_balance_or_billing(monkeypatch, message):
    error = _error(monkeypatch, task_error_envelope(40501, message, cost=0.002))

    assert (error.code, error.cost_usd) == ('INTERNAL_ERROR', 0.002)


def test_raises_internal_error_when_http_body_only_mentions_balance(monkeypatch):
    assert _error(monkeypatch, (404, '{"status_message": "balance endpoint not found"}')).code == 'INTERNAL_ERROR'


@pytest.mark.parametrize('message', [
    'Insufficient funds.', 'Your balance is too low.', 'Payment required.', 'There was a problem billing your card.',
    'Your account must be recharged.',
])
def test_raises_billing_issue_when_message_names_a_balance_failure(monkeypatch, message):
    assert _error(monkeypatch, task_error_envelope(40000, message)).code == 'BILLING_ISSUE'


def test_finds_no_error_when_user_data_answer_succeeds():
    assert response_error(200, ok_envelope(), USER_DATA_PATH) is None


@pytest.mark.parametrize(('http_status', 'payload', 'code'), [
    pytest.param(401, None, 'AUTH_FAILED', id='http-401'),
    pytest.param(200, task_error_envelope(40104, 'Please verify your account.'), 'AUTH_FAILED', id='task-40104'),
    pytest.param(200, top_level_error(40210, 'Insufficient Funds.'), 'BILLING_ISSUE', id='top-level-40210'),
    pytest.param(200, task_error_envelope(40101, 'Internal SE Server Error.'), 'UPSTREAM_UNAVAILABLE', id='task-40101'),
    pytest.param(200, ['not', 'an', 'envelope'], 'INTERNAL_ERROR', id='not-an-object'),
])
def test_classifies_received_answer_like_the_transport(http_status, payload, code):
    error = response_error(http_status, payload, USER_DATA_PATH)

    assert error is not None
    assert error.code == code
