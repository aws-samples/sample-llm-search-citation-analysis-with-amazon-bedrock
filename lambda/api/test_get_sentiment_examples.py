"""Tests for get-sentiment-examples.py — GET /api/visibility/sentiment-examples."""

from __future__ import annotations

import os
import sys
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from shared import scope_params
from shared.scope_params import SCOPE_KEYWORDS_CAP
from testing.events import api_gateway_event, parse_response
from testing.handler_fixtures import handler_fixture
from testing.module_loader import load_handler_module
from testing.report_scope_fixtures import REPORT_TABLES_ENV
from testing.sentiment_examples_fixtures import (
    OLDER_RUN,
    RUN,
    PartitionReadFailure,
    examples_dynamodb,
    search_results_stub,
    stored_answer,
    stored_brand,
)

_API_DIR = os.path.dirname(os.path.abspath(__file__))

sentiment_handler = handler_fixture(_API_DIR, 'get-sentiment-examples.py', 'get_sentiment_examples_under_test', env=REPORT_TABLES_ENV)


class KeywordsReadFailure(Exception):
    """The Keywords table cannot be read while a scope is resolved."""

ACTIVE_KEYWORDS = [
    {'id': 'k1', 'keyword': 'hotel sol spa', 'status': 'active', 'group_ids': {'sol', 'galicia'}},
    {'id': 'k2', 'keyword': 'hotel sol beach', 'status': 'active', 'group_ids': {'sol'}},
]

SEARCH_ROWS: dict[str, Any] = {
    'hotel sol spa': [
        stored_answer('hotel sol spa', 'openai', [stored_brand('Hotel Sol', sentiment_quote='Rooms feel dated.')], response='Answer one.'),
        stored_answer('hotel sol spa', 'gemini', [stored_brand('Hotel Sol', 'positive')]),
        stored_answer('hotel sol spa', 'openai', [stored_brand('Hotel Sol')], timestamp=OLDER_RUN),
    ],
    'hotel sol beach': [
        stored_answer('hotel sol beach', 'claude', [stored_brand('Hotel Sol Beach')]),
    ],
}


@pytest.fixture
def search_table() -> MagicMock:
    return search_results_stub(SEARCH_ROWS)


@pytest.fixture
def endpoint(sentiment_handler, search_table):
    """The handler reading ``SEARCH_ROWS`` and ``ACTIVE_KEYWORDS``."""
    with patch.object(sentiment_handler, 'dynamodb', examples_dynamodb(search_table, ACTIVE_KEYWORDS)):
        yield sentiment_handler


def call(module: Any, query: dict[str, str] | None) -> tuple[int, Any]:
    event = api_gateway_event('GET', '/api/visibility/sentiment-examples', query=query, resource='/api/visibility/sentiment-examples')
    return parse_response(module.handler(event, None))


class TestSelection:
    def test_lists_the_sightings_of_each_keywords_latest_run(self, endpoint) -> None:
        _status, body = call(endpoint, {'group_id': 'sol', 'sentiment': 'negative'})

        assert (body['total'], [(example['keyword'], example['provider']) for example in body['examples']]) == (
            2, [('hotel sol beach', 'claude'), ('hotel sol spa', 'openai')],
        )

    def test_keeps_one_engine_when_a_provider_is_given(self, endpoint) -> None:
        _status, body = call(endpoint, {'group_id': 'sol', 'sentiment': 'negative', 'provider': 'openai'})

        assert (body['provider'], body['total'], body['examples'][0]['quote']) == ('openai', 1, 'Rooms feel dated.')

    def test_answers_a_null_provider_when_none_is_given(self, endpoint) -> None:
        _status, body = call(endpoint, {'keyword': 'hotel sol spa', 'sentiment': 'positive'})

        assert (body['provider'], body['sentiment'], body['total']) == (None, 'positive', 1)

    def test_returns_the_answer_text_with_the_example(self, endpoint) -> None:
        _status, body = call(endpoint, {'keyword': 'hotel sol spa', 'sentiment': 'negative'})

        assert (body['examples'][0]['answer'], body['examples'][0]['answer_truncated']) == ('Answer one.', False)

    def test_returns_the_first_limit_examples_and_counts_them_all(self, endpoint) -> None:
        _status, body = call(endpoint, {'scope': 'all', 'sentiment': 'negative', 'limit': '1'})

        assert (body['total'], len(body['examples'])) == (2, 1)

    def test_returns_twenty_examples_by_default(self, sentiment_handler) -> None:
        rows = {'hotel sol spa': [stored_answer('hotel sol spa', 'openai', [stored_brand(f'Brand {index:02}') for index in range(25)])]}
        with patch.object(sentiment_handler, 'dynamodb', examples_dynamodb(search_results_stub(rows))):
            _status, body = call(sentiment_handler, {'keyword': 'hotel sol spa', 'sentiment': 'negative'})

        assert (body['total'], len(body['examples'])) == (25, 20)

    def test_describes_the_scope_like_the_visibility_endpoint(self, endpoint) -> None:
        _status, body = call(endpoint, {'group_id': 'sol', 'sentiment': 'negative'})

        assert (body['scope']['kind'], body['scope']['keyword_count'], body['keywords_truncated']) == ('group', 2, False)

    def test_answers_no_examples_for_a_keyword_whose_read_fails(self, sentiment_handler) -> None:
        rows = {**SEARCH_ROWS, 'hotel sol spa': PartitionReadFailure('throttled')}
        with patch.object(sentiment_handler, 'dynamodb', examples_dynamodb(search_results_stub(rows), ACTIVE_KEYWORDS)):
            status, body = call(sentiment_handler, {'group_id': 'sol', 'sentiment': 'negative'})

        assert (status, [example['keyword'] for example in body['examples']]) == (200, ['hotel sol beach'])


class TestReads:
    def test_reads_the_latest_run_with_the_answer_text_and_persona_name(self, endpoint, search_table) -> None:
        call(endpoint, {'keyword': 'hotel sol spa', 'sentiment': 'negative'})

        run_read = search_table.query.call_args.kwargs
        assert (run_read['ProjectionExpression'], run_read['ExpressionAttributeNames']['#rsp']) == (
            'keyword, #ts, provider, #st, query_prompt_id, brands, citations, #md.model, #rsp, query_prompt_name', 'response',
        )

    def test_reads_the_run_through_its_sort_key_prefix(self, endpoint, search_table) -> None:
        call(endpoint, {'keyword': 'hotel sol spa', 'sentiment': 'negative'})

        sort = search_table.query.call_args.kwargs['KeyConditionExpression'].get_expression()['values'][1]
        assert (sort.expression_operator, sort.get_expression()['values'][1]) == ('begins_with', f'{RUN}#')

    def test_caps_the_scope_at_the_scope_keyword_cap(self, sentiment_handler) -> None:
        many = [{'id': f'k{index}', 'keyword': f'kw {index:03}', 'status': 'active'} for index in range(SCOPE_KEYWORDS_CAP + 1)]
        search = search_results_stub({})
        with patch.object(sentiment_handler, 'dynamodb', examples_dynamodb(search, many)):
            _status, body = call(sentiment_handler, {'scope': 'all', 'sentiment': 'negative'})

        assert (body['keywords_truncated'], search.query.call_count) == (True, SCOPE_KEYWORDS_CAP)

    def test_builds_its_dynamodb_resource_with_the_pooled_scope_helper(self) -> None:
        pooled = MagicMock(name='pooled-scope-resource')
        with patch.dict(os.environ, REPORT_TABLES_ENV), patch.object(scope_params, 'scoped_dynamodb_resource', return_value=pooled):
            loaded = load_handler_module(_API_DIR, 'get-sentiment-examples.py', 'get_sentiment_examples_pooled_under_test')
        sys.modules.pop('get_sentiment_examples_pooled_under_test', None)

        assert loaded.dynamodb is pooled


class TestValidation:
    @pytest.mark.parametrize(('query', 'field'), [
        pytest.param({'keyword': 'hotel sol spa'}, 'sentiment', id='missing-sentiment'),
        pytest.param({'keyword': 'hotel sol spa', 'sentiment': 'angry'}, 'sentiment', id='unknown-sentiment'),
        pytest.param({'keyword': 'hotel sol spa', 'sentiment': 'negative', 'provider': 'brave'}, 'provider', id='unknown-provider'),
        pytest.param({'keyword': 'hotel sol spa', 'sentiment': 'negative', 'limit': '0'}, 'limit', id='limit-below-one'),
        pytest.param({'keyword': 'hotel sol spa', 'sentiment': 'negative', 'limit': '51'}, 'limit', id='limit-above-fifty'),
        pytest.param({'keyword': 'hotel sol spa', 'sentiment': 'negative', 'limit': 'many'}, 'limit', id='limit-not-a-number'),
        pytest.param({'sentiment': 'negative'}, 'keyword', id='missing-scope'),
        pytest.param({'keyword': 'a', 'group_id': 'sol', 'sentiment': 'negative'}, 'scope', id='two-scopes'),
    ])
    def test_rejects_a_bad_request_naming_the_field(self, endpoint, query: dict[str, str], field: str) -> None:
        status, body = call(endpoint, query)

        assert (status, body['field']) == (400, field)

    @pytest.mark.parametrize('limit', ['1', '50'])
    def test_accepts_a_limit_from_one_to_fifty(self, endpoint, limit: str) -> None:
        status, _body = call(endpoint, {'keyword': 'hotel sol spa', 'sentiment': 'negative', 'limit': limit})

        assert status == 200

    def test_reads_a_sentiment_padded_with_spaces_as_that_sentiment(self, endpoint) -> None:
        status, body = call(endpoint, {'keyword': 'hotel sol spa', 'sentiment': ' negative '})

        assert (status, body['sentiment'], body['total']) == (200, 'negative', 1)

    def test_answers_a_server_error_when_the_scope_cannot_be_resolved(self, sentiment_handler) -> None:
        keywords_table = MagicMock(name='keywords')
        keywords_table.query.side_effect = KeywordsReadFailure('throttled')
        resource = examples_dynamodb(search_results_stub(SEARCH_ROWS))
        resource.Table.side_effect = lambda name: keywords_table
        with patch.object(sentiment_handler, 'dynamodb', resource):
            status, _body = call(sentiment_handler, {'group_id': 'sol', 'sentiment': 'negative'})

        assert status == 500
