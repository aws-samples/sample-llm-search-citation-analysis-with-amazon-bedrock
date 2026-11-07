"""Which sources Perplexity and Claude answers cite, from the response shapes their docs describe.

Perplexity's Agent API marks the sources of a sentence with numbered markers
(``[1]``, ``[web:1]``) that name a ``search_results`` entry by its ``id``;
the results it does not name were only retrieved. Claude cites through the
``citations`` of its text blocks (``web_search_result_location``); its web
search results, whether the search ran directly or from code (dynamic
filtering), are only retrieved. All domains are fictional.
"""

from __future__ import annotations

import os
from typing import Any

import pytest

from testing.handler_fixtures import handler_fixture
from testing.search_handler_fixtures import SEARCH_HANDLER_ENV

_HERE = os.path.dirname(os.path.abspath(__file__))
search_handler = handler_fixture(_HERE, 'handler.py', 'search_handler_cited_sources', env=SEARCH_HANDLER_ENV)

_RESULT_URLS = [
    'https://www.example-air.example/fleet',
    'https://news.example.org/2026/best-airlines',
    'https://reviews.example.net/example-air',
    'https://travel.example.com/guides/chile',
    'https://forum.example.org/threads/42',
]
_CODE_CALLER = {'type': 'code_execution_20260120', 'tool_id': 'srvtoolu_code'}


def _perplexity_answer(text: str, batches: list[list[str]] | None = None, first_id: int = 1) -> dict[str, Any]:
    """An Agent API answer: one ``search_results`` item per batch (one shared id space), then the message."""
    output: list[dict[str, Any]] = []
    next_id = first_id
    for urls in batches or []:
        results = []
        for url in urls:
            results.append({'id': next_id, 'url': url, 'title': f'Result {next_id}', 'snippet': '...', 'source': 'web'})
            next_id += 1
        output.append({'type': 'search_results', 'queries': ['example air review'], 'results': results})
    output.append({
        'type': 'message', 'role': 'assistant', 'status': 'completed',
        'content': [{'type': 'output_text', 'text': text, 'annotations': []}],
    })
    return {'object': 'response', 'status': 'completed', 'model': 'perplexity/sonar', 'output': output}


def _claude_answer(*text_blocks: dict[str, Any], searched: list[str], caller: dict[str, Any] | None = None) -> dict[str, Any]:
    """A Messages API answer: one web search (run by ``caller``, direct when ``None``) and ``text_blocks``."""
    search_caller = caller or {'type': 'direct'}
    return {
        'type': 'message', 'role': 'assistant', 'model': 'claude-sonnet-5-5', 'stop_reason': 'end_turn',
        'content': [
            {
                'type': 'server_tool_use', 'id': 'srvtoolu_search', 'name': 'web_search',
                'input': {'query': 'example air review'}, 'caller': search_caller,
            },
            {
                'type': 'web_search_tool_result', 'tool_use_id': 'srvtoolu_search', 'caller': search_caller,
                'content': [
                    {'type': 'web_search_result', 'url': url, 'title': 'Result', 'encrypted_content': 'Eq', 'page_age': None}
                    for url in searched
                ],
            },
            *text_blocks,
        ],
    }


def _cited_text(text: str, *urls: str) -> dict[str, Any]:
    """A text block citing ``urls`` with ``web_search_result_location`` citations."""
    return {
        'type': 'text', 'text': text,
        'citations': [
            {'type': 'web_search_result_location', 'url': url, 'title': 'Result', 'encrypted_index': 'Eo', 'cited_text': '...'}
            for url in urls
        ],
    }


# --- Perplexity -------------------------------------------------------------------


class TestPerplexityNumberedMarkers:
    def test_cites_only_the_results_the_markers_name(self, search_handler):
        answer = _perplexity_answer('Example Air flies to Chile [1][3].', [_RESULT_URLS])

        assert search_handler._parse_perplexity_response(answer).citations == [_RESULT_URLS[0], _RESULT_URLS[2]]

    def test_keeps_the_results_no_marker_names_as_retrieved(self, search_handler):
        answer = _perplexity_answer('Example Air flies to Chile [1][3].', [_RESULT_URLS])

        assert search_handler._parse_perplexity_response(answer).retrieved_urls == [
            _RESULT_URLS[1], _RESULT_URLS[3], _RESULT_URLS[4],
        ]

    @pytest.mark.parametrize('text', [
        'Rated well [web:2] and on time [web:5].',
        'Rated well [2, 5].',
        'Rated well [web:2, web:5].',
        'Rated well [5] and [2] again [2].',
    ], ids=['web-prefix', 'comma-list', 'prefixed-comma-list', 'repeated-markers'])
    def test_cites_the_results_named_by_each_marker_form(self, search_handler, text):
        answer = _perplexity_answer(text, [_RESULT_URLS])

        assert search_handler._parse_perplexity_response(answer).citations == [_RESULT_URLS[1], _RESULT_URLS[4]]

    def test_resolves_markers_across_search_batches_sharing_one_id_space(self, search_handler):
        answer = _perplexity_answer('Seen in two searches [2][4].', [_RESULT_URLS[:2], _RESULT_URLS[2:4]])

        assert search_handler._parse_perplexity_response(answer).citations == [_RESULT_URLS[1], _RESULT_URLS[3]]

    def test_ignores_a_marker_that_names_no_result(self, search_handler):
        answer = _perplexity_answer('Rated well [1] in 2026 [9].', [_RESULT_URLS])

        assert search_handler._parse_perplexity_response(answer).citations == [_RESULT_URLS[0]]

    def test_lists_a_url_both_cited_and_retrieved_as_cited_only(self, search_handler):
        answer = _perplexity_answer('Rated well [1].', [[_RESULT_URLS[0], _RESULT_URLS[1], _RESULT_URLS[0]]])

        assert search_handler._parse_perplexity_response(answer).retrieved_urls == [_RESULT_URLS[1]]

    def test_numbers_results_by_position_when_they_carry_no_id(self, search_handler):
        answer = _perplexity_answer('Rated well [2].', [_RESULT_URLS[:3]])
        for result in answer['output'][0]['results']:
            del result['id']

        assert search_handler._parse_perplexity_response(answer).citations == [_RESULT_URLS[1]]


class TestPerplexityWithoutMarkers:
    def test_cites_every_result_when_the_answer_has_no_marker(self, search_handler):
        answer = _perplexity_answer('Example Air is a good choice.', [_RESULT_URLS])

        assert search_handler._parse_perplexity_response(answer).citations == _RESULT_URLS

    def test_cites_every_result_when_no_marker_matches_an_id(self, search_handler):
        answer = _perplexity_answer('Founded in [2019].', [_RESULT_URLS[:2]])

        assert search_handler._parse_perplexity_response(answer).citations == _RESULT_URLS[:2]

    def test_cites_only_the_annotations_when_the_message_is_annotated(self, search_handler):
        answer = _perplexity_answer('Example Air is a good choice.', [_RESULT_URLS[:3]])
        answer['output'][-1]['content'][0]['annotations'] = [{'type': 'url_citation', 'url': _RESULT_URLS[2]}]

        assert search_handler._parse_perplexity_response(answer).retrieved_urls == _RESULT_URLS[:2]

    def test_cites_nothing_when_no_search_ran(self, search_handler):
        answer = _perplexity_answer('Example Air is a good choice.')

        assert search_handler._parse_perplexity_response(answer).citations == []


# --- Claude -----------------------------------------------------------------------


_UNCITED_TEXT = {'type': 'text', 'text': 'Example Air is a good choice.'}
_CLAUDE_UNCITED_FROM_CODE = _claude_answer(_UNCITED_TEXT, searched=_RESULT_URLS[:3], caller=_CODE_CALLER)
_CLAUDE_UNCITED_DIRECT = _claude_answer({**_UNCITED_TEXT, 'citations': None}, searched=_RESULT_URLS[:3])
_CLAUDE_CITED_FROM_CODE = _claude_answer(
    _cited_text('Example Air was on time.', _RESULT_URLS[0], _RESULT_URLS[2]), searched=_RESULT_URLS[:3], caller=_CODE_CALLER,
)


class TestClaudeTextBlockCitations:
    def test_cites_the_urls_of_text_block_citations(self, search_handler):
        answer = _claude_answer(
            {'type': 'text', 'text': 'In short: '},
            _cited_text('Example Air was on time 92 % of the time.', _RESULT_URLS[1]),
            searched=_RESULT_URLS[:3],
        )

        assert search_handler._parse_claude_response(answer).citations == [_RESULT_URLS[1]]

    def test_cites_text_block_citations_when_the_search_ran_from_code(self, search_handler):
        assert search_handler._parse_claude_response(_CLAUDE_CITED_FROM_CODE).citations == [_RESULT_URLS[0], _RESULT_URLS[2]]

    def test_lists_a_cited_search_result_as_cited_only(self, search_handler):
        assert search_handler._parse_claude_response(_CLAUDE_CITED_FROM_CODE).retrieved_urls == [_RESULT_URLS[1]]

    def test_cites_nothing_when_no_text_block_carries_citations(self, search_handler):
        assert search_handler._parse_claude_response(_CLAUDE_UNCITED_FROM_CODE).citations == []

    def test_keeps_every_search_result_as_retrieved_when_no_text_block_carries_citations(self, search_handler):
        assert search_handler._parse_claude_response(_CLAUDE_UNCITED_DIRECT).retrieved_urls == _RESULT_URLS[:3]
