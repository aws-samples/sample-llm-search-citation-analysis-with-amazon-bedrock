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
from testing.env import cleared_env

_PERPLEXITY, _OPENAI, _GEMINI = WEB_SEARCH_PROVIDERS
# A fixed ``time.time()`` for ``x-ratelimit-reset`` epoch arithmetic.
_NOW = 1_800_000_000.0


@pytest.fixture(autouse=True)
def _default_throttle_budget():
    """Every test starts from the default budget, whatever the developer's shell exports."""
    with cleared_env(ai_clients.THROTTLE_EXTRA_ATTEMPTS_ENV):
        yield


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
    @pytest.mark.parametrize(('headers', 'expected_wait'), [
        ({}, 1.25),
        ({'x-ratelimit-reset': str(_NOW + 4)}, 4.25),
    ], ids=['backoff-without-headers', 'waits-for-x-ratelimit-reset'])
    def test_perplexity_client_retries_a_rate_limited_request_after_the_throttle_wait(self, headers, expected_wait):
        rate_limited = MagicMock(status_code=429, text='slow down', headers=headers)
        ok = MagicMock(status_code=200)
        ok.json.return_value = {'choices': []}

        with (
            patch.object(ai_clients.requests, 'post', side_effect=[rate_limited, ok]) as post,
            patch.object(ai_clients.time, 'time', return_value=_NOW),
            patch.object(ai_clients.time, 'sleep') as sleep,
            patch.object(ai_clients.random, 'uniform', return_value=0.25),
        ):
            result = PerplexityClient('sk-test').chat_completion(
                [{'role': 'user', 'content': 'q'}]
            )

        assert result == {'choices': []}
        assert post.call_count == 2
        sleep.assert_called_once_with(expected_wait)

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

    @pytest.mark.parametrize(('env', 'expected_attempts'), [
        ({}, 5),
        ({'PROVIDER_THROTTLE_EXTRA_ATTEMPTS': '0'}, 2),
        ({'PROVIDER_THROTTLE_EXTRA_ATTEMPTS': '12'}, 14),
        ({'PROVIDER_THROTTLE_EXTRA_ATTEMPTS': 'lots'}, 5),
    ], ids=['default-3', 'env-0', 'env-12', 'invalid-env-falls-back-to-3'])
    def test_throttling_gives_up_after_the_extra_attempts(self, env, expected_attempts):
        rate_limited = MagicMock(status_code=429, text='slow down', headers={})
        rate_limited.raise_for_status.side_effect = ai_clients.requests.exceptions.HTTPError(
            '429 Client Error', response=rate_limited
        )

        with (
            patch.dict(ai_clients.os.environ, env),
            patch.object(ai_clients.requests, 'post', return_value=rate_limited) as post,
            patch.object(ai_clients.time, 'sleep'),
            patch.object(ai_clients.random, 'uniform', return_value=0.0),
            pytest.raises(ai_clients.requests.exceptions.HTTPError, match='429 Client Error'),
        ):
            PerplexityClient('sk-test').chat_completion([{'role': 'user', 'content': 'q'}], max_retries=2)

        assert post.call_count == expected_attempts

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

    @pytest.mark.parametrize(('headers', 'attempt', 'expected'), [
        ({'x-ratelimit-reset': str(_NOW + 6)}, 0, 6.0),
        ({'x-ratelimit-reset': '3'}, 0, 3.0),
        ({'x-ratelimit-reset': str(_NOW - 10)}, 2, 5.0),
        ({'x-ratelimit-reset': 'soon'}, 1, 2.5),
        ({'x-ratelimit-reset': '2'}, 3, 9.5),
        ({'Retry-After': '7', 'x-ratelimit-reset': str(_NOW + 2)}, 0, 7.0),
    ], ids=[
        'epoch-reset-in-6s', 'reset-as-seconds', 'reset-in-the-past-uses-backoff',
        'unparseable-reset-uses-backoff', 'backoff-longer-than-reset-wins', 'retry-after-wins-over-reset',
    ])
    def test_throttle_wait_is_the_longer_of_the_providers_wait_and_the_backoff(self, headers, attempt, expected):
        with (
            patch.object(ai_clients.time, 'time', return_value=_NOW),
            patch.object(ai_clients.random, 'uniform', return_value=0.0),
        ):
            wait = ai_clients._throttle_wait_seconds(MagicMock(headers=headers), attempt=attempt)

        assert wait == expected

    def test_throttle_wait_adds_jitter_up_to_the_ratelimit_reset(self):
        response = MagicMock(headers={'x-ratelimit-reset': str(_NOW + 6)})

        with (
            patch.object(ai_clients.time, 'time', return_value=_NOW),
            patch.object(ai_clients.random, 'uniform', return_value=2.0) as uniform,
        ):
            wait = ai_clients._throttle_wait_seconds(response, attempt=0)

        assert (wait, uniform.call_args.args) == (8.0, (0, 6.0))


class TestThrottleExtraAttempts:
    """``PROVIDER_THROTTLE_EXTRA_ATTEMPTS``: the analysis provider Lambdas set 12, everything else keeps 3."""

    @pytest.mark.parametrize(('raw', 'expected'), [
        (None, 3), ('12', 12), ('0', 0), (' 7 ', 7), ('', 3), ('-1', 3), ('2.5', 3), ('twelve', 3),
    ])
    def test_reads_a_non_negative_integer_or_falls_back_to_three(self, raw, expected):
        env = {} if raw is None else {ai_clients.THROTTLE_EXTRA_ATTEMPTS_ENV: raw}

        with patch.dict(ai_clients.os.environ, env):
            assert ai_clients.throttle_extra_attempts() == expected

    def test_warns_when_the_value_is_invalid(self, caplog):
        with (
            patch.dict(ai_clients.os.environ, {ai_clients.THROTTLE_EXTRA_ATTEMPTS_ENV: 'twelve'}),
            caplog.at_level('WARNING', logger='shared.ai_clients'),
        ):
            ai_clients.throttle_extra_attempts()

        assert [record.getMessage() for record in caplog.records] == [
            "[THROTTLE_CONFIG] PROVIDER_THROTTLE_EXTRA_ATTEMPTS='twelve' is not an integer >= 0; using 3",
        ]

    def test_does_not_warn_when_the_value_is_valid(self, caplog):
        with (
            patch.dict(ai_clients.os.environ, {ai_clients.THROTTLE_EXTRA_ATTEMPTS_ENV: '12'}),
            caplog.at_level('WARNING', logger='shared.ai_clients'),
        ):
            ai_clients.throttle_extra_attempts()

        assert caplog.records == []


class TestClientPayloads:
    def test_openai_payload_requests_web_search_call_sources(self):
        with patch.object(
            OpenAIClient, '_make_request', return_value={'output': []}
        ) as make_request:
            OpenAIClient('sk-test').responses_with_web_search('query text')

        payload = make_request.call_args.args[0]
        assert payload['include'] == ['web_search_call.action.sources']
        assert payload['input'] == 'query text'


    def test_openai_client_answers_with_its_own_model_unless_the_call_names_one(self):
        with patch.object(OpenAIClient, '_make_request', return_value={'output': []}) as make_request:
            client = OpenAIClient('sk-test', model='gpt-5.2')
            client.responses_with_web_search('query text')
            client.responses_with_web_search('query text', model='o4-mini')

        assert [call.args[0]['model'] for call in make_request.call_args_list] == ['gpt-5.2', 'o4-mini']

    def test_gemini_client_posts_to_the_endpoint_of_its_model(self):
        with patch.object(ai_clients.requests, 'post', return_value=MagicMock(status_code=200)) as post:
            ai_clients.GeminiClient('gm-test', model='gemini-2.5-pro').generate_content('query text', max_retries=0)

        assert post.call_args.args[0] == (
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent'
        )

    def test_clients_default_to_the_shared_default_models(self):
        assert (
            OpenAIClient('sk-test').model, ai_clients.GeminiClient('gm-test').model, ai_clients.ClaudeClient('ck-test').model,
        ) == ('gpt-5-mini', 'gemini-3-flash-preview', 'claude-sonnet-4-5')

    def test_openai_web_search_payload_is_the_one_runs_and_the_model_check_send(self):
        assert ai_clients.openai_web_search_payload('query text', 'gpt-5.2') == {
            'model': 'gpt-5.2',
            'tools': [{'type': 'web_search_preview'}],
            'tool_choice': 'auto',
            'include': ['web_search_call.action.sources'],
            'input': 'query text',
        }

    def test_gemini_grounded_payload_asks_for_google_search(self):
        assert ai_clients.gemini_grounded_payload('query text') == {
            'contents': [{'role': 'user', 'parts': [{'text': 'query text'}]}],
            'tools': [{'googleSearch': {}}],
        }

    def test_perplexity_client_defaults_to_sonar(self):
        assert ai_clients.PerplexityClient('pk-test').model == 'sonar'

    def test_perplexity_sends_the_clients_model(self):
        with patch.object(ai_clients.PerplexityClient, '_make_request', return_value={}) as request:
            ai_clients.PerplexityClient('pk-test', model='sonar-pro').chat_completion([{'role': 'user', 'content': 'q'}])

        assert request.call_args.args[0] == {'model': 'sonar-pro', 'messages': [{'role': 'user', 'content': 'q'}]}

    def test_perplexity_sends_a_model_given_for_one_call(self):
        with patch.object(ai_clients.PerplexityClient, '_make_request', return_value={}) as request:
            ai_clients.PerplexityClient('pk-test').chat_completion([{'role': 'user', 'content': 'q'}], model='sonar-reasoning-pro')

        assert request.call_args.args[0]['model'] == 'sonar-reasoning-pro'

    def test_claude_sends_the_clients_model_with_the_web_search_tool(self):
        with patch.object(ai_clients.ClaudeClient, '_make_request', return_value={}) as request:
            ai_clients.ClaudeClient('ck-test', model='claude-opus-4-7').generate_content('q', system_prompt='cite sources')

        assert request.call_args.args[0] == {
            'model': 'claude-opus-4-7',
            'max_tokens': 1024,
            'messages': [{'role': 'user', 'content': 'q'}],
            'tools': [{'type': 'web_search_20250305', 'name': 'web_search', 'max_uses': 5}],
            'system': 'cite sources',
        }

    def test_claude_payload_has_no_system_prompt_unless_given(self):
        assert 'system' not in ai_clients.claude_web_search_payload('q', 'claude-sonnet-4-6')

    def test_claude_posts_to_the_messages_api_with_the_anthropic_headers(self):
        with patch.object(ai_clients.requests, 'post', return_value=MagicMock(status_code=200, json=lambda: {})) as post:
            ai_clients.ClaudeClient('ck-test').generate_content('q', max_retries=0)

        assert (post.call_args.args[0], post.call_args.kwargs['headers']) == (
            'https://api.anthropic.com/v1/messages',
            {'x-api-key': 'ck-test', 'anthropic-version': '2023-06-01', 'content-type': 'application/json'},
        )

    def test_perplexity_posts_to_the_sonar_chat_api(self):
        with patch.object(ai_clients.requests, 'post', return_value=MagicMock(status_code=200, json=lambda: {})) as post:
            ai_clients.PerplexityClient('pk-test').chat_completion([{'role': 'user', 'content': 'q'}], max_retries=0)

        assert post.call_args.args[0] == 'https://api.perplexity.ai/chat/completions'

    def test_openai_and_perplexity_calls_allow_five_retries_by_default(self):
        with (
            patch.object(OpenAIClient, '_make_request', return_value={}) as openai_request,
            patch.object(ai_clients.PerplexityClient, '_make_request', return_value={}) as perplexity_request,
        ):
            OpenAIClient('sk-test').responses_with_web_search('query text')
            ai_clients.PerplexityClient('pk-test').chat_completion([{'role': 'user', 'content': 'query text'}])

        assert (openai_request.call_args.kwargs, perplexity_request.call_args.kwargs) == (
            {'max_retries': 5}, {'max_retries': 5},
        )
