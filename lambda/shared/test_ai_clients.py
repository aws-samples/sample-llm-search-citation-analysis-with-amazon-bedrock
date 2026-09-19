"""
Tests for shared.ai_clients.

The retrying clients moved here verbatim from ``lambda/search/api_clients.py``
and the registry replaces keyword-research's drifted simplified copies
(bugs.md 3.1). These tests pin the consolidated contract:

- registry entries (order, secret names) drive step order
- ``get_web_search_clients`` skips unconfigured providers
- ``run_web_search`` returns extracted text, passes the caller's retry
  budget through to the client, and lets provider errors propagate (the
  research step, not the client, records them)
- per-provider text extraction matches each API's response shape
- clients retry retryable statuses and the OpenAI payload carries
  ``include: web_search_call.action.sources`` — the two behaviors the
  drifted keyword-research copies lost
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from shared import ai_clients
from shared.ai_clients import (
    WEB_SEARCH_PROVIDERS,
    OpenAIClient,
    PerplexityClient,
    get_web_search_clients,
    get_web_search_provider,
    run_web_search,
)

_PERPLEXITY, _OPENAI, _GEMINI = WEB_SEARCH_PROVIDERS


class TestRegistry:
    def test_step_order_is_perplexity_openai_gemini(self):
        assert [p.provider_id for p in WEB_SEARCH_PROVIDERS] == [
            'perplexity', 'openai', 'gemini',
        ]

    def test_registry_maps_each_provider_to_its_secret_name(self):
        assert {p.provider_id: p.secret_name for p in WEB_SEARCH_PROVIDERS} == {
            'perplexity': 'perplexity-key',
            'openai': 'openai-key',
            'gemini': 'gemini-key',
        }

    def test_lookup_by_id_returns_the_registry_entry(self):
        assert get_web_search_provider('openai') is _OPENAI

    def test_lookup_of_an_unknown_id_returns_none(self):
        assert get_web_search_provider('bing') is None


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


class TestRunWebSearch:
    def test_returns_the_extracted_text_from_the_provider_response(self):
        client = MagicMock()
        client.chat_completion.return_value = {
            'choices': [{'message': {'content': 'perplexity says'}}],
        }

        assert run_web_search(_PERPLEXITY, client, 'prompt') == 'perplexity says'

    def test_passes_the_retry_budget_through_to_the_client(self):
        client = MagicMock()
        client.responses_with_web_search.return_value = {'output': [], 'output_text': 'openai says'}

        run_web_search(_OPENAI, client, 'prompt', max_retries=2)

        client.responses_with_web_search.assert_called_once_with(query='prompt', max_retries=2)

    def test_defaults_to_the_clients_five_retries(self):
        client = MagicMock()
        client.generate_content.return_value = {'candidates': []}

        run_web_search(_GEMINI, client, 'prompt')

        client.generate_content.assert_called_once_with('prompt', max_retries=5)

    def test_propagates_the_provider_error_instead_of_swallowing_it(self):
        client = MagicMock()
        error = RuntimeError('rate limited')
        client.chat_completion.side_effect = error

        with pytest.raises(RuntimeError) as raised:
            run_web_search(_PERPLEXITY, client, 'prompt')

        assert raised.value is error


class TestClientBehavior:
    def test_perplexity_client_retries_a_rate_limited_request(self):
        rate_limited = MagicMock(status_code=429, text='slow down', headers={})
        ok = MagicMock(status_code=200)
        ok.json.return_value = {'choices': []}

        with (
            patch.object(ai_clients.requests, 'post', side_effect=[rate_limited, ok]) as post,
            patch.object(ai_clients.time, 'sleep') as sleep,
            patch.object(ai_clients.random, 'uniform', return_value=0.25),
        ):
            result = PerplexityClient('sk-test').chat_completion(
                [{'role': 'user', 'content': 'q'}]
            )

        assert result == {'choices': []}
        assert post.call_count == 2
        sleep.assert_called_once_with(1.25)

    def test_throttling_earns_extra_attempts_beyond_the_callers_retry_budget(self):
        """The research worker allows two attempts (sized for OpenAI's 90s timeout).

        A 429 answers instantly and is cheap to wait out, so it must not be
        spent from that budget: with ``max_retries=2`` the client keeps
        retrying a throttled request for three more attempts.
        """
        rate_limited = MagicMock(status_code=429, text='slow down', headers={})
        ok = MagicMock(status_code=200)
        ok.json.return_value = {'choices': []}
        responses = [rate_limited, rate_limited, rate_limited, rate_limited, ok]

        with (
            patch.object(ai_clients.requests, 'post', side_effect=responses) as post,
            patch.object(ai_clients.time, 'sleep') as sleep,
            patch.object(ai_clients.random, 'uniform', return_value=0.0),
        ):
            result = PerplexityClient('sk-test').chat_completion(
                [{'role': 'user', 'content': 'q'}], max_retries=2
            )

        assert result == {'choices': []}
        assert post.call_count == 5
        assert [call.args[0] for call in sleep.call_args_list] == [1.0, 2.5, 5.0, 9.5]

    def test_throttling_gives_up_after_the_extra_attempts(self):
        rate_limited = MagicMock(status_code=429, text='slow down', headers={})
        rate_limited.raise_for_status.side_effect = ai_clients.requests.exceptions.HTTPError(
            '429 Client Error', response=rate_limited
        )

        with (
            patch.object(ai_clients.requests, 'post', return_value=rate_limited) as post,
            patch.object(ai_clients.time, 'sleep'),
            patch.object(ai_clients.random, 'uniform', return_value=0.0),
            pytest.raises(ai_clients.requests.exceptions.HTTPError, match='429 Client Error'),
        ):
            PerplexityClient('sk-test').chat_completion([{'role': 'user', 'content': 'q'}], max_retries=2)

        assert post.call_count == 5

    def test_server_errors_keep_the_callers_retry_budget(self):
        """5xx and timeouts are the slow failures the caller's budget is sized for."""
        server_error = MagicMock(status_code=503, text='unavailable', headers={})
        server_error.raise_for_status.side_effect = ai_clients.requests.exceptions.HTTPError(
            '503 Server Error', response=server_error
        )

        with (
            patch.object(ai_clients.requests, 'post', return_value=server_error) as post,
            patch.object(ai_clients.time, 'sleep') as sleep,
            pytest.raises(ai_clients.requests.exceptions.HTTPError, match='503 Server Error'),
        ):
            PerplexityClient('sk-test').chat_completion([{'role': 'user', 'content': 'q'}], max_retries=2)

        assert post.call_count == 2
        sleep.assert_called_once_with(1.0)

    def test_throttle_wait_honours_retry_after_and_adds_jitter(self):
        response = MagicMock(headers={'Retry-After': '4'})

        with patch.object(ai_clients.random, 'uniform', return_value=1.5) as uniform:
            wait = ai_clients._throttle_wait_seconds(response, attempt=0)

        assert wait == 5.5
        uniform.assert_called_once_with(0, 4.0)

    def test_throttle_wait_falls_back_to_backoff_when_retry_after_is_unusable(self):
        response = MagicMock(headers={'Retry-After': 'Fri, 19 Sep 2026 10:00:00 GMT'})

        with patch.object(ai_clients.random, 'uniform', return_value=0.0):
            wait = ai_clients._throttle_wait_seconds(response, attempt=2)

        assert wait == 5.0

    def test_throttle_wait_is_capped(self):
        response = MagicMock(headers={'Retry-After': '120'})

        with patch.object(ai_clients.random, 'uniform', return_value=0.0):
            wait = ai_clients._throttle_wait_seconds(response, attempt=0)

        assert wait == ai_clients.THROTTLE_MAX_WAIT_SECONDS

    def test_openai_payload_requests_web_search_call_sources(self):
        with patch.object(
            OpenAIClient, '_make_request', return_value={'output': []}
        ) as make_request:
            OpenAIClient('sk-test').responses_with_web_search('query text')

        payload = make_request.call_args.args[0]
        assert payload['include'] == ['web_search_call.action.sources']
        assert payload['input'] == 'query text'
