"""
The HTTP surface of the MCP Lambda: the metadata routes, the ``405`` on anything but POST, the stage-independent path match.
"""

from __future__ import annotations

import json

import pytest

from testing.mcp_result_fixtures import BASE_URL, HOSTED_LOGIN_URL, READ_SCOPE, RUN_SCOPE, WRITE_SCOPE

METADATA_PATH = '/.well-known/oauth-protected-resource'
#: RFC 9728 §3.1 location of the metadata of the resource ``<base>/mcp``.
PATH_INSERTED_METADATA_PATH = f'{METADATA_PATH}/mcp'
AUTHORIZATION_SERVER_PATHS = ('/.well-known/openid-configuration', '/.well-known/oauth-authorization-server')


def _request(mcp_handler, method: str, path: str, **extra) -> dict:
    """A proxy event with no authorizer claims, as the unauthenticated metadata route receives it."""
    return mcp_handler.handler({'httpMethod': method, 'path': path, 'headers': {}, 'body': None, **extra}, {})


def _document(mcp_handler, path: str) -> dict:
    """The decoded body of an anonymous GET of ``path``."""
    return json.loads(_request(mcp_handler, 'GET', path)['body'])


class TestProtectedResourceMetadata:
    @pytest.mark.parametrize('path', [PATH_INSERTED_METADATA_PATH, METADATA_PATH])
    def test_serves_the_rfc_9728_document_without_claims(self, mcp_handler, mcp_env, path):
        response = _request(mcp_handler, 'GET', path)

        assert response['statusCode'] == 200
        assert json.loads(response['body']) == {
            'resource': mcp_env['MCP_RESOURCE_URL'],
            'authorization_servers': [BASE_URL],
            'scopes_supported': [READ_SCOPE, WRITE_SCOPE, RUN_SCOPE],
            'bearer_methods_supported': ['header'],
            'resource_name': 'Citation Analysis MCP',
        }

    def test_serves_the_same_document_at_the_path_inserted_and_the_bare_location(self, mcp_handler):
        assert _document(mcp_handler, PATH_INSERTED_METADATA_PATH) == _document(mcp_handler, METADATA_PATH)

    def test_advertises_the_path_inserted_location_in_the_401_challenge(self, mcp_handler):
        """RFC 9728 §3.1: the metadata of ``<base>/mcp`` is at ``<base>/.well-known/oauth-protected-resource/mcp``."""
        response = _request(mcp_handler, 'POST', '/mcp', body='{}')

        assert response['headers']['WWW-Authenticate'] == f'Bearer resource_metadata="{BASE_URL}{PATH_INSERTED_METADATA_PATH}", error="invalid_token"'

    def test_names_the_metadata_issuer_this_api_serves_as_the_authorization_server(self, mcp_handler):
        """Clients compare the PRM entry and the metadata ``issuer`` character by character."""
        prm = _document(mcp_handler, PATH_INSERTED_METADATA_PATH)

        assert prm['authorization_servers'] == [_document(mcp_handler, AUTHORIZATION_SERVER_PATHS[0])['issuer']]

    def test_names_a_host_root_issuer_so_rfc_8414_metadata_sits_at_the_host_root(self, mcp_handler):
        issuer = _document(mcp_handler, METADATA_PATH)['authorization_servers'][0]

        assert issuer == 'https://d111111abcdef8.cloudfront.net'

    def test_does_not_offer_openid_so_clients_ask_for_no_id_token(self, mcp_handler):
        assert 'openid' not in _document(mcp_handler, METADATA_PATH)['scopes_supported']

    def test_names_this_servers_resource_url_from_the_environment(self, mcp_handler, mcp_env):
        body = json.loads(_request(mcp_handler, 'GET', METADATA_PATH)['body'])

        assert body['resource'] == 'https://d111111abcdef8.cloudfront.net/mcp'
        assert body['resource'] == mcp_env['MCP_RESOURCE_URL']

    @pytest.mark.parametrize('path', [PATH_INSERTED_METADATA_PATH, METADATA_PATH])
    def test_recognises_the_route_by_its_path_suffix_behind_a_stage_prefix(self, mcp_handler, path):
        assert _request(mcp_handler, 'GET', f'/prod{path}')['statusCode'] == 200

    def test_does_not_serve_the_metadata_for_another_resource_path(self, mcp_handler):
        """Only ``/mcp`` is a resource here; any other path-inserted suffix is the ``/mcp`` route's 405."""
        assert _request(mcp_handler, 'GET', f'{METADATA_PATH}/other')['statusCode'] == 405

    def test_answers_as_json(self, mcp_handler):
        assert _request(mcp_handler, 'GET', METADATA_PATH)['headers']['Content-Type'] == 'application/json'

    @pytest.mark.parametrize('path', [PATH_INSERTED_METADATA_PATH, METADATA_PATH, *AUTHORIZATION_SERVER_PATHS])
    def test_refuses_a_post_to_a_discovery_route_with_405_allow_get(self, mcp_handler, path):
        response = _request(mcp_handler, 'POST', path, body='{}')

        assert (response['statusCode'], response['headers']['Allow']) == (405, 'GET')


class TestAuthorizationServerMetadata:
    """The discovery document that fills the gap in Cognito's (no ``code_challenge_methods_supported``)."""

    @pytest.mark.parametrize('path', AUTHORIZATION_SERVER_PATHS)
    def test_serves_the_document_at_both_well_known_names_without_claims(self, mcp_handler, path):
        response = _request(mcp_handler, 'GET', f'/prod{path}')

        assert (response['statusCode'], response['headers']['Content-Type']) == (200, 'application/json')

    def test_describes_cognito_managed_login_as_a_pkce_authorization_server(self, mcp_handler, mcp_env):
        assert _document(mcp_handler, AUTHORIZATION_SERVER_PATHS[1]) == {
            'issuer': BASE_URL,
            'authorization_endpoint': f'{HOSTED_LOGIN_URL}/oauth2/authorize',
            'token_endpoint': f'{HOSTED_LOGIN_URL}/oauth2/token',
            'revocation_endpoint': f'{HOSTED_LOGIN_URL}/oauth2/revoke',
            'jwks_uri': f'{mcp_env["MCP_ISSUER"]}/.well-known/jwks.json',
            'response_types_supported': ['code'],
            'grant_types_supported': ['authorization_code', 'refresh_token'],
            'code_challenge_methods_supported': ['S256'],
            'token_endpoint_auth_methods_supported': ['none'],
            'scopes_supported': [READ_SCOPE, WRITE_SCOPE, RUN_SCOPE],
            'subject_types_supported': ['public'],
            'id_token_signing_alg_values_supported': ['RS256'],
        }

    def test_serves_the_same_document_under_both_names(self, mcp_handler):
        documents = [_document(mcp_handler, path) for path in AUTHORIZATION_SERVER_PATHS]

        assert documents[0] == documents[1]

    def test_lets_clients_cache_the_document_for_five_minutes(self, mcp_handler):
        response = _request(mcp_handler, 'GET', AUTHORIZATION_SERVER_PATHS[0])

        assert response['headers']['Cache-Control'] == 'public, max-age=300'

    def test_still_checks_access_tokens_against_cognitos_issuer(self, post, claims):
        """The metadata issuer is the server's base URL, but Cognito signs the tokens: their ``iss`` stays Cognito's."""
        assert post({'jsonrpc': '2.0', 'id': 1, 'method': 'ping'}, claims_override=claims(iss=BASE_URL))['statusCode'] == 401


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
