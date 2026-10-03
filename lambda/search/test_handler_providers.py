"""
Provider selection in the search handler.

The analysis workflow invokes one search Lambda per provider with
``{"keyword", "timestamp", "query_prompts", "providers": ["<id>"]}``. Such an
invocation must touch only its own provider (one secret, one enablement read)
and return the slim ``{"keyword", "timestamp", "results": [...]}`` shape the
merge step reads.
"""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest

from testing.handler_fixtures import handler_fixture
from testing.search_handler_fixtures import SEARCH_HANDLER_ENV

_HERE = os.path.dirname(os.path.abspath(__file__))

# Unique module name: see test_handler_prompts.py for why `import handler` is contested.
search_handler = handler_fixture(_HERE, 'handler.py', 'search_handler_providers', env=SEARCH_HANDLER_ENV)

_BRAVE_RESULT = {
    'provider': 'brave', 'provider_type': 'search', 'response': '', 'status': 'success',
    'citations': ['https://hotel.es/riazor'], 'search_results': [{'url': 'https://hotel.es/riazor'}],
    'raw_response': {'web': {}}, 'metadata': {'latency_ms': 120},
}
_EVENT = {
    'keyword': 'hotel coruña',
    'timestamp': '2026-09-30T10:00:00Z',
    'query_prompts': [{'id': 'p1', 'name': 'Family', 'template': 'As a family, {keyword}'}],
    'providers': ['brave'],
}


@pytest.fixture
def providers(search_handler):
    """Every secret configured, every provider enabled, Brave answering; storage and health stubbed."""
    with (
        patch.object(search_handler, 'get_api_key', return_value='key') as get_api_key,
        patch.object(search_handler, 'is_provider_enabled', return_value=True) as is_enabled,
        patch.object(search_handler.BraveSearchClient, 'search', return_value=dict(_BRAVE_RESULT)) as brave_search,
        patch.object(search_handler, '_record_provider_outcome'),
        patch.object(search_handler, 'store_search_results', return_value=True),
    ):
        yield MagicMock(get_api_key=get_api_key, is_enabled=is_enabled, brave_search=brave_search)


class TestOneProviderInvocation:
    @pytest.mark.parametrize(
        ('lookup', 'expected_args'),
        [
            pytest.param('get_api_key', [('brave-key',)], id='secret'),
            pytest.param('is_enabled', [('brave',)], id='enablement'),
        ],
    )
    def test_reads_only_the_selected_providers_configuration(self, search_handler, providers, lookup, expected_args):
        search_handler.execute_all_providers('hotel coruña', providers=['brave'])

        assert [call.args for call in getattr(providers, lookup).call_args_list] == expected_args

    def test_reads_every_secret_when_no_provider_is_selected(self, search_handler, providers):
        providers.is_enabled.return_value = False

        search_handler.execute_all_providers('hotel coruña', provider_types=['search'])

        assert [call.args[0] for call in providers.get_api_key.call_args_list] == [
            'brave-key', 'tavily-key', 'exa-key', 'serpapi-key', 'firecrawl-key',
        ]

    def test_returns_the_slim_result_shape_the_merge_step_reads(self, search_handler, providers):
        response = search_handler.handler(dict(_EVENT), None)

        assert response == {
            'keyword': 'hotel coruña',
            'timestamp': '2026-09-30T10:00:00Z',
            'provider_types': None,
            'providers': ['brave'],
            'results': [{
                'provider': 'brave', 'provider_type': 'search', 'status': 'success',
                'citation_count': 1, 'citations': ['https://hotel.es/riazor'], 'query_prompt_id': 'p1',
            }],
            'stored': True,
        }

    @pytest.mark.parametrize(('api_key', 'enabled'), [('key', False), (None, True)], ids=['disabled', 'no-key'])
    def test_returns_no_results_when_the_one_provider_cannot_run(self, search_handler, providers, api_key, enabled):
        providers.get_api_key.return_value = api_key
        providers.is_enabled.return_value = enabled

        response = search_handler.handler(dict(_EVENT), None)

        assert (response['keyword'], response['results'], providers.brave_search.call_count) == ('hotel coruña', [], 0)
