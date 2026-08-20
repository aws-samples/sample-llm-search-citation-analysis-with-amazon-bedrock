"""
Tests for shared.ai_clients.

The retrying clients moved here verbatim from ``lambda/search/api_clients.py``
and the registry replaces keyword-research's drifted simplified copies
(bugs.md 3.1). These tests pin the consolidated contract:

- registry entries (order, secret names) drive fallback preference
- ``get_web_search_clients`` skips unconfigured providers
- ``search_with_fallback`` returns extracted text from the first success,
  falls through provider errors, and re-raises the last error
- per-provider text extraction matches each API's response shape
- clients retry retryable statuses and the OpenAI payload carries
  ``include: web_search_call.action.sources`` — the two behaviors the
  drifted keyword-research copies lost
"""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from shared import ai_clients
from shared.ai_clients import (
    WEB_SEARCH_PROVIDERS,
    OpenAIClient,
    PerplexityClient,
    get_web_search_clients,
    search_with_fallback,
)

_PERPLEXITY, _OPENAI, _GEMINI = WEB_SEARCH_PROVIDERS


class TestRegistry:
    def test_fallback_preference_order_is_perplexity_openai_gemini(self):
        assert [p.provider_id for p in WEB_SEARCH_PROVIDERS] == [
            'perplexity', 'openai', 'gemini',
        ]

    def test_registry_maps_each_provider_to_its_secret_name(self):
        assert {p.provider_id: p.secret_name for p in WEB_SEARCH_PROVIDERS} == {
            'perplexity': 'perplexity-key',
            'openai': 'openai-key',
            'gemini': 'gemini-key',
        }


class TestGetWebSearchClients:
    def test_skips_providers_without_a_configured_key(self):
        def only_openai(name):
            return 'sk-test' if name == 'openai-key' else None

        with patch.object(ai_clients, 'get_api_key', side_effect=only_openai):
            clients = get_web_search_clients()

        assert [provider.provider_id for provider, _client in clients] == ['openai']
        assert isinstance(clients[0][1], OpenAIClient)

    def test_returns_empty_list_when_no_provider_is_configured(self):
        with patch.object(ai_clients, 'get_api_key', return_value=None):
            assert get_web_search_clients() == []


class TestTextExtraction:
    def test_perplexity_text_comes_from_first_choice_message_content(self):
        text = _PERPLEXITY.extract_text(
            {'choices': [{'message': {'content': 'perplexity says'}}]}
        )

        assert text == 'perplexity says'

    def test_perplexity_returns_empty_string_when_response_has_no_choices(self):
        assert _PERPLEXITY.extract_text({'choices': []}) == ''

    def test_openai_text_comes_from_output_message_blocks(self):
        text = _OPENAI.extract_text({
            'output': [
                {'type': 'web_search_call', 'action': {}},
                {'type': 'message', 'content': [{'type': 'output_text', 'text': 'openai says'}]},
            ],
        })

        assert text == 'openai says'

    def test_openai_falls_back_to_top_level_output_text(self):
        assert _OPENAI.extract_text({'output': [], 'output_text': 'fallback text'}) == 'fallback text'

    def test_gemini_text_joins_candidate_parts_with_spaces(self):
        text = _GEMINI.extract_text({
            'candidates': [{'content': {'parts': [{'text': 'gemini'}, {'text': 'says'}]}}],
        })

        assert text == 'gemini says'

    def test_gemini_returns_empty_string_when_response_has_no_candidates(self):
        assert _GEMINI.extract_text({'candidates': []}) == ''


class TestSearchWithFallback:
    def test_returns_extracted_text_and_provider_id_from_first_success(self):
        client = MagicMock()
        client.chat_completion.return_value = {
            'choices': [{'message': {'content': 'perplexity says'}}],
        }

        text, provider_id = search_with_fallback([(_PERPLEXITY, client)], 'prompt')

        assert (text, provider_id) == ('perplexity says', 'perplexity')

    def test_falls_through_to_next_provider_when_the_first_errors(self):
        failing = MagicMock()
        failing.chat_completion.side_effect = RuntimeError('rate limited')
        working = MagicMock()
        working.responses_with_web_search.return_value = {
            'output': [], 'output_text': 'openai says',
        }

        text, provider_id = search_with_fallback(
            [(_PERPLEXITY, failing), (_OPENAI, working)], 'prompt'
        )

        assert (text, provider_id) == ('openai says', 'openai')

    def test_reraises_the_last_error_when_every_provider_fails(self):
        first = MagicMock()
        first.chat_completion.side_effect = RuntimeError('first down')
        last_error = RuntimeError('second down')
        second = MagicMock()
        second.responses_with_web_search.side_effect = last_error

        with pytest.raises(RuntimeError) as raised:
            search_with_fallback([(_PERPLEXITY, first), (_OPENAI, second)], 'prompt')

        assert raised.value is last_error


class TestClientBehavior:
    def test_perplexity_client_retries_a_rate_limited_request(self):
        rate_limited = MagicMock(status_code=429, text='slow down')
        ok = MagicMock(status_code=200)
        ok.json.return_value = {'choices': []}

        with (
            patch.object(ai_clients.requests, 'post', side_effect=[rate_limited, ok]) as post,
            patch.object(ai_clients.time, 'sleep') as sleep,
        ):
            result = PerplexityClient('sk-test').chat_completion(
                [{'role': 'user', 'content': 'q'}]
            )

        assert result == {'choices': []}
        assert post.call_count == 2
        sleep.assert_called_once_with(1.0)

    def test_openai_payload_requests_web_search_call_sources(self):
        with patch.object(
            OpenAIClient, '_make_request', return_value={'output': []}
        ) as make_request:
            OpenAIClient('sk-test').responses_with_web_search('query text')

        payload = make_request.call_args.args[0]
        assert payload['include'] == ['web_search_call.action.sources']
        assert payload['input'] == 'query text'
