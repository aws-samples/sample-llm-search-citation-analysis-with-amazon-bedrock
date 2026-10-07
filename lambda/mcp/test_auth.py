"""
Caller verification on POST /mcp and per-tool authorization.

Every claim the resource server checks beyond API Gateway's validation is
exercised to a 401 with the RFC 9728 challenge, and the scope / Admin-group
gates are proven on a ``Users`` member, a read-only token and an admin tool.
"""

from __future__ import annotations

import dataclasses
import json

import pytest
from auth import AuthError, authorize_tool, canonical_resource, verify_claims
from catalogue import find_operation
from hypothesis import given
from hypothesis import strategies as st
from invoke import run_operation

from testing.mcp_result_fixtures import READ_SCOPE, WRITE_SCOPE, text_block

PING = {'jsonrpc': '2.0', 'id': 1, 'method': 'ping'}
OTHER_POOL = 'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_OtherPool'


def _challenge(mcp_env) -> str:
    return f'Bearer resource_metadata="{mcp_env["MCP_RESOURCE_METADATA_URL"]}", error="invalid_token"'


def _create_group(rpc, **post_kwargs):
    arguments = {'action': 'create_group', 'name': 'Galicia'}
    return rpc('tools/call', {'name': 'manage_keywords', 'arguments': arguments}, **post_kwargs)['result']


class TestClaimChecks:
    @pytest.mark.parametrize('override', [
        {'iss': OTHER_POOL},
        {'client_id': 'dashboard-client'},
        {'token_use': 'id'},
        {'aud': 'https://d111111abcdef8.cloudfront.net/other'},
        {'aud': 'https://abc123.execute-api.eu-west-1.amazonaws.com/prod/mcp'},
        {'aud': 'https://evil.example.com/mcp'},
    ], ids=['issuer', 'client_id', 'token_use', 'aud_other_path', 'aud_stage_url', 'aud_other_host'])
    def test_answers_401_with_the_resource_metadata_challenge_when_a_claim_does_not_fit(self, post, claims, mcp_env, override):
        response = post(PING, claims_override=claims(**override))

        assert (response['statusCode'], response['headers']['WWW-Authenticate']) == (401, _challenge(mcp_env))

    def test_answers_401_when_the_request_carries_no_claims(self, post):
        response = post(PING, claims_override={})

        assert response['statusCode'] == 401
        assert response['headers']['WWW-Authenticate'].startswith('Bearer resource_metadata="https://')

    def test_answers_401_when_the_token_has_no_subject(self, post, claims):
        assert post(PING, claims_override=claims(sub=''))['statusCode'] == 401

    def test_never_answers_a_rejected_token_with_a_json_rpc_message(self, post, claims):
        body = json.loads(post(PING, claims_override=claims(iss=OTHER_POOL))['body'])

        assert body['error'] == 'invalid_token'
        assert 'jsonrpc' not in body

    def test_accepts_an_audience_that_differs_only_in_case_query_string_and_trailing_slash(self, post, claims):
        audience = 'HTTPS://D111111ABCDEF8.CLOUDFRONT.NET/mcp/?client=claude'

        assert post(PING, claims_override=claims(aud=audience))['statusCode'] == 200

    def test_accepts_an_audience_list_naming_this_server(self, post, claims, mcp_env):
        audience = ['https://other.example.com', mcp_env['MCP_RESOURCE_URL']]

        assert post(PING, claims_override=claims(aud=audience))['statusCode'] == 200

    def test_accepts_a_token_without_an_audience_claim(self, post):
        assert post(PING)['statusCode'] == 200

    def test_reads_the_callers_identity_scopes_and_groups(self, claims):
        caller = verify_claims(claims(**{'cognito:groups': 'Admin,Users'}))

        assert (caller.sub, caller.username) == ('11111111-2222-3333-4444-555555555555', 'alice')
        assert caller.scopes == frozenset({'openid', READ_SCOPE, WRITE_SCOPE})
        assert (caller.groups, caller.raw_groups) == (frozenset({'Admin', 'Users'}), 'Admin,Users')

    def test_reports_why_a_token_was_refused(self, claims):
        with pytest.raises(AuthError, match='access token'):
            verify_claims(claims(token_use='id'))


class TestCanonicalResource:
    @pytest.mark.parametrize(('url', 'expected'), [
        ('HTTPS://API.Example.com/prod/mcp', 'https://api.example.com/prod/mcp'),
        ('https://api.example.com/prod/mcp/', 'https://api.example.com/prod/mcp'),
        ('https://api.example.com/prod/mcp?x=1&y=2', 'https://api.example.com/prod/mcp'),
        ('https://api.example.com/prod/mcp#frag', 'https://api.example.com/prod/mcp'),
        ('https://api.example.com:8443/MCP', 'https://api.example.com:8443/MCP'),
    ])
    def test_lowers_scheme_and_host_and_drops_query_fragment_and_trailing_slash(self, url, expected):
        assert canonical_resource(url) == expected

    def test_keeps_the_path_case(self):
        assert canonical_resource('https://x.example.com/Prod/MCP') == 'https://x.example.com/Prod/MCP'

    @given(st.from_regex(
        r'[Hh][Tt][Tt][Pp][Ss]?://[A-Za-z0-9.-]{1,30}(:[0-9]{1,5})?(/[A-Za-z0-9/_.-]{0,40})?(\?[a-z0-9=&]{0,20})?',
        fullmatch=True,
    ))
    def test_canonicalising_twice_changes_nothing(self, url):
        once = canonical_resource(url)

        assert canonical_resource(once) == once


class TestToolAuthorization:
    def test_lets_a_users_member_with_write_scope_manage_keywords(self, rpc, api):
        api.answer(201, {'id': 'grp_1', 'name': 'Galicia', 'keyword_count': 0})

        result = _create_group(rpc)

        assert 'isError' not in result
        assert (api.event['httpMethod'], api.event['path']) == ('POST', '/api/keyword-groups')

    def test_refuses_manage_keywords_to_a_read_only_token_without_calling_the_api(self, rpc, api, claims):
        result = _create_group(rpc, claims_override=claims(scope=f'openid {READ_SCOPE}'))

        assert result['isError'] is True
        assert text_block(result) == (f'This tool needs the {WRITE_SCOPE} scope', {'error': f'This tool needs the {WRITE_SCOPE} scope'})
        assert api.client.invoke.call_args_list == []

    def test_requires_the_read_scope_for_a_read_tool(self, rpc, claims):
        params = {'name': 'list_keyword_groups', 'arguments': {}}

        result = rpc('tools/call', params, claims_override=claims(scope=f'openid {WRITE_SCOPE}'))['result']

        assert (result['isError'], result['structuredContent']) == (True, {'error': f'This tool needs the {READ_SCOPE} scope'})

    def test_refuses_an_admin_tool_to_a_users_member_with_a_tool_error(self, caller, api):
        admin_tool = dataclasses.replace(find_operation('list_providers'), admin=True)

        result = run_operation('call_tool', admin_tool, {}, caller)

        assert result['isError'] is True
        assert text_block(result) == ('This tool is for administrators', {'error': 'This tool is for administrators'})
        assert api.client.invoke.call_args_list == []

    def test_lets_an_admin_member_run_an_admin_tool(self, claims, api):
        api.answer(200, {'providers': []})
        admin_tool = dataclasses.replace(find_operation('list_providers'), admin=True)

        result = run_operation('call_tool', admin_tool, {}, verify_claims(claims(**{'cognito:groups': '[Admin Users]'})))

        assert 'isError' not in result

    def test_denies_admin_tools_to_a_caller_without_a_groups_claim(self, claims):
        caller = verify_claims({key: value for key, value in claims().items() if key != 'cognito:groups'})

        assert authorize_tool(caller, 'read', admin=True) == 'This tool is for administrators'

    def test_allows_a_tool_whose_scope_and_group_the_caller_holds(self, caller):
        assert authorize_tool(caller, 'write', admin=False) is None
