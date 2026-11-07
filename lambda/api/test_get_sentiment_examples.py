"""Tests for get-sentiment-examples.py — GET /api/visibility/sentiment-examples."""

from __future__ import annotations

import os
import sys
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from shared import scope_params
from shared.scope_params import SCOPE_KEYWORDS_CAP
from testing.answer_text_fixtures import answer_texts_dynamodb, projected_search_table, serve_answer_texts
from testing.events import api_gateway_event, parse_response
from testing.handler_fixtures import handler_fixture
from testing.module_loader import load_handler_module
from testing.report_scope_fixtures import REPORT_TABLES_ENV
from testing.search_results_fixtures import (
    PartitionReadFailure,
    active_keywords_table,
    report_dynamodb,
)
from testing.sentiment_examples_fixtures import (
    OLDER_RUN,
    RUN,
    stored_answer,
    stored_brand,
)
from testing.window_budget_fixtures import request_deadline_of, spent_request_budget, ticking_deadline

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
    return projected_search_table(SEARCH_ROWS)


@pytest.fixture
def endpoint(sentiment_handler, search_table):
    """The handler reading ``SEARCH_ROWS`` and ``ACTIVE_KEYWORDS``, with the answer texts served by key."""
    with patch.object(sentiment_handler, 'dynamodb', answer_texts_dynamodb(SEARCH_ROWS, active_keywords_table(ACTIVE_KEYWORDS), search_table)):
        yield sentiment_handler


def call(module: Any, query: dict[str, str] | None) -> tuple[int, Any]:
    event = api_gateway_event('GET', '/api/visibility/sentiment-examples', query=query, resource='/api/visibility/sentiment-examples')
    return parse_response(module.handler(event, None))


class TestSelection:
    @pytest.fixture
    def sol_negative_body(self, endpoint) -> Any:
        """The answer to the negative sightings of the 'sol' group."""
        return call(endpoint, {'group_id': 'sol', 'sentiment': 'negative'})[1]

    def test_lists_the_sightings_of_each_keywords_latest_run(self, sol_negative_body) -> None:
        sightings = [(example['keyword'], example['provider']) for example in sol_negative_body['examples']]
        assert (sol_negative_body['total'], sightings) == (2, [('hotel sol beach', 'claude'), ('hotel sol spa', 'openai')])

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
        with patch.object(sentiment_handler, 'dynamodb', answer_texts_dynamodb(rows)):
            _status, body = call(sentiment_handler, {'keyword': 'hotel sol spa', 'sentiment': 'negative'})

        assert (body['total'], len(body['examples'])) == (25, 20)

    def test_describes_the_scope_like_the_visibility_endpoint(self, sol_negative_body) -> None:
        scope = sol_negative_body['scope']
        assert (scope['kind'], scope['keyword_count'], sol_negative_body['keywords_truncated']) == ('group', 2, False)

    def test_answers_no_examples_for_a_keyword_whose_read_fails(self, sentiment_handler) -> None:
        rows = {**SEARCH_ROWS, 'hotel sol spa': PartitionReadFailure('throttled')}
        with patch.object(sentiment_handler, 'dynamodb', answer_texts_dynamodb(rows, active_keywords_table(ACTIVE_KEYWORDS))):
            status, body = call(sentiment_handler, {'group_id': 'sol', 'sentiment': 'negative'})

        assert (status, [example['keyword'] for example in body['examples']]) == (200, ['hotel sol beach'])


class TestReads:
    def test_reads_the_latest_run_without_the_answer_text(self, endpoint, search_table) -> None:
        call(endpoint, {'keyword': 'hotel sol spa', 'sentiment': 'negative'})

        run_read = search_table.query.call_args.kwargs
        assert (run_read['ProjectionExpression'], run_read['ExpressionAttributeNames']) == (
            'keyword, #ts, provider, #st, query_prompt_id, brands, citations, #md.model, branded, market_id, timestamp_provider, query_prompt_name',
            {'#ts': 'timestamp', '#st': 'status', '#md': 'metadata'},
        )

    @pytest.fixture
    def served(self, sentiment_handler) -> Any:
        """The handler over ``SEARCH_ROWS`` and the list of the key lists its answer-text reads asked for."""
        resource = report_dynamodb(projected_search_table(SEARCH_ROWS), active_keywords_table(ACTIVE_KEYWORDS))
        asked = serve_answer_texts(resource, SEARCH_ROWS)
        with patch.object(sentiment_handler, 'dynamodb', resource):
            yield sentiment_handler, asked

    def test_reads_the_answer_text_of_the_page_rows_by_key(self, served) -> None:
        module, asked = served

        _status, body = call(module, {'keyword': 'hotel sol spa', 'sentiment': 'negative', 'limit': '1'})

        assert (asked, body['examples'][0]['answer']) == (
            [[{'keyword': 'hotel sol spa', 'timestamp_provider': SEARCH_ROWS['hotel sol spa'][0]['timestamp_provider']}]], 'Answer one.',
        )

    def test_reads_only_the_row_key_and_the_answer_text_by_key(self, sentiment_handler) -> None:
        resource = report_dynamodb(projected_search_table(SEARCH_ROWS), active_keywords_table(ACTIVE_KEYWORDS))
        serve_answer_texts(resource, SEARCH_ROWS)
        with patch.object(sentiment_handler, 'dynamodb', resource):
            call(sentiment_handler, {'keyword': 'hotel sol spa', 'sentiment': 'negative', 'limit': '1'})

        (request,) = resource.batch_get_item.call_args.kwargs['RequestItems'].values()
        assert (request['ProjectionExpression'], request['ExpressionAttributeNames']) == (
            'keyword, timestamp_provider, #rsp', {'#rsp': 'response'},
        )

    def test_reads_no_answer_text_for_a_page_without_examples(self, served) -> None:
        module, asked = served

        call(module, {'keyword': 'hotel sol spa', 'sentiment': 'mixed'})

        assert asked == []

    def test_reads_the_run_through_its_sort_key_prefix(self, endpoint, search_table) -> None:
        call(endpoint, {'keyword': 'hotel sol spa', 'sentiment': 'negative'})

        sort = search_table.query.call_args.kwargs['KeyConditionExpression'].get_expression()['values'][1]
        assert (sort.expression_operator, sort.get_expression()['values'][1]) == ('begins_with', f'{RUN}#')

    def test_caps_the_scope_at_the_scope_keyword_cap(self, sentiment_handler) -> None:
        many = [{'id': f'k{index}', 'keyword': f'kw {index:03}', 'status': 'active'} for index in range(SCOPE_KEYWORDS_CAP + 1)]
        search = projected_search_table({})
        with patch.object(sentiment_handler, 'dynamodb', answer_texts_dynamodb({}, active_keywords_table(many), search)):
            _status, body = call(sentiment_handler, {'scope': 'all', 'sentiment': 'negative'})

        assert (body['keywords_truncated'], search.query.call_count) == (True, SCOPE_KEYWORDS_CAP)

    def test_builds_its_dynamodb_resource_with_the_pooled_scope_helper(self) -> None:
        pooled = MagicMock(name='pooled-scope-resource')
        with patch.dict(os.environ, REPORT_TABLES_ENV), patch.object(scope_params, 'scoped_dynamodb_resource', return_value=pooled):
            loaded = load_handler_module(_API_DIR, 'get-sentiment-examples.py', 'get_sentiment_examples_pooled_under_test')
        sys.modules.pop('get_sentiment_examples_pooled_under_test', None)

        assert loaded.dynamodb is pooled


class TestClassification:
    @pytest.fixture
    def endpoint_with_competitor(self, sentiment_handler):
        rows = {'hotel sol spa': [stored_answer('hotel sol spa', 'openai', [
            stored_brand('Hotel Sol'), stored_brand('Rival Inn', classification='competitor'),
        ])]}
        with patch.object(sentiment_handler, 'dynamodb', answer_texts_dynamodb(rows)):
            yield sentiment_handler

    def test_lists_competitor_sightings_when_classification_is_competitor(self, endpoint_with_competitor) -> None:
        _status, body = call(endpoint_with_competitor, {'keyword': 'hotel sol spa', 'sentiment': 'negative', 'classification': 'competitor'})

        assert (body['classification'], [example['brand'] for example in body['examples']]) == ('competitor', ['Rival Inn'])

    def test_lists_first_party_sightings_when_classification_is_omitted(self, endpoint_with_competitor) -> None:
        _status, body = call(endpoint_with_competitor, {'keyword': 'hotel sol spa', 'sentiment': 'negative'})

        assert (body['classification'], [example['brand'] for example in body['examples']]) == ('first_party', ['Hotel Sol'])

    @pytest.mark.parametrize('value', ['other', 'competitors', 'FIRST_PARTY'])
    def test_rejects_a_classification_outside_first_party_and_competitor(self, endpoint, value: str) -> None:
        status, body = call(endpoint, {'keyword': 'hotel sol spa', 'sentiment': 'negative', 'classification': value})

        assert (status, body['field']) == (400, 'classification')


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
        resource = answer_texts_dynamodb(SEARCH_ROWS)
        resource.Table.side_effect = lambda name: keywords_table
        with patch.object(sentiment_handler, 'dynamodb', resource):
            status, _body = call(sentiment_handler, {'group_id': 'sol', 'sentiment': 'negative'})

        assert status == 500


class TestTimeBudget:
    def test_answers_200_without_the_unread_keywords_when_the_budget_is_spent(self, endpoint) -> None:
        with spent_request_budget():
            status, body = call(endpoint, {'group_id': 'sol', 'sentiment': 'negative'})

        assert (status, body['examples'], body['keywords_truncated'], body['truncated']) == (200, [], True, True)

    def test_answers_the_page_without_its_text_when_the_budget_runs_out_before_the_text_read(self, endpoint) -> None:
        # Checks: the keyword's read passes, the answer-text read finds the budget spent.
        with request_deadline_of(lambda: ticking_deadline(2)):
            _status, body = call(endpoint, {'keyword': 'hotel sol spa', 'sentiment': 'negative'})

        assert ([example['answer'] for example in body['examples']], body['keywords_truncated'], body['truncated']) == ([''], False, True)

    def test_carries_the_answer_text_within_the_budget(self, endpoint) -> None:
        assert call(endpoint, {'group_id': 'sol', 'sentiment': 'negative'})[1]['truncated'] is False
