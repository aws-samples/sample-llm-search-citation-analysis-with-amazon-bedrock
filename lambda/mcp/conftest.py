"""Fixtures shared by the MCP server tests: environment, claims, the loaded handler, a fake Lambda API.

The handler is loaded by file path under a unique module name (five Lambda
directories own a ``handler.py``; see ``lambda/search/test_handler_prompts.py``
for why a bare ``import handler`` is contested). Its sibling modules
(``auth``, ``protocol``, ...) resolve through ``sys.path`` as in the Lambda
task root, so a test that patches ``invoke`` patches what the handler runs.
"""

from __future__ import annotations

import io
import json
import logging
import os
import sys
from collections.abc import Callable, Iterator
from types import ModuleType
from typing import Any
from unittest.mock import MagicMock, patch

import directory
import invoke
import pytest
from auth import Caller, verify_claims

from testing.mcp_result_fixtures import BASE_URL, HOSTED_LOGIN_URL, METADATA_URL, READ_SCOPE, RESOURCE_URL, WRITE_SCOPE
from testing.mcp_state_fixtures import FakeStateTable, install_fake_table
from testing.module_loader import load_handler_module

_HERE = os.path.dirname(os.path.abspath(__file__))
_HANDLER_MODULE = 'mcp_handler_under_test'

ISSUER = 'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_TestPool'
CLIENT_ID = 'mcp-app-client-1234'
CALLER_SUB = '11111111-2222-3333-4444-555555555555'
API_FUNCTIONS = {
    'keyword-mgmt': 'CitationAnalysis-KeywordMgmt',
    'config-mgmt': 'CitationAnalysis-ConfigMgmt',
    'execution-mgmt': 'CitationAnalysis-ExecutionMgmt',
    'stats-insights': 'CitationAnalysis-StatsInsights',
    'citations-content': 'CitationAnalysis-CitationsContent',
    'brand-config': 'CitationAnalysis-BrandConfig',
    'brand-mentions': 'CitationAnalysis-BrandMentions',
    'persona-rankings': 'CitationAnalysis-PersonaRankings',
    'content-studio': 'CitationAnalysis-API-ContentStudio',
}
MCP_ENV = {
    'MCP_ISSUER': ISSUER,
    'MCP_USER_POOL_ID': 'eu-west-1_TestPool',
    'MCP_CLIENT_ID': CLIENT_ID,
    'MCP_RESOURCE_URL': RESOURCE_URL,
    'MCP_RESOURCE_METADATA_URL': METADATA_URL,
    'MCP_AUTHORIZATION_SERVER': BASE_URL,
    'MCP_HOSTED_LOGIN_URL': HOSTED_LOGIN_URL,
    'MCP_API_FUNCTIONS': json.dumps(API_FUNCTIONS),
    'MCP_PINNED_TOOLS': '',
    'MCP_STATE_TABLE': 'test-mcp-state',
    'MCP_LIMITS': '{}',
}

ClaimsFactory = Callable[..., dict[str, Any]]
Poster = Callable[..., dict[str, Any]]


@pytest.fixture(autouse=True)
def mcp_env() -> Iterator[dict[str, str]]:
    """The contract variables, as CDK sets them."""
    with patch.dict(os.environ, MCP_ENV):
        yield MCP_ENV


@pytest.fixture(autouse=True)
def token_groups(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep each caller's groups as the token states them; ``test_directory.py`` covers the user-pool lookup."""
    monkeypatch.setattr(directory, 'with_directory_groups', lambda caller: caller)


@pytest.fixture(autouse=True)
def state_table(monkeypatch: pytest.MonkeyPatch) -> FakeStateTable:
    """An in-memory ``CitationAnalysis-McpState``, so no test reaches DynamoDB once ``MCP_STATE_TABLE`` is set."""
    return install_fake_table(monkeypatch)


@pytest.fixture
def claims() -> ClaimsFactory:
    """Access-token claims of a ``Users`` member with read and write scopes; keywords override or add claims."""
    def build(**overrides: Any) -> dict[str, Any]:
        base: dict[str, Any] = {
            'iss': ISSUER,
            'client_id': CLIENT_ID,
            'token_use': 'access',
            'sub': CALLER_SUB,
            'username': 'alice',
            'scope': f'openid {READ_SCOPE} {WRITE_SCOPE}',
            'cognito:groups': 'Users',
        }
        return {**base, **overrides}

    return build


@pytest.fixture
def caller(claims: ClaimsFactory) -> Caller:
    return verify_claims(claims())


@pytest.fixture(scope='module')
def mcp_handler() -> Iterator[ModuleType]:
    """``handler.py`` loaded once per test module under a unique name."""
    with patch.object(sys, 'path', [_HERE, *sys.path]):
        module = load_handler_module(_HERE, 'handler.py', _HANDLER_MODULE)
    yield module
    sys.modules.pop(_HANDLER_MODULE, None)


@pytest.fixture
def post(mcp_handler: ModuleType, claims: ClaimsFactory) -> Poster:
    """``post(body, *, claims_override=None, query=None, headers=None)``: a POST /mcp proxy event through the handler.

    ``body`` is JSON-encoded unless it is already a string (malformed-JSON tests).
    """
    def send(
        body: Any,
        *,
        claims_override: dict[str, Any] | None = None,
        query: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        event = {
            'httpMethod': 'POST',
            'path': '/mcp',
            'headers': headers or {},
            'queryStringParameters': query,
            'body': body if isinstance(body, str) else json.dumps(body),
            'requestContext': {'authorizer': {'claims': claims() if claims_override is None else claims_override}},
        }
        return mcp_handler.handler(event, {})

    return send


@pytest.fixture
def rpc(post: Poster) -> Callable[..., dict[str, Any]]:
    """``rpc(method, params=None, request_id=1, **post_kwargs)``: one JSON-RPC request, decoded response object."""
    def call(method: str, params: Any = None, request_id: Any = 1, **post_kwargs: Any) -> dict[str, Any]:
        message = {'jsonrpc': '2.0', 'id': request_id, 'method': method, 'params': {} if params is None else params}
        return json.loads(post(message, **post_kwargs)['body'])

    return call


class FakeApi:
    """The router Lambdas behind a ``MagicMock`` client: set what they answer, read what they were asked."""

    def __init__(self, client: MagicMock) -> None:
        self.client = client

    def answer(self, status: int, body: Any) -> None:
        """Every invoke returns a proxy response with ``status`` and the JSON of ``body``."""
        payload = json.dumps({'statusCode': status, 'body': json.dumps(body)}).encode('utf-8')
        self.client.invoke.return_value = {'StatusCode': 200, 'Payload': io.BytesIO(payload)}

    @property
    def event(self) -> dict[str, Any]:
        """The API Gateway event of the last invoke."""
        return json.loads(self.client.invoke.call_args.kwargs['Payload'])

    @property
    def function_name(self) -> str:
        return self.client.invoke.call_args.kwargs['FunctionName']


@pytest.fixture(autouse=True)
def api() -> Iterator[FakeApi]:
    """No test reaches a real Lambda client; by default the API answers ``200 {}``."""
    client = MagicMock(name='lambda_client')
    fake = FakeApi(client)
    fake.answer(200, {})
    with patch.object(invoke, '_lambda_client', client):
        yield fake


@pytest.fixture
def audit(caplog: pytest.LogCaptureFixture) -> Callable[[], list[dict[str, Any]]]:
    """``audit()``: the structured audit lines ``invoke`` has logged so far, decoded."""
    caplog.set_level(logging.INFO, logger='invoke')

    def lines() -> list[dict[str, Any]]:
        return [json.loads(record.getMessage()) for record in caplog.records if record.name == 'invoke']

    return lines
