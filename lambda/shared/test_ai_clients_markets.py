"""
Tests for the 2.37.0 provider refresh in ``shared.ai_clients``.

- every payload builder adds a market's instructions and native location
  hint, and leaves the body untouched without one (the query never changes)
- the clients' per-attempt timeouts, and the research worker's override
- a 4xx answer is not retried (it cannot succeed when sent again)
- Claude: the ``allowed_callers`` fallback and the retry of in-body
  web search errors (raw shapes in ``testing.provider_response_fixtures``)
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from shared import ai_clients
from shared.ai_clients import ClaudeClient, ClaudeSearchError, GeminiClient, OpenAIClient, PerplexityClient
from testing.provider_response_fixtures import (
    CHILE_INSTRUCTIONS,
    CHILE_USER_LOCATION,
    CLAUDE_CALLERS_REFUSAL,
    CLAUDE_DIRECT_RESPONSE,
    CLAUDE_DYNAMIC_FILTERING_RESPONSE,
    build_market,
    claude_search_error_response,
)

_QUERY = '¿Es Altiplano una buena aerolínea?'
_CLAUDE = 'claude-sonnet-5-5'


def _reply(status_code: int, body: dict[str, Any]) -> MagicMock:
    """A ``requests`` response with ``status_code`` and JSON ``body`` (``raise_for_status`` raises for >= 400)."""
    response = MagicMock(status_code=status_code, text=json.dumps(body), headers={})
    response.json.return_value = body
    if status_code >= 400:
        response.raise_for_status.side_effect = ai_clients.requests.exceptions.HTTPError(
            f'{status_code} Client Error', response=response,
        )
    return response


@pytest.fixture
def http() -> Iterator[SimpleNamespace]:
    """``requests.post`` (answering 200 ``{}`` unless a test says otherwise) and ``time.sleep``, patched."""
    with (
        patch.object(ai_clients.requests, 'post', return_value=_reply(200, {})) as post,
        patch.object(ai_clients.time, 'sleep') as sleep,
    ):
        yield SimpleNamespace(post=post, sleep=sleep)


def _sent_callers(post: MagicMock) -> list[Any]:
    """The web search tool's ``allowed_callers`` in every request sent, in order (``None`` when unset)."""
    return [call.kwargs['json']['tools'][0].get('allowed_callers') for call in post.call_args_list]


def _ask_claude(http: SimpleNamespace, *replies: MagicMock, market: Any = None) -> dict[str, Any]:
    """Claude's answer when the Messages API replies ``replies`` in turn."""
    http.post.side_effect = list(replies)
    return ClaudeClient('ck-test').generate_content(_QUERY, market=market)


class TestOpenAIMarketPayload:
    def test_adds_the_market_instructions_and_the_approximate_user_location(self):
        payload = ai_clients.openai_web_search_payload(_QUERY, 'gpt-5-mini', build_market())

        assert (payload['instructions'], payload['tools']) == (
            CHILE_INSTRUCTIONS, [{'type': 'web_search', 'user_location': CHILE_USER_LOCATION}],
        )

    def test_keeps_the_query_as_the_input(self):
        assert ai_clients.openai_web_search_payload(_QUERY, 'gpt-5-mini', build_market())['input'] == _QUERY

    def test_requires_the_search_with_or_without_a_market(self):
        payloads = [ai_clients.openai_web_search_payload(_QUERY, 'gpt-5-mini', market) for market in (None, build_market())]

        assert [payload['tool_choice'] for payload in payloads] == ['required', 'required']

    def test_sends_no_instructions_without_a_market(self):
        assert 'instructions' not in ai_clients.openai_web_search_payload(_QUERY, 'gpt-5-mini')

    def test_leaves_out_the_location_fields_a_market_does_not_set(self):
        market = build_market(city=None, region=None, lat=None, lng=None)

        tool, = ai_clients.openai_web_search_payload(_QUERY, 'gpt-5-mini', market)['tools']

        assert tool['user_location'] == {'type': 'approximate', 'country': 'CL', 'timezone': 'America/Santiago'}


class TestPerplexityMarketPayload:
    def test_adds_the_market_instructions(self):
        payload = ai_clients.perplexity_agent_payload(_QUERY, 'perplexity/sonar', build_market())

        assert payload['instructions'] == CHILE_INSTRUCTIONS

    def test_gives_the_web_search_tool_the_location_with_coordinates(self):
        tool, = ai_clients.perplexity_agent_payload(_QUERY, 'perplexity/sonar', build_market())['tools']

        assert tool == {
            'type': 'web_search',
            'user_location': {
                'country': 'CL', 'region': 'Región Metropolitana', 'city': 'Santiago',
                'latitude': -33.45, 'longitude': -70.66,
            },
        }

    def test_keeps_the_query_as_the_input(self):
        assert ai_clients.perplexity_agent_payload(_QUERY, 'perplexity/sonar', build_market())['input'] == _QUERY

    def test_takes_a_smaller_output_budget_for_the_model_check(self):
        assert ai_clients.perplexity_agent_payload(_QUERY, 'perplexity/sonar', max_output_tokens=64)['max_output_tokens'] == 64


class TestGeminiMarketPayload:
    def test_sends_the_market_as_the_system_instruction(self):
        payload = ai_clients.gemini_grounded_payload(_QUERY, build_market())

        assert payload['systemInstruction'] == {'parts': [{'text': CHILE_INSTRUCTIONS}]}

    def test_keeps_the_query_as_the_only_user_turn(self):
        payload = ai_clients.gemini_grounded_payload(_QUERY, build_market())

        assert payload['contents'] == [{'role': 'user', 'parts': [{'text': _QUERY}]}]


class TestClaudeMarketPayload:
    @pytest.mark.parametrize(('system_prompt', 'system'), [
        ('Cite sources.', f'{CHILE_INSTRUCTIONS}\n\nCite sources.'),
        (None, CHILE_INSTRUCTIONS),
    ], ids=['with-system-prompt', 'market-only'])
    def test_puts_the_market_ahead_of_the_system_prompt(self, system_prompt, system):
        payload = ai_clients.claude_web_search_payload(_QUERY, _CLAUDE, system_prompt=system_prompt, market=build_market())

        assert payload['system'] == system

    def test_gives_the_web_search_tool_the_approximate_user_location(self):
        tool, = ai_clients.claude_web_search_payload(_QUERY, _CLAUDE, market=build_market())['tools']

        assert tool == {'type': 'web_search_20260318', 'name': 'web_search', 'user_location': CHILE_USER_LOCATION}

    def test_never_caps_the_searches_or_drops_the_results(self):
        tool, = ai_clients.claude_web_search_payload(_QUERY, _CLAUDE)['tools']

        assert ('max_uses' in tool, 'response_inclusion' in tool) == (False, False)

    def test_names_the_direct_callers_only_when_asked(self):
        payloads = [
            ai_clients.claude_web_search_payload(_QUERY, _CLAUDE, allowed_callers=callers)
            for callers in (None, ai_clients.CLAUDE_DIRECT_CALLERS)
        ]

        assert [payload['tools'][0].get('allowed_callers') for payload in payloads] == [None, ['direct']]

    def test_keeps_the_query_as_the_only_user_turn(self):
        payload = ai_clients.claude_web_search_payload(_QUERY, _CLAUDE, market=build_market())

        assert payload['messages'] == [{'role': 'user', 'content': _QUERY}]


class TestClientsSendTheMarket:
    @pytest.mark.parametrize(('client', 'ask', 'read_market'), [
        (OpenAIClient('k'), lambda client, market: client.responses_with_web_search(_QUERY, market=market),
         lambda body: body['instructions']),
        (PerplexityClient('k'), lambda client, market: client.agent_response(_QUERY, market),
         lambda body: body['instructions']),
        (GeminiClient('k'), lambda client, market: client.generate_content(_QUERY, market=market),
         lambda body: body['systemInstruction']['parts'][0]['text']),
        (ClaudeClient('k'), lambda client, market: client.generate_content(_QUERY, market=market),
         lambda body: body['system']),
    ], ids=['openai', 'perplexity', 'gemini', 'claude'])
    def test_sends_the_market_instructions(self, http, client, ask, read_market):
        ask(client, build_market())

        assert read_market(http.post.call_args.kwargs['json']) == CHILE_INSTRUCTIONS


class TestTimeouts:
    @pytest.mark.parametrize(('client', 'ask', 'timeout'), [
        (OpenAIClient('k'), lambda client: client.responses_with_web_search('q', max_retries=1), 180),
        (PerplexityClient('k'), lambda client: client.agent_response('q', max_retries=1), 60),
        (GeminiClient('k'), lambda client: client.generate_content('q', max_retries=1), 60),
        (ClaudeClient('k'), lambda client: client.generate_content('q', max_retries=1), 120),
        (OpenAIClient('k', timeout=120), lambda client: client.responses_with_web_search('q', max_retries=1), 120),
    ], ids=['openai', 'perplexity', 'gemini', 'claude', 'built-with-a-timeout'])
    def test_each_attempt_waits_the_clients_timeout(self, http, client, ask, timeout):
        ask(client)

        assert http.post.call_args.kwargs['timeout'] == timeout


class TestClientErrorsAreNotRetried:
    @pytest.mark.parametrize('status', [400, 401, 404, 422])
    def test_sends_a_refused_request_once(self, http, status):
        http.post.return_value = _reply(status, {'error': {'message': 'no'}})

        with pytest.raises(ai_clients.requests.exceptions.HTTPError):
            OpenAIClient('sk-test').responses_with_web_search('q')

        assert (http.post.call_count, http.sleep.call_count) == (1, 0)

    def test_keeps_the_body_in_the_raised_error(self, http):
        http.post.return_value = _reply(400, {'error': {'message': 'credit balance is too low'}})

        with pytest.raises(ai_clients.requests.exceptions.HTTPError, match='credit balance is too low'):
            OpenAIClient('sk-test').responses_with_web_search('q')

    def test_still_retries_a_server_error(self, http):
        http.post.side_effect = [_reply(503, {}), _reply(200, {'output': []})]

        result = OpenAIClient('sk-test').responses_with_web_search('q')

        assert (result, http.post.call_count) == ({'output': []}, 2)


class TestClaudeCallersFallback:
    def test_asks_again_with_direct_callers_when_the_model_refuses_dynamic_filtering(self, http):
        result = _ask_claude(http, _reply(400, CLAUDE_CALLERS_REFUSAL), _reply(200, CLAUDE_DIRECT_RESPONSE))

        assert (result, _sent_callers(http.post)) == (CLAUDE_DIRECT_RESPONSE, [None, ['direct']])

    def test_keeps_the_location_on_the_fallback_tool(self, http):
        _ask_claude(http, _reply(400, CLAUDE_CALLERS_REFUSAL), _reply(200, CLAUDE_DIRECT_RESPONSE), market=build_market())

        assert http.post.call_args.kwargs['json']['tools'][0]['user_location'] == CHILE_USER_LOCATION

    def test_falls_back_once_only(self, http):
        with pytest.raises(ai_clients.requests.exceptions.HTTPError, match='allowed_callers'):
            _ask_claude(http, _reply(400, CLAUDE_CALLERS_REFUSAL), _reply(400, CLAUDE_CALLERS_REFUSAL))

        assert http.post.call_count == 2

    def test_raises_any_other_400_without_a_fallback(self, http):
        refusal = _reply(400, {'type': 'error', 'error': {'type': 'invalid_request_error', 'message': 'max_tokens too large'}})

        with pytest.raises(ai_clients.requests.exceptions.HTTPError, match='max_tokens too large'):
            _ask_claude(http, refusal)

        assert http.post.call_count == 1

    def test_answers_with_dynamic_filtering_when_the_model_accepts_it(self, http):
        result = _ask_claude(http, _reply(200, CLAUDE_DYNAMIC_FILTERING_RESPONSE))

        assert (result, http.post.call_count) == (CLAUDE_DYNAMIC_FILTERING_RESPONSE, 1)


class TestClaudeInBodySearchErrors:
    @pytest.mark.parametrize('error_code', ['too_many_requests', 'unavailable'])
    def test_asks_again_after_a_retryable_search_error(self, http, error_code):
        result = _ask_claude(http, _reply(200, claude_search_error_response(error_code)), _reply(200, CLAUDE_DIRECT_RESPONSE))

        assert (result, http.post.call_count, http.sleep.call_args.args) == (CLAUDE_DIRECT_RESPONSE, 2, (2.5,))

    def test_raises_once_the_search_keeps_failing(self, http):
        failing = _reply(200, claude_search_error_response('unavailable'))

        with pytest.raises(ClaudeSearchError, match=r'^Claude web search failed: unavailable$'):
            _ask_claude(http, failing, failing, failing)

        assert http.post.call_count == 3

    @pytest.mark.parametrize('error_code', ['max_uses_exceeded', 'query_too_long', 'invalid_tool_input'])
    def test_keeps_the_answer_of_a_search_error_asking_again_cannot_fix(self, http, error_code):
        answer = claude_search_error_response(error_code)

        assert (_ask_claude(http, _reply(200, answer)), http.post.call_count) == (answer, 1)

    def test_keeps_the_direct_callers_when_asking_again_after_a_fallback(self, http):
        _ask_claude(
            http,
            _reply(400, CLAUDE_CALLERS_REFUSAL),
            _reply(200, claude_search_error_response('too_many_requests')),
            _reply(200, CLAUDE_DIRECT_RESPONSE),
        )

        assert _sent_callers(http.post) == [None, ['direct'], ['direct']]


class TestClaudeSearchErrorCodes:
    def test_reads_the_error_code_of_a_failed_search(self):
        assert ai_clients.claude_search_error_codes(claude_search_error_response('unavailable')) == ['unavailable']

    @pytest.mark.parametrize('response', [CLAUDE_DIRECT_RESPONSE, CLAUDE_DYNAMIC_FILTERING_RESPONSE, {}, {'content': None}],
                             ids=['direct', 'dynamic-filtering', 'empty', 'null-content'])
    def test_finds_none_in_an_answer_whose_searches_succeeded(self, response):
        assert ai_clients.claude_search_error_codes(response) == []
