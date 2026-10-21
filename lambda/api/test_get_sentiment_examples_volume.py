"""
Volume tests for GET /api/visibility/sentiment-examples.

Before: ``limit`` (up to 50) examples, each with up to ``ANSWER_TEXT_CAP``
(20,000) characters of answer text. ASCII answers made ~1 MB; non-Latin
answers (every character a 6-byte ``\\uXXXX`` escape) made 50 x 20,000 x 6
≈ 6 MB of body, past the 6 MiB Lambda cap once the envelope escapes it again.
Now the page is cut at ``PAGE_BUDGET_BYTES`` and ``next_token`` continues it.
"""

from __future__ import annotations

import os
from typing import Any
from unittest.mock import patch

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from shared.sentiment_examples import ANSWER_TEXT_CAP
from testing.events import api_gateway_event, parse_response
from testing.handler_fixtures import handler_fixture
from testing.report_scope_fixtures import REPORT_TABLES_ENV
from testing.response_size import assert_within_page_budget, long_text
from testing.search_results_fixtures import active_keywords_table, report_dynamodb, search_results_table
from testing.sentiment_examples_fixtures import stored_answer, stored_brand

_API_DIR = os.path.dirname(os.path.abspath(__file__))

sentiment_handler = handler_fixture(_API_DIR, 'get-sentiment-examples.py', 'get_sentiment_examples_volume_under_test', env=REPORT_TABLES_ENV)

_NON_LATIN = '航空会社はこの地域でより多くの乗り継ぎを提供しています。'
_ENGINES = ('openai', 'perplexity', 'gemini', 'claude')
_KEYWORDS = [f'vuelos económicos destino {index:03d}' for index in range(100)]


def _non_latin_answer() -> str:
    return (_NON_LATIN * (ANSWER_TEXT_CAP // len(_NON_LATIN) + 1))[:ANSWER_TEXT_CAP]


def _rows(answer: str) -> dict[str, list[dict[str, Any]]]:
    """Each keyword's latest run: every engine names the brand negatively, with ``answer`` as its text."""
    return {
        keyword: [
            stored_answer(keyword, engine, [stored_brand('Altiplano Air', sentiment_quote=long_text(200))], response=answer)
            for engine in _ENGINES
        ]
        for keyword in _KEYWORDS
    }


def _endpoint(module: Any, answer: str):
    keywords = active_keywords_table([{'id': f'k{index}', 'keyword': keyword, 'status': 'active'} for index, keyword in enumerate(_KEYWORDS)])
    return patch.object(module, 'dynamodb', report_dynamodb(search_results_table(_rows(answer)), keywords))


def _call(module: Any, query: dict[str, str]) -> dict[str, Any]:
    event = api_gateway_event('GET', '/api/visibility/sentiment-examples', query=query, resource='/api/visibility/sentiment-examples')
    return module.handler(event, None)


_QUERY = {'scope': 'all', 'sentiment': 'negative', 'limit': '50'}


class TestPageBudget:
    @pytest.mark.parametrize('answer', [_non_latin_answer(), long_text(ANSWER_TEXT_CAP)], ids=['japanese', 'spanish'])
    def test_stays_within_page_budget_when_fifty_examples_carry_full_length_answers(self, sentiment_handler, answer):
        with _endpoint(sentiment_handler, answer):
            response = _call(sentiment_handler, _QUERY)

        assert_within_page_budget(response)

    def test_cuts_the_page_below_limit_and_hands_out_a_next_token(self, sentiment_handler):
        with _endpoint(sentiment_handler, _non_latin_answer()):
            _, body = parse_response(_call(sentiment_handler, _QUERY))

        assert (body['total'], len(body['examples']) < 50, body['next_token'] is not None) == (400, True, True)


def _follow(module: Any, query: dict[str, str]) -> list[tuple[str, str]]:
    """Every example of every page, following ``next_token`` to the end."""
    collected: list[tuple[str, str]] = []
    token: str | None = None
    for _ in range(500):
        _, body = parse_response(_call(module, {**query, **({'next_token': token} if token else {})}))
        collected.extend((example['keyword'], example['provider']) for example in body['examples'])
        token = body['next_token']
        if token is None:
            return collected
    raise AssertionError('next_token never ran out')


class TestPagination:
    @settings(max_examples=5, deadline=None)
    @given(limit=st.integers(min_value=1, max_value=50))
    def test_following_next_token_returns_every_example_once_in_order(self, sentiment_handler, limit):
        with _endpoint(sentiment_handler, 'Respuesta breve.'):
            _, first = parse_response(_call(sentiment_handler, {**_QUERY, 'limit': '50'}))
            pages = _follow(sentiment_handler, {**_QUERY, 'limit': str(limit)})

        expected = sorted(((keyword, engine) for keyword in _KEYWORDS for engine in _ENGINES), key=lambda pair: (pair[0], pair[1]))
        assert (pages, first['total']) == (expected, 400)

    def test_rejects_a_malformed_next_token_with_400(self, sentiment_handler):
        with _endpoint(sentiment_handler, 'Respuesta breve.'):
            status, body = parse_response(_call(sentiment_handler, {**_QUERY, 'next_token': 'not-a-token'}))

        assert (status, body) == (400, {'error': 'Invalid next_token', 'field': 'next_token'})

    def test_answers_a_null_next_token_on_the_last_page(self, sentiment_handler):
        with _endpoint(sentiment_handler, 'Respuesta breve.'):
            _, body = parse_response(_call(sentiment_handler, {'keyword': _KEYWORDS[0], 'sentiment': 'negative'}))

        assert (len(body['examples']), body['next_token']) == (4, None)
