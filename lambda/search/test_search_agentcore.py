"""Tests for ``AgentCoreSearchClient`` (Amazon Bedrock Web Search)."""

from __future__ import annotations

from unittest.mock import patch

import pytest

import search_clients
from testing.provider_response_fixtures import build_market
from testing.web_search_fixtures import GATEWAY_URL, http_response, search_hit, tool_reply


@pytest.fixture
def gateway_post():
    """The signed POST to the gateway, answering one result by default."""
    with patch.object(search_clients, 'post_signed', return_value=http_response(tool_reply([search_hit()]))) as post:
        yield post


class TestSearch:
    def test_returns_the_hit_as_a_cleaned_citation_with_its_snippet(self, gateway_post):
        result = search_clients.AgentCoreSearchClient(GATEWAY_URL).search('latam airlines')

        assert result['citations'] == ['https://www.latamairlines.com/cl/es/ofertas-vuelos']
        assert result['search_results'] == [{
            'url': 'https://www.latamairlines.com/cl/es/ofertas-vuelos',
            'title': 'Flights from Santiago to Lima',
            'snippet': 'LATAM flies Santiago to Lima several times a day.',
            'published_date': '2026-05-11T00:00:00Z',
            'source': 'agentcore',
        }]

    def test_is_a_search_provider_with_no_generated_answer(self, gateway_post):
        result = search_clients.AgentCoreSearchClient(GATEWAY_URL).search('latam airlines')

        assert (result['provider'], result['provider_type'], result['response'], result['status']) == (
            'agentcore', 'search', '', 'success',
        )

    def test_records_the_search_id_and_result_count_in_the_metadata(self, gateway_post):
        metadata = search_clients.AgentCoreSearchClient(GATEWAY_URL).search('latam airlines')['metadata']

        assert (metadata['search_id'], metadata['result_count']) == ('cd8dad0e', 1)

    def test_keeps_no_date_when_the_index_reports_unknown(self, gateway_post):
        gateway_post.return_value = http_response(tool_reply([search_hit(publishedDate='unknown')]))

        result = search_clients.AgentCoreSearchClient(GATEWAY_URL).search('latam airlines')

        assert result['search_results'][0]['published_date'] is None

    def test_drops_a_hit_without_a_url(self, gateway_post):
        gateway_post.return_value = http_response(tool_reply([search_hit(url=''), search_hit(url='https://latam.com/a')]))

        result = search_clients.AgentCoreSearchClient(GATEWAY_URL).search('latam airlines')

        assert result['citations'] == ['https://latam.com/a']

    def test_sends_the_query_to_the_gateway_url_with_the_attempt_timeout(self, gateway_post):
        search_clients.AgentCoreSearchClient(GATEWAY_URL).search('latam airlines')

        assert gateway_post.call_args.args[0] == GATEWAY_URL
        assert gateway_post.call_args.args[1]['params']['arguments']['query'] == 'latam airlines'
        assert gateway_post.call_args.args[2] == 30

    def test_sends_the_same_request_with_or_without_a_market(self, gateway_post):
        search_clients.AgentCoreSearchClient(GATEWAY_URL).search('latam airlines')
        search_clients.AgentCoreSearchClient(GATEWAY_URL).search('latam airlines', build_market())

        assert gateway_post.call_args_list[0] == gateway_post.call_args_list[1]

    def test_returns_the_error_result_when_the_tool_reports_an_error(self, gateway_post):
        reply = {'result': {'isError': True, 'content': [{'type': 'text', 'text': 'Query too long'}]}}
        gateway_post.return_value = http_response(reply)

        result = search_clients.AgentCoreSearchClient(GATEWAY_URL).search('latam airlines')

        assert (result['status'], result['error'], result['citations']) == ('error', 'Web Search failed: Query too long', [])

    def test_returns_the_error_result_when_the_gateway_refuses_the_caller(self, gateway_post):
        refusal = http_response({'message': 'not authorized'}, status=403)
        refusal.raise_for_status.side_effect = search_clients.requests.exceptions.HTTPError('403 Client Error', response=refusal)
        gateway_post.return_value = refusal

        result = search_clients.AgentCoreSearchClient(GATEWAY_URL).search('latam airlines')

        assert result['status'] == 'error'
        assert gateway_post.call_count == 1
