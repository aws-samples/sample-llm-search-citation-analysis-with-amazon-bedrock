"""
Regression tests for consolidated API router 404 CORS handling.

Context:
    The 5 consolidated API routers (execution-mgmt, config-mgmt, keyword-mgmt,
    citations-content, stats-insights) previously returned a hardcoded
    Access-Control-Allow-Origin: * on unknown routes, bypassing the SSM-driven
    CORS policy in shared.api_response.get_cors_headers().

    These tests verify that each router now delegates the 404 response to
    shared.api_response.not_found_response(event=event) so the CORS header is
    produced by the centralized policy.

Test outcomes:
    - returns 404 through the SSM-driven CORS helper (dev mode -> '*')
    - fails closed on 404 when CORS is not configured (no env vars -> '')
    - extracts request Origin from the event for per-request origin echoing

Note: if this regression is ever reverted (hardcoded '*' re-added), the
"fails closed" test will FAIL because it expects an empty origin.
"""

import importlib
import os

import pytest

from testing.module_loader import load_handler_module

# --- Test bootstrap --------------------------------------------------------

# The routers do `sys.path.insert(0, '/opt/python')` at import time then
# `from shared.api_response import not_found_response`; locally that path does
# not exist and `shared` resolves from the source tree via lambda/conftest.py.
# `shared/__init__.py` re-exports api_response as a *function*, shadowing the
# submodule, so the module object (whose CORS cache the tests reset) has to be
# fetched through import_module.
_layer_api_response = importlib.import_module('shared.api_response')

_API_DIR = os.path.dirname(os.path.abspath(__file__))

ROUTERS = [
    'execution-mgmt',
    'config-mgmt',
    'keyword-mgmt',
    'citations-content',
    'stats-insights',
]


def _load_router(name):
    """Load a router .py file (hyphenated name) as a fresh module."""
    return load_handler_module(_API_DIR, f'{name}.py', name.replace('-', '_') + '_router_under_test')


def _unmatched_event(origin='https://evil.example.com'):
    """Event that matches no route in any router."""
    return {
        'resource': '/api/does-not-exist',
        'path': '/api/does-not-exist',
        'httpMethod': 'GET',
        'headers': {'origin': origin},
    }


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch):
    """Unset the CORS env vars and forget the cached origin before every test.

    Tests set the variables they need directly; monkeypatch restores the
    original environment and cache value afterwards.
    """
    for name in ('CORS_ORIGIN_PARAM', 'ALLOW_DEV_CORS', 'ALLOW_LOCALHOST'):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(_layer_api_response, '_cors_origin_cache', None)


# --- Tests ------------------------------------------------------------------


@pytest.mark.parametrize('router_name', ROUTERS)
def test_returns_404_status_when_no_route_matches(router_name):
    os.environ['ALLOW_DEV_CORS'] = 'true'
    mod = _load_router(router_name)

    resp = mod.handler(_unmatched_event(), None)

    assert resp['statusCode'] == 404


@pytest.mark.parametrize('router_name', ROUTERS)
def test_returns_wildcard_origin_when_dev_cors_enabled(router_name):
    os.environ['ALLOW_DEV_CORS'] = 'true'
    mod = _load_router(router_name)

    resp = mod.handler(_unmatched_event(), None)

    assert resp['headers']['Access-Control-Allow-Origin'] == '*'


@pytest.mark.parametrize('router_name', ROUTERS)
def test_fails_closed_when_cors_not_configured(router_name):
    """
    REGRESSION: before the fix, routers returned
    `Access-Control-Allow-Origin: *` on 404 regardless of environment.
    With the fix, an unconfigured environment must yield an empty origin
    header (fail-closed). This test would fail if the fix is reverted.
    """
    mod = _load_router(router_name)

    resp = mod.handler(_unmatched_event(), None)

    assert resp['headers']['Access-Control-Allow-Origin'] == ''


@pytest.mark.parametrize('router_name', ROUTERS)
def test_echoes_allowed_request_origin_when_configured(router_name, monkeypatch: pytest.MonkeyPatch):
    """
    When a specific origin is configured via SSM and the request origin
    matches, the 404 response echoes that origin rather than the wildcard.
    """
    configured = 'https://dashboard.example.com'
    monkeypatch.setattr(_layer_api_response, '_cors_origin_cache', configured)
    mod = _load_router(router_name)

    resp = mod.handler(_unmatched_event(origin=configured), None)

    assert resp['headers']['Access-Control-Allow-Origin'] == configured


@pytest.mark.parametrize('router_name', ROUTERS)
def test_returns_json_error_body_on_404(router_name):
    os.environ['ALLOW_DEV_CORS'] = 'true'
    mod = _load_router(router_name)

    resp = mod.handler(_unmatched_event(), None)

    assert 'not found' in resp['body'].lower()
    assert resp['headers']['Content-Type'] == 'application/json'


@pytest.mark.parametrize('router_name', ROUTERS)
def test_does_not_hardcode_wildcard_origin_in_source(router_name):
    """
    REGRESSION: the original bug was a hardcoded
    'Access-Control-Allow-Origin': '*' literal in the router's 404 path.
    This test reads the router source to ensure that literal has been removed.
    """
    source_path = os.path.join(_API_DIR, f'{router_name}.py')
    with open(source_path, encoding='utf-8') as fh:
        source = fh.read()

    assert "'Access-Control-Allow-Origin': '*'" not in source
    assert '"Access-Control-Allow-Origin": "*"' not in source
