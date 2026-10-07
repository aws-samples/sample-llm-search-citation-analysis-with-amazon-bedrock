"""
JSON-RPC and MCP lifecycle behaviour of POST /mcp.

Version negotiation, the ``initialize`` result, notifications (``202``, no
body), ``ping``, batches, and the HTTP status each JSON-RPC error travels in.
"""

from __future__ import annotations

import json

import pytest
from protocol import SUPPORTED_VERSIONS, negotiate_version

NEWEST_VERSION = '2026-07-28'
PING = {'jsonrpc': '2.0', 'id': 1, 'method': 'ping'}
INITIALIZED = {'jsonrpc': '2.0', 'method': 'notifications/initialized'}


def _status_and_code(response: dict) -> tuple[int, int]:
    """``(HTTP status, JSON-RPC error code)`` of a single error response."""
    return response['statusCode'], json.loads(response['body'])['error']['code']


class TestVersionNegotiation:
    @pytest.mark.parametrize('requested', SUPPORTED_VERSIONS)
    def test_echoes_a_supported_version_the_client_requests(self, rpc, requested):
        result = rpc('initialize', {'protocolVersion': requested, 'capabilities': {}})['result']

        assert result['protocolVersion'] == requested

    @pytest.mark.parametrize('requested', ['2024-11-05', '2025-03-26', '', None, 42])
    def test_answers_the_newest_version_when_the_requested_one_is_unsupported(self, requested):
        assert negotiate_version(requested) == NEWEST_VERSION

    def test_newest_version_is_the_last_supported_one(self):
        assert SUPPORTED_VERSIONS[-1] == NEWEST_VERSION


class TestInitialize:
    def test_describes_a_tools_only_server(self, rpc):
        result = rpc('initialize', {'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'x'}})

        assert result == {
            'jsonrpc': '2.0',
            'id': 1,
            'result': {
                'protocolVersion': '2025-06-18',
                'capabilities': {'tools': {}},
                'serverInfo': {'name': 'citation-analysis-mcp', 'version': '0.1.0'},
            },
        }

    def test_initializes_without_params(self, rpc):
        assert rpc('initialize')['result']['protocolVersion'] == NEWEST_VERSION


class TestLifecycle:
    def test_accepts_the_initialized_notification_with_202_and_an_empty_body(self, post):
        response = post(INITIALIZED)

        assert (response['statusCode'], response['body']) == (202, '')

    def test_accepts_any_other_notification_silently(self, post):
        response = post({'jsonrpc': '2.0', 'method': 'notifications/cancelled', 'params': {'requestId': 3}})

        assert response['statusCode'] == 202

    def test_answers_ping_with_an_empty_result_under_the_requests_id(self, rpc):
        assert rpc('ping', request_id='ping-7') == {'jsonrpc': '2.0', 'id': 'ping-7', 'result': {}}

    def test_answers_requests_as_json(self, post):
        response = post(PING)

        assert (response['statusCode'], response['headers']['Content-Type']) == (200, 'application/json')


class TestErrors:
    def test_answers_method_not_found_for_an_unknown_method(self, rpc):
        response = rpc('resources/list')

        assert response['error'] == {'code': -32601, 'message': 'Method not found: resources/list'}

    def test_answers_an_unknown_method_in_a_200(self, post):
        response = post({**PING, 'method': 'prompts/list'})

        assert response['statusCode'] == 200

    def test_answers_malformed_json_with_a_parse_error_in_a_400(self, post):
        response = post('{"jsonrpc": "2.0", "method": ')

        assert (response['statusCode'], json.loads(response['body'])) == (
            400, {'jsonrpc': '2.0', 'id': None, 'error': {'code': -32700, 'message': 'Parse error'}},
        )

    def test_answers_an_empty_body_with_a_parse_error(self, post):
        assert json.loads(post('')['body'])['error']['code'] == -32700

    @pytest.mark.parametrize('body', [{'hello': 'world'}, 7, {'jsonrpc': '1.0', 'id': 1, 'method': 'ping'}, {'jsonrpc': '2.0', 'id': 1}])
    def test_answers_a_body_that_is_not_a_request_with_invalid_request_in_a_400(self, post, body):
        assert _status_and_code(post(body)) == (400, -32600)

    def test_answers_params_that_are_not_an_object_with_invalid_params(self, rpc):
        assert rpc('ping', params=[1, 2])['error']['code'] == -32602

    def test_rejects_an_unsupported_protocol_version_header_with_400(self, post):
        response = post(PING, headers={'MCP-Protocol-Version': '2024-11-05'})

        assert response['statusCode'] == 400
        assert json.loads(response['body'])['supported'] == list(SUPPORTED_VERSIONS)

    def test_accepts_a_supported_protocol_version_header_in_any_casing(self, post):
        assert post(PING, headers={'mcp-protocol-version': '2025-11-25'})['statusCode'] == 200


class TestBatch:
    def test_answers_a_batch_of_two_requests_with_two_results(self, post):
        responses = json.loads(post([PING, {**PING, 'id': 2}])['body'])

        assert responses == [{'jsonrpc': '2.0', 'id': 1, 'result': {}}, {'jsonrpc': '2.0', 'id': 2, 'result': {}}]

    def test_omits_notifications_from_a_batch_response(self, post):
        responses = json.loads(post([INITIALIZED, PING, INITIALIZED])['body'])

        assert [entry['id'] for entry in responses] == [1]

    def test_answers_a_batch_of_notifications_only_with_202(self, post):
        response = post([INITIALIZED, INITIALIZED])

        assert (response['statusCode'], response['body']) == (202, '')

    def test_answers_each_bad_entry_of_a_batch_with_its_own_error(self, post):
        response = post([PING, 'not a request'])

        assert [entry.get('error', {}).get('code') for entry in json.loads(response['body'])] == [None, -32600]

    def test_rejects_an_empty_batch_with_invalid_request(self, post):
        assert _status_and_code(post([])) == (400, -32600)
