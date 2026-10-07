"""
The HTTP surface of the MCP Lambda: the metadata route, the ``405`` on anything but POST, the stage-independent path match.
"""

from __future__ import annotations

import json

import pytest

from testing.mcp_result_fixtures import READ_SCOPE, RUN_SCOPE, WRITE_SCOPE

METADATA_PATH = '/.well-known/oauth-protected-resource'


def _request(mcp_handler, method: str, path: str, **extra) -> dict:
    """A proxy event with no authorizer claims, as the unauthenticated metadata route receives it."""
    return mcp_handler.handler({'httpMethod': method, 'path': path, 'headers': {}, 'body': None, **extra}, {})


class TestProtectedResourceMetadata:
    def test_serves_the_rfc_9728_document_without_claims(self, mcp_handler, mcp_env):
        response = _request(mcp_handler, 'GET', METADATA_PATH)

        assert response['statusCode'] == 200
        assert json.loads(response['body']) == {
            'resource': mcp_env['MCP_RESOURCE_URL'],
            'authorization_servers': [mcp_env['MCP_ISSUER']],
            'scopes_supported': ['openid', READ_SCOPE, WRITE_SCOPE, RUN_SCOPE],
            'bearer_methods_supported': ['header'],
            'resource_name': 'Citation Analysis MCP',
        }

    def test_names_this_servers_resource_url_from_the_environment(self, mcp_handler, mcp_env):
        body = json.loads(_request(mcp_handler, 'GET', METADATA_PATH)['body'])

        assert body['resource'] == 'https://abc123.execute-api.eu-west-1.amazonaws.com/prod/mcp'
        assert body['resource'] == mcp_env['MCP_RESOURCE_URL']

    def test_recognises_the_route_by_its_path_suffix_behind_a_stage_prefix(self, mcp_handler):
        assert _request(mcp_handler, 'GET', f'/prod{METADATA_PATH}')['statusCode'] == 200

    def test_answers_as_json(self, mcp_handler):
        assert _request(mcp_handler, 'GET', METADATA_PATH)['headers']['Content-Type'] == 'application/json'

    def test_refuses_a_post_to_the_metadata_route_with_405_allow_get(self, mcp_handler):
        response = _request(mcp_handler, 'POST', METADATA_PATH, body='{}')

        assert (response['statusCode'], response['headers']['Allow']) == (405, 'GET')


class TestMcpRoute:
    def test_get_mcp_answers_405_with_allow_post(self, mcp_handler):
        response = _request(mcp_handler, 'GET', '/mcp')

        assert (response['statusCode'], response['headers']['Allow']) == (405, 'POST')

    def test_get_mcp_answers_405_even_with_valid_claims(self, mcp_handler, claims):
        response = _request(mcp_handler, 'GET', '/mcp', requestContext={'authorizer': {'claims': claims()}})

        assert response['statusCode'] == 405

    @pytest.mark.parametrize('method', ['DELETE', 'PUT', 'OPTIONS'])
    def test_any_other_method_on_mcp_answers_405(self, mcp_handler, method):
        assert _request(mcp_handler, method, '/mcp')['statusCode'] == 405

    def test_a_405_body_names_the_allowed_method(self, mcp_handler):
        assert json.loads(_request(mcp_handler, 'GET', '/mcp')['body']) == {'error': 'method_not_allowed', 'allow': 'POST'}

    def test_post_mcp_without_claims_is_401_not_405(self, mcp_handler):
        response = _request(mcp_handler, 'POST', '/mcp', body=json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'ping'}))

        assert response['statusCode'] == 401

    def test_a_missing_method_is_treated_as_get(self, mcp_handler):
        assert mcp_handler.handler({'path': '/mcp'}, {})['statusCode'] == 405
