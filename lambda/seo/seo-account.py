"""
SEO account API: ``GET /api/seo/account`` (Admin) - whether DataForSEO is configured, its login and balance.

The balance is read on demand from the free ``GET /v3/appendix/user_data`` (``account_summary``); nothing is
stored: there are no spend caps by design, so the app keeps no balance or ledger of its own. Without a DataForSEO key the answer is a 200 ``configured: false``, not an
error, so the Settings card can show its empty state.
"""

import sys
from typing import Any

# Shared layer path (populated by the Lambda layer at /opt/python)
sys.path.insert(0, '/opt/python')

from seo_http import seo_route

from shared.api_response import success_response
from shared.auth import ADMIN_GROUP, require_group
from shared.dataforseo_client import DataForSeoError, account_summary, configured_credentials

NOT_CONFIGURED: dict[str, Any] = {'configured': False, 'login': None, 'balance_usd': None}


def _balance(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


@require_group(ADMIN_GROUP)
def handle_account(event: dict[str, Any], _context: Any, *_args: Any, **_kwargs: Any) -> dict[str, Any]:
    """GET /api/seo/account - ``{configured, login, balance_usd}``."""
    if configured_credentials() is None:
        return success_response(NOT_CONFIGURED, event)
    try:
        summary = account_summary()
    except DataForSeoError as error:
        if error.code != 'NOT_CONFIGURED':
            raise
        return success_response(NOT_CONFIGURED, event)
    login = summary.get('login')
    return success_response({
        'configured': True,
        'login': login if isinstance(login, str) and login else None,
        'balance_usd': _balance(summary.get('balance_usd')),
    }, event)


handler = seo_route({('GET', '/account'): handle_account})
