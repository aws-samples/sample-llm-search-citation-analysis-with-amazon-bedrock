"""
Tests for query prompt versioning and model migration in search handler.

Covers:
- get_provider_model() reads from config table with fallback defaults
- query_openai() uses configurable model and query template
- handler() loops over query prompts
- store_search_results() includes query_prompt_id in composite key
"""

import os
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from testing.env import setdefault_env
from testing.module_loader import load_handler_module

# handler.py resolves its table names at import; the autouse fixture below
# re-patches them per test for the code paths that read the environment.
setdefault_env({
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-results',
    'SEARCH_RESULTS_TABLE': 'test-results',
    'PROVIDER_CONFIG_TABLE': 'test-provider-config',
    'DYNAMODB_TABLE_PROVIDER_CONFIG': 'test-provider-config',
    'BRAND_CONFIG_TABLE': 'test-brands',
    'DYNAMODB_TABLE_BRAND_CONFIG': 'test-brands',
})

_HERE = os.path.dirname(os.path.abspath(__file__))

# Import this directory's handler.py by file path, under a unique module name.
#
# Five Lambda directories own a `handler.py`, and a bare `import handler`
# resolves through sys.path — whose front is whichever test directory pytest
# collected *last* (prepend import mode inserts each one). So
# `pytest lambda/api ... lambda/search lambda/deduplication` handed this suite
# deduplication's handler and failed all 20 tests, while bare `pytest` passed
# only because alphabetical collection happened to leave search/ in front.
# The unique name keeps this suite out of the contested `sys.modules['handler']`
# slot entirely — the same pattern as test_provider_query_parity.py.
handler = load_handler_module(_HERE, 'handler.py', 'search_handler_prompts')


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


@pytest.fixture
def mock_dynamodb():
    """Mock DynamoDB resource."""
    mock = MagicMock()
    mock_table = MagicMock()
    mock.Table.return_value = mock_table
    return mock, mock_table


class TestGetProviderModel:
    """Tests for get_provider_model() — runtime model configuration."""

    @staticmethod
    def _configured_model(mock_dynamodb, item: dict) -> str:
        """OpenAI's model as read from a config table whose row is ``item``, cache cleared first."""
        mock_db, mock_table = mock_dynamodb
        mock_table.get_item.return_value = {'Item': item}

        with patch.object(handler, 'dynamodb', mock_db):
            handler._provider_model_cache.clear()
            return handler.get_provider_model('openai')

    def test_returns_default_when_no_config(self, mock_dynamodb):
        """Falls back to default model when no config exists."""
        assert self._configured_model(mock_dynamodb, {}) == 'gpt-5-mini'

    def test_returns_configured_model(self, mock_dynamodb):
        """Returns model from ProviderConfig table when set."""
        assert self._configured_model(mock_dynamodb, {'provider_id': 'openai', 'model': 'gpt-5.2'}) == 'gpt-5.2'

    def test_falls_back_to_the_default_when_the_configured_model_is_blank(self, mock_dynamodb):
        """An empty ``model`` attribute means "not configured", not "use the empty string"."""
        assert self._configured_model(mock_dynamodb, {'provider_id': 'openai', 'model': ''}) == 'gpt-5-mini'

    def test_caches_result(self, mock_dynamodb):
        """Model is cached after first lookup."""
        mock_db, mock_table = mock_dynamodb
        mock_table.get_item.return_value = {
            'Item': {'provider_id': 'openai', 'model': 'gpt-5.2'}
        }

        with patch.object(handler, 'dynamodb', mock_db):
            handler._provider_model_cache.clear()
            handler.get_provider_model('openai')
            handler.get_provider_model('openai')
            # Should only call DynamoDB once
            assert mock_table.get_item.call_count == 1

    def test_raises_when_dynamodb_fails(self, mock_dynamodb):
        """Fails closed: raises instead of silently substituting the default.

        A transient DynamoDB error must not cause us to invoke a different
        model than the admin configured. The caller is expected to catch
        and skip the provider for this run.
        """
        mock_db, mock_table = mock_dynamodb
        mock_table.get_item.side_effect = Exception('DynamoDB error')

        with patch.object(handler, 'dynamodb', mock_db):
            handler._provider_model_cache.clear()
            with pytest.raises(handler.ProviderConfigUnavailableError):
                handler.get_provider_model('openai')

    def test_default_models_for_all_providers(self, mock_dynamodb):
        """Each provider has a sensible default model."""
        mock_db, mock_table = mock_dynamodb
        mock_table.get_item.return_value = {'Item': {}}

        with patch.object(handler, 'dynamodb', mock_db):
            handler._provider_model_cache.clear()

            assert handler.get_provider_model('openai') == 'gpt-5-mini'
            handler._provider_model_cache.clear()
            assert handler.get_provider_model('perplexity') == 'sonar'
            handler._provider_model_cache.clear()
            assert handler.get_provider_model('gemini') == 'gemini-3-flash-preview'


class TestIsProviderEnabled:
    """Tests for is_provider_enabled() — fail-closed on config read errors.

    Regression guard: a prior version returned True on DynamoDB errors, which
    meant a transient outage could silently run a provider the admin disabled.
    User intent (the disable flag) must win over infra failures.
    """

    def test_returns_true_when_config_item_has_enabled_true(self, mock_dynamodb):
        mock_db, mock_table = mock_dynamodb
        mock_table.get_item.return_value = {
            'Item': {'provider_id': 'openai', 'enabled': True}
        }

        with patch.object(handler, 'dynamodb', mock_db):
            assert handler.is_provider_enabled('openai') is True

    def test_returns_false_when_config_item_has_enabled_false(self, mock_dynamodb):
        mock_db, mock_table = mock_dynamodb
        mock_table.get_item.return_value = {
            'Item': {'provider_id': 'openai', 'enabled': False}
        }

        with patch.object(handler, 'dynamodb', mock_db):
            assert handler.is_provider_enabled('openai') is False

    def test_returns_true_when_no_config_row_exists(self, mock_dynamodb):
        """First-run default: no row yet means the provider is enabled."""
        mock_db, mock_table = mock_dynamodb
        mock_table.get_item.return_value = {}

        with patch.object(handler, 'dynamodb', mock_db):
            assert handler.is_provider_enabled('openai') is True

    def test_returns_false_when_dynamodb_read_fails(self, mock_dynamodb):
        """Fails closed: a DynamoDB outage must not override a user disable.

        Reverting this to the old fail-open behavior would make this test fail.
        """
        mock_db, mock_table = mock_dynamodb
        mock_table.get_item.side_effect = Exception('DynamoDB ThrottlingException')

        with patch.object(handler, 'dynamodb', mock_db):
            assert handler.is_provider_enabled('openai') is False

    def test_does_not_leak_exception_details_in_log_message(
        self, mock_dynamodb, caplog,
    ):
        """The message line names the error type only, never str(e), which
        can contain table names or other infra details; those stay in the
        traceback the record carries alongside it."""
        import logging

        mock_db, mock_table = mock_dynamodb
        mock_table.get_item.side_effect = RuntimeError('Sensitive: table arn:aws:dynamodb:...')

        with patch.object(handler, 'dynamodb', mock_db):
            with caplog.at_level(logging.ERROR, logger='search_handler_prompts'):
                handler.is_provider_enabled('openai')

        assert any(
            'provider_config_read_failed' in record.message
            and 'Sensitive' not in record.message
            for record in caplog.records
        )


@pytest.fixture
def openai_client():
    """A stub OpenAI client answering every Responses API call with an empty output, patched into the handler."""
    client = MagicMock()
    client.responses_with_web_search.return_value = {'output': [], 'output_text': 'response', 'usage': {}}

    with patch.object(handler, 'OpenAIClient', return_value=client):
        yield client


class TestQueryOpenAIModel:
    """Tests for query_openai() model parameter."""

    def test_uses_provided_model(self, openai_client):
        """query_openai passes the model parameter to the client."""
        result = handler.query_openai('test keyword', 'fake-key', model='gpt-5.2')

        openai_client.responses_with_web_search.assert_called_once()
        assert openai_client.responses_with_web_search.call_args.kwargs['model'] == 'gpt-5.2'
        assert result['metadata']['model'] == 'gpt-5.2'

    def test_default_model_is_gpt41(self):
        """Default model parameter is gpt-5-mini."""
        import inspect

        sig = inspect.signature(handler.query_openai)
        assert sig.parameters['model'].default == 'gpt-5-mini'


class TestQueryTemplateSubstitution:
    """Tests for query template {keyword} substitution across providers."""

    def test_openai_uses_template(self, openai_client):
        """query_openai substitutes {keyword} in template."""
        handler.query_openai('hotels in malaga', 'key', query_template='As a family traveler, find me {keyword}')

        call_args = openai_client.responses_with_web_search.call_args
        assert call_args.kwargs.get('query') == 'As a family traveler, find me hotels in malaga'

    def test_openai_default_query_without_template(self, openai_client):
        """query_openai sends the bare keyword when no template is provided.

        This previously asserted `'Search for information about: hotels in
        malaga'`. OpenAI was the only provider whose no-template query was
        rewritten, while Perplexity and Gemini received the bare keyword — an
        uncontrolled variable in the cross-provider comparison this system
        exists to produce. Parity is now pinned in
        `test_provider_query_parity.py`.
        """
        handler.query_openai('hotels in malaga', 'key')

        call_args = openai_client.responses_with_web_search.call_args
        assert call_args.kwargs.get('query') == 'hotels in malaga'

    def test_perplexity_uses_template(self):
        """query_perplexity substitutes {keyword} in template."""

        mock_client = MagicMock()
        mock_client.chat_completion.return_value = {
            'choices': [{'message': {'content': 'response'}}],
            'model': 'sonar',
            'usage': {},
        }

        with patch.object(handler, 'PerplexityClient', return_value=mock_client):
            handler.query_perplexity(
                'hotels in malaga', 'key',
                query_template='As a business traveler, find {keyword}'
            )

        call_args = mock_client.chat_completion.call_args
        messages = call_args.args[0]
        assert messages[0]['content'] == 'As a business traveler, find hotels in malaga'

    def test_gemini_uses_template(self):
        """query_gemini substitutes {keyword} in template."""

        mock_client = MagicMock()
        mock_client.generate_content.return_value = {'candidates': []}

        with patch.object(handler, 'GeminiClient', return_value=mock_client):
            handler.query_gemini(
                'hotels in malaga', 'key',
                query_template='From the US, find me {keyword}'
            )

        call_args = mock_client.generate_content.call_args
        assert call_args.args[0] == 'From the US, find me hotels in malaga'


@pytest.fixture
def store_search_results():
    """Storage stubbed to succeed; yields the mock so a test can read what would have been stored."""
    with patch.object(handler, 'store_search_results', return_value=True) as mock_store:
        yield mock_store


@pytest.fixture
def execute_all_providers(store_search_results):
    """The provider fan-out stubbed to return no results, with storage stubbed too; yields the mock."""
    with patch.object(handler, 'execute_all_providers', return_value=[]) as mock_exec:
        yield mock_exec


def _prompt(prompt_id: str, name: str) -> dict:
    """A query prompt whose template is ``"<name> {keyword}"``."""
    return {'id': prompt_id, 'name': name, 'template': f'{name} {{keyword}}'}


def _search_event(*prompts: dict) -> dict:
    """A search event for keyword ``test``; ``prompts`` become its query_prompts, none leaves the key out."""
    event: dict[str, Any] = {'keyword': 'test', 'timestamp': '2026-01-01T00:00:00Z'}
    if prompts:
        event['query_prompts'] = list(prompts)
    return event


def _successful_result(response: str) -> dict:
    """One successful OpenAI provider result carrying ``response`` and no citations."""
    return {
        'provider': 'openai', 'response': response, 'citations': [],
        'status': 'success', 'raw_response': None, 'metadata': {},
    }


class TestHandlerPromptLoop:
    """Tests for handler() looping over query prompts."""

    def test_handler_with_no_prompts_uses_default(self, execute_all_providers):
        """When no query_prompts in event, uses default single query."""
        handler.handler(_search_event(), {})

        execute_all_providers.assert_called_once()
        assert execute_all_providers.call_args.kwargs.get('query_template') is None

    def test_handler_with_multiple_prompts(self, execute_all_providers):
        """Handler calls execute_all_providers once per prompt."""
        handler.handler(_search_event(_prompt('p1', 'Family'), _prompt('p2', 'Business')), {})

        assert execute_all_providers.call_count == 2

    def test_handler_tags_results_with_prompt_id(self, execute_all_providers, store_search_results):
        """Results are tagged with query_prompt_id and query_prompt_name."""
        execute_all_providers.return_value = [_successful_result('test')]

        handler.handler(_search_event(_prompt('p1', 'Family')), {})

        # Check that store was called with results tagged with prompt info
        stored_results = store_search_results.call_args.args[2]
        assert stored_results[0]['query_prompt_id'] == 'p1'
        assert stored_results[0]['query_prompt_name'] == 'Family'

    def test_handler_continues_on_prompt_error(self, execute_all_providers):
        """If one prompt fails, handler continues with remaining prompts."""
        call_count = 0

        def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise RuntimeError('API error')
            return [_successful_result('ok')]

        execute_all_providers.side_effect = side_effect

        result = handler.handler(_search_event(_prompt('p1', 'Failing'), _prompt('p2', 'Working')), {})

        # Should have results from the second prompt only
        assert len(result['results']) == 1
