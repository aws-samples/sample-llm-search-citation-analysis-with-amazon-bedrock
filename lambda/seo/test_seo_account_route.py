"""``GET /api/seo/account`` (``seo-account.py``): Admin only, configured state, login and balance."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from shared.dataforseo_client import DataForSeoError
from testing.events import parse_response
from testing.handler_fixtures import handler_fixture
from testing.seo_fixtures import SEO_DIR, SEO_ENV, seo_event

account_module = handler_fixture(SEO_DIR, 'seo-account.py', 'seo_account_under_test', env=SEO_ENV)

NOT_CONFIGURED = {'configured': False, 'login': None, 'balance_usd': None}


class Account:
    """One account request, with the credentials and the free ``user_data`` call stubbed."""

    def __init__(self, module, *, groups='Admin', credentials: str | None = 'login@example.com:pw', summary=None, error=None):
        self.summary = MagicMock(return_value=summary or {'login': 'login@example.com', 'balance_usd': 42.5}, side_effect=error)
        with patch.multiple(module, configured_credentials=MagicMock(return_value=credentials), account_summary=self.summary):
            self.status, self.body = parse_response(module.handler(seo_event('GET', '/api/seo/account', groups=groups), {}))


def test_answers_the_login_and_balance_to_an_admin(account_module):
    call = Account(account_module)

    assert (call.status, call.body) == (200, {'configured': True, 'login': 'login@example.com', 'balance_usd': 42.5})


def test_answers_not_configured_without_a_key_and_without_a_call(account_module):
    call = Account(account_module, credentials=None)

    assert (call.status, call.body, call.summary.call_count) == (200, NOT_CONFIGURED, 0)


def test_answers_not_configured_when_the_key_disappears_mid_request(account_module):
    call = Account(account_module, error=DataForSeoError('NOT_CONFIGURED', 'no key'))

    assert (call.status, call.body) == (200, NOT_CONFIGURED)


def test_answers_a_rejected_login_as_auth_failed(account_module):
    call = Account(account_module, error=DataForSeoError('AUTH_FAILED', '40100'))

    assert (call.status, call.body['code']) == (502, 'AUTH_FAILED')


def test_reports_an_unknown_balance_as_null(account_module):
    call = Account(account_module, summary={'login': 'login@example.com', 'balance_usd': None})

    assert call.body['balance_usd'] is None


def test_refuses_a_user_who_is_not_an_admin(account_module):
    call = Account(account_module, groups='Users')

    assert (call.status, call.body['code'], call.summary.call_count) == (403, 'FORBIDDEN', 0)
