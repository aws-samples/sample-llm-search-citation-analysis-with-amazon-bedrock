"""Tests for ``shared.web_search_gateway``: the SigV4 MCP call to the Web Search gateway and its reply parsing."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError

from shared import web_search_gateway as gateway
from testing.web_search_fixtures import GATEWAY_URL, search_hit, tool_reply

_ENV = {'WEB_SEARCH_REGION': 'us-east-1', 'WEB_SEARCH_GATEWAY_URL_PARAMETER': '/citation-analysis/web-search/gateway-url'}


@pytest.fixture(autouse=True)
def _empty_cache():
    gateway._cache.clear()
    yield
    gateway._cache.clear()


@pytest.fixture
def ssm():
    """An SSM client answering the gateway URL, wired through the environment."""
    client = MagicMock()
    client.get_parameter.return_value = {'Parameter': {'Value': GATEWAY_URL}}
    with patch.dict('os.environ', _ENV), patch.object(gateway.boto3, 'client', return_value=client) as factory:
        client.factory = factory
        yield client


class TestIsoPublishedDate:
    @pytest.mark.parametrize(('reported', 'expected'), [
        ('05:00PM, Sunday, May 10 2026, PDT', '2026-05-11T00:00:00Z'),
        ('12:33AM, Thursday, June 25 2026, PDT', '2026-06-25T07:33:00Z'),
        ('05:38AM, Wednesday, February 18 2026, PST', '2026-02-18T13:38:00Z'),
        ('11:30PM, Thursday, October 08 2026, UTC', '2026-10-08T23:30:00Z'),
        ('04:00PM, Monday, December 31 1979, PST', '1980-01-01T00:00:00Z'),
    ])
    def test_converts_the_reported_local_time_to_utc(self, reported, expected):
        assert gateway.iso_published_date(reported) == expected

    @pytest.mark.parametrize('reported', [
        'unknown', '', '   ', None, 42, '2026-05-10', '05:00PM, Sunday, May 10 2026, XYZ', '05:00PM, Sunday, Smarch 10 2026, PDT',
    ])
    def test_returns_none_when_the_date_is_unknown_or_unreadable(self, reported):
        assert gateway.iso_published_date(reported) is None


class TestSearchPayload:
    def test_asks_the_web_search_tool_for_the_query(self):
        assert gateway.search_payload('hotel coruña', 5) == {
            'jsonrpc': '2.0',
            'id': 1,
            'method': 'tools/call',
            'params': {'name': 'web-search-tool___WebSearch', 'arguments': {'query': 'hotel coruña', 'maxResults': 5}},
        }

    def test_cuts_a_query_to_the_tools_200_characters(self):
        query = gateway.search_payload('é' * 250)['params']['arguments']['query']

        assert query == 'é' * 200

    def test_asks_for_ten_results_by_default(self):
        assert gateway.search_payload('x')['params']['arguments']['maxResults'] == 10


class TestParseSearchReply:
    def test_returns_the_results_document(self):
        hit = search_hit()

        assert gateway.parse_search_reply(tool_reply([hit])) == {'id': 'cd8dad0e', 'results': [hit]}

    def test_raises_the_json_rpc_error(self):
        reply = {'jsonrpc': '2.0', 'id': 1, 'error': {'code': -32602, 'message': 'Unknown tool'}}

        with pytest.raises(gateway.WebSearchGatewayError, match='Unknown tool'):
            gateway.parse_search_reply(reply)

    def test_raises_the_tools_own_error_text(self):
        reply = {'result': {'isError': True, 'content': [{'type': 'text', 'text': 'Query too long'}]}}

        with pytest.raises(gateway.WebSearchGatewayError, match='Web Search failed: Query too long'):
            gateway.parse_search_reply(reply)

    @pytest.mark.parametrize('reply', [
        {'result': {'isError': False, 'content': [{'type': 'text', 'text': 'not json'}]}},
        {'result': {'isError': False, 'content': []}},
        {'result': {'isError': False, 'content': [{'type': 'text', 'text': '[1, 2]'}]}},
        {},
    ])
    def test_raises_when_the_reply_carries_no_results_document(self, reply):
        with pytest.raises(gateway.WebSearchGatewayError, match='Web Search returned'):
            gateway.parse_search_reply(reply)


class TestGatewayUrl:
    def test_reads_the_url_from_the_parameter_in_the_gateways_region(self, ssm):
        assert gateway.gateway_url() == GATEWAY_URL
        ssm.factory.assert_called_once_with('ssm', region_name='us-east-1')
        ssm.get_parameter.assert_called_once_with(Name='/citation-analysis/web-search/gateway-url')

    def test_asks_only_once_within_the_cache_window(self, ssm):
        gateway.gateway_url()
        gateway.gateway_url()

        assert ssm.get_parameter.call_count == 1

    def test_asks_again_after_the_cache_window(self, ssm):
        gateway.gateway_url()
        with patch.object(gateway.time, 'time', return_value=gateway.time.time() + gateway.CACHE_TTL_SECONDS + 1):
            gateway.gateway_url()

        assert ssm.get_parameter.call_count == 2

    def test_returns_none_without_asking_when_the_lambda_is_not_wired_to_a_gateway(self):
        with patch.dict('os.environ', {}, clear=True), patch.object(gateway.boto3, 'client') as factory:
            assert gateway.gateway_url() is None
            factory.assert_not_called()

    def test_returns_none_and_caches_nothing_when_the_stack_is_not_deployed(self, ssm):
        ssm.get_parameter.side_effect = ClientError({'Error': {'Code': 'ParameterNotFound'}}, 'GetParameter')

        assert gateway.gateway_url() is None
        assert gateway._cache == {}

    def test_returns_none_and_warns_when_the_lookup_is_refused(self, ssm, caplog):
        ssm.get_parameter.side_effect = ClientError({'Error': {'Code': 'AccessDeniedException'}}, 'GetParameter')

        assert gateway.gateway_url() is None
        assert 'ClientError' in caplog.text

    def test_returns_none_when_ssm_cannot_be_reached(self, ssm):
        ssm.get_parameter.side_effect = EndpointConnectionError(endpoint_url='https://ssm.us-east-1.amazonaws.com')

        assert gateway.gateway_url() is None


@pytest.fixture
def signed_post():
    """``requests.post`` as called by ``post_signed``, with fake IAM credentials in the gateway's region."""
    credentials = MagicMock()
    credentials.get_frozen_credentials.return_value = MagicMock(access_key='AKIATEST', secret_key='secret', token=None)
    with (
        patch.dict('os.environ', _ENV),
        patch.object(gateway.boto3.Session, 'get_credentials', return_value=credentials),
        patch.object(gateway.requests, 'post') as post,
    ):
        yield post


class TestPostSigned:
    def test_signs_the_request_for_the_agentcore_service_in_the_gateways_region(self, signed_post):
        gateway.post_signed(GATEWAY_URL, gateway.search_payload('x'), 12)

        authorization = signed_post.call_args.kwargs['headers']['Authorization']
        assert 'bedrock-agentcore/aws4_request' in authorization
        assert '/us-east-1/' in authorization

    def test_sends_the_json_rpc_body_with_the_timeout(self, signed_post):
        payload = gateway.search_payload('x')

        gateway.post_signed(GATEWAY_URL, payload, 12)

        assert (signed_post.call_args.args, json.loads(signed_post.call_args.kwargs['data'])) == ((GATEWAY_URL,), payload)
        assert signed_post.call_args.kwargs['timeout'] == 12

    def test_refuses_to_send_without_credentials(self, signed_post):
        with (
            patch.object(gateway.boto3.Session, 'get_credentials', return_value=None),
            pytest.raises(gateway.WebSearchGatewayError, match='No AWS credentials'),
        ):
            gateway.post_signed(GATEWAY_URL, gateway.search_payload('x'), 12)

        signed_post.assert_not_called()
