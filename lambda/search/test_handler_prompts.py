"""
Tests for query prompt versioning and model migration in search handler.

Covers:
- get_provider_model() reads from config table with fallback defaults
- query_openai() uses configurable model and query template
- handler() loops over query prompts
- store_search_results() includes query_prompt_id in composite key
"""

import os
import sys
import json
from unittest.mock import patch, MagicMock, call
from decimal import Decimal

import pytest

# Add paths
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))  # for shared.*
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'shared'))


@pytest.fixture(autouse=True)
def _env_vars():
    """Set required environment variables."""
    with patch.dict(os.environ, {
        'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-results',
        'PROVIDER_CONFIG_TABLE': 'test-provider-config',
        'RAW_RESPONSES_BUCKET': 'test-bucket',
        'SECRETS_PREFIX': 'test/',
    }):
        yield


@pytest.fixture()
def mock_dynamodb():
    """Mock DynamoDB resource."""
    mock = MagicMock()
    mock_table = MagicMock()
    mock.Table.return_value = mock_table
    return mock, mock_table


class TestGetProviderModel:
    """Tests for get_provider_model() — runtime model configuration."""

    def test_returns_default_when_no_config(self, mock_dynamodb):
        """Falls back to default model when no config exists."""
        mock_db, mock_table = mock_dynamodb
        mock_table.get_item.return_value = {'Item': {}}

        with patch('handler.dynamodb', mock_db):
            import handler
            handler._provider_model_cache.clear()
            result = handler.get_provider_model('openai')
            assert result == 'gpt-5-mini'

    def test_returns_configured_model(self, mock_dynamodb):
        """Returns model from ProviderConfig table when set."""
        mock_db, mock_table = mock_dynamodb
        mock_table.get_item.return_value = {
            'Item': {'provider_id': 'openai', 'model': 'gpt-5.2'}
        }

        with patch('handler.dynamodb', mock_db):
            import handler
            handler._provider_model_cache.clear()
            result = handler.get_provider_model('openai')
            assert result == 'gpt-5.2'

    def test_caches_result(self, mock_dynamodb):
        """Model is cached after first lookup."""
        mock_db, mock_table = mock_dynamodb
        mock_table.get_item.return_value = {
            'Item': {'provider_id': 'openai', 'model': 'gpt-5.2'}
        }

        with patch('handler.dynamodb', mock_db):
            import handler
            handler._provider_model_cache.clear()
            handler.get_provider_model('openai')
            handler.get_provider_model('openai')
            # Should only call DynamoDB once
            assert mock_table.get_item.call_count == 1

    def test_falls_back_on_error(self, mock_dynamodb):
        """Returns default model when DynamoDB read fails."""
        mock_db, mock_table = mock_dynamodb
        mock_table.get_item.side_effect = Exception('DynamoDB error')

        with patch('handler.dynamodb', mock_db):
            import handler
            handler._provider_model_cache.clear()
            result = handler.get_provider_model('openai')
            assert result == 'gpt-5-mini'

    def test_default_models_for_all_providers(self, mock_dynamodb):
        """Each provider has a sensible default model."""
        mock_db, mock_table = mock_dynamodb
        mock_table.get_item.return_value = {'Item': {}}

        with patch('handler.dynamodb', mock_db):
            import handler
            handler._provider_model_cache.clear()
            
            assert handler.get_provider_model('openai') == 'gpt-5-mini'
            handler._provider_model_cache.clear()
            assert handler.get_provider_model('perplexity') == 'sonar'
            handler._provider_model_cache.clear()
            assert handler.get_provider_model('gemini') == 'gemini-2.0-flash'


class TestQueryOpenAIModel:
    """Tests for query_openai() model parameter."""

    def test_uses_provided_model(self):
        """query_openai passes the model parameter to the client."""
        import handler

        mock_client = MagicMock()
        mock_client.responses_with_web_search.return_value = {
            'output': [],
            'output_text': 'test response',
            'usage': {},
        }

        with patch('handler.OpenAIClient', return_value=mock_client):
            result = handler.query_openai('test keyword', 'fake-key', model='gpt-5.2')

        mock_client.responses_with_web_search.assert_called_once()
        call_kwargs = mock_client.responses_with_web_search.call_args
        assert call_kwargs.kwargs.get('model') or call_kwargs[1].get('model') == 'gpt-5.2'
        assert result['metadata']['model'] == 'gpt-5.2'

    def test_default_model_is_gpt41(self):
        """Default model parameter is gpt-5-mini."""
        import handler
        import inspect
        sig = inspect.signature(handler.query_openai)
        assert sig.parameters['model'].default == 'gpt-5-mini'


class TestQueryTemplateSubstitution:
    """Tests for query template {keyword} substitution across providers."""

    def test_openai_uses_template(self):
        """query_openai substitutes {keyword} in template."""
        import handler

        mock_client = MagicMock()
        mock_client.responses_with_web_search.return_value = {
            'output': [], 'output_text': 'response', 'usage': {},
        }

        with patch('handler.OpenAIClient', return_value=mock_client):
            handler.query_openai(
                'hotels in malaga', 'key',
                query_template='As a family traveler, find me {keyword}'
            )

        call_args = mock_client.responses_with_web_search.call_args
        query = call_args.kwargs.get('query') or call_args[1].get('query')
        assert query == 'As a family traveler, find me hotels in malaga'

    def test_openai_default_query_without_template(self):
        """query_openai uses default format when no template provided."""
        import handler

        mock_client = MagicMock()
        mock_client.responses_with_web_search.return_value = {
            'output': [], 'output_text': 'response', 'usage': {},
        }

        with patch('handler.OpenAIClient', return_value=mock_client):
            handler.query_openai('hotels in malaga', 'key')

        call_args = mock_client.responses_with_web_search.call_args
        query = call_args.kwargs.get('query') or call_args[1].get('query')
        assert query == 'Search for information about: hotels in malaga'

    def test_perplexity_uses_template(self):
        """query_perplexity substitutes {keyword} in template."""
        import handler

        mock_client = MagicMock()
        mock_client.chat_completion.return_value = {
            'choices': [{'message': {'content': 'response'}}],
            'model': 'sonar',
            'usage': {},
        }

        with patch('handler.PerplexityClient', return_value=mock_client):
            handler.query_perplexity(
                'hotels in malaga', 'key',
                query_template='As a business traveler, find {keyword}'
            )

        call_args = mock_client.chat_completion.call_args
        messages = call_args[0][0] if call_args[0] else call_args.kwargs.get('messages')
        assert messages[0]['content'] == 'As a business traveler, find hotels in malaga'

    def test_gemini_uses_template(self):
        """query_gemini substitutes {keyword} in template."""
        import handler

        mock_client = MagicMock()
        mock_client.generate_content.return_value = {'candidates': []}

        with patch('handler.GeminiClient', return_value=mock_client):
            handler.query_gemini(
                'hotels in malaga', 'key',
                query_template='From the US, find me {keyword}'
            )

        call_args = mock_client.generate_content.call_args
        query = call_args[0][0]
        assert query == 'From the US, find me hotels in malaga'


class TestHandlerPromptLoop:
    """Tests for handler() looping over query prompts."""

    def test_handler_with_no_prompts_uses_default(self):
        """When no query_prompts in event, uses default single query."""
        import handler

        with patch.object(handler, 'execute_all_providers', return_value=[]) as mock_exec, \
             patch.object(handler, 'store_search_results', return_value=True):
            result = handler.handler({
                'keyword': 'test',
                'timestamp': '2026-01-01T00:00:00Z',
            }, {})

        mock_exec.assert_called_once()
        call_kwargs = mock_exec.call_args
        assert call_kwargs.kwargs.get('query_template') is None

    def test_handler_with_multiple_prompts(self):
        """Handler calls execute_all_providers once per prompt."""
        import handler

        with patch.object(handler, 'execute_all_providers', return_value=[]) as mock_exec, \
             patch.object(handler, 'store_search_results', return_value=True):
            result = handler.handler({
                'keyword': 'test',
                'timestamp': '2026-01-01T00:00:00Z',
                'query_prompts': [
                    {'id': 'p1', 'name': 'Family', 'template': 'Family {keyword}'},
                    {'id': 'p2', 'name': 'Business', 'template': 'Business {keyword}'},
                ],
            }, {})

        assert mock_exec.call_count == 2

    def test_handler_tags_results_with_prompt_id(self):
        """Results are tagged with query_prompt_id and query_prompt_name."""
        import handler

        fake_result = {
            'provider': 'openai', 'response': 'test', 'citations': [],
            'status': 'success', 'raw_response': None, 'metadata': {},
        }

        with patch.object(handler, 'execute_all_providers', return_value=[fake_result.copy()]) as mock_exec, \
             patch.object(handler, 'store_search_results', return_value=True) as mock_store:
            handler.handler({
                'keyword': 'test',
                'timestamp': '2026-01-01T00:00:00Z',
                'query_prompts': [
                    {'id': 'p1', 'name': 'Family', 'template': 'Family {keyword}'},
                ],
            }, {})

        # Check that store was called with results tagged with prompt info
        stored_results = mock_store.call_args[0][2]
        assert stored_results[0]['query_prompt_id'] == 'p1'
        assert stored_results[0]['query_prompt_name'] == 'Family'

    def test_handler_continues_on_prompt_error(self):
        """If one prompt fails, handler continues with remaining prompts."""
        import handler

        call_count = 0
        def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise Exception('API error')
            return [{'provider': 'openai', 'response': 'ok', 'citations': [],
                     'status': 'success', 'raw_response': None, 'metadata': {}}]

        with patch.object(handler, 'execute_all_providers', side_effect=side_effect), \
             patch.object(handler, 'store_search_results', return_value=True):
            result = handler.handler({
                'keyword': 'test',
                'timestamp': '2026-01-01T00:00:00Z',
                'query_prompts': [
                    {'id': 'p1', 'name': 'Failing', 'template': 'Fail {keyword}'},
                    {'id': 'p2', 'name': 'Working', 'template': 'Work {keyword}'},
                ],
            }, {})

        # Should have results from the second prompt only
        assert len(result['results']) == 1
