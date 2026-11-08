"""GET /api/visibility/sentiment-examples for a large scope: snapshot pages, exact total, view jobs, cursors (design 2.45.0 §5 tests 2, 4, 5)."""

from __future__ import annotations

import json
import os
from collections.abc import Generator
from unittest.mock import patch

import pytest

from testing.answer_text_fixtures import answer_texts_dynamodb
from testing.events import api_gateway_event
from testing.handler_fixtures import handler_fixture
from testing.mention_snapshot_fixtures import LargeScopeHandler, status_and_code, tenant_fixture
from testing.report_scope_fixtures import REPORT_TABLES_ENV
from testing.scale_data import ScaleSpec
from testing.search_results_fixtures import active_keywords_table

_API_DIR = os.path.dirname(os.path.abspath(__file__))
_ROUTE = '/api/visibility/sentiment-examples'

sentiment_handler = handler_fixture(_API_DIR, 'get-sentiment-examples.py', 'get_sentiment_examples_snapshot_under_test', env=REPORT_TABLES_ENV)
tenant = tenant_fixture(ScaleSpec(keywords=12, personas=2, runs=1, long_tail=20))


@pytest.fixture
def large(sentiment_handler, tenant) -> Generator[LargeScopeHandler]:
    keywords = [{'id': f'k{index}', 'keyword': keyword, 'status': 'active'} for index, keyword in enumerate(tenant.keywords)]

    def call(query: dict[str, str]):
        event = api_gateway_event('GET', _ROUTE, query={'scope': 'all', **query}, resource=_ROUTE)
        with patch.object(sentiment_handler, 'get_brand_config', return_value={'updated_at': '2026-10-01T00:00:00Z'}):
            return sentiment_handler.handler(event, None)

    with patch.object(sentiment_handler, 'dynamodb', answer_texts_dynamodb({}, active_keywords_table(keywords))):
        yield LargeScopeHandler(sentiment_handler, tenant.sentiment_readers(), tenant.artifacts(), call)


def test_total_is_the_exact_live_count(large, tenant):
    assert large.body({'sentiment': 'negative'})['total'] == tenant.oracle_examples('negative', None, 'first_party')[0]


def test_concatenated_pages_equal_the_uncapped_live_examples(large, tenant):
    pages = large.pages({'sentiment': 'mixed', 'limit': '6'}, 'examples')

    assert pages == json.loads(json.dumps(tenant.oracle_examples('mixed', None, 'first_party')[1]))


def test_says_it_comes_from_the_snapshot_with_full_coverage(large, tenant):
    body = large.body({'sentiment': 'positive'})
    total = tenant.spec.keywords

    assert (body['source'], body['coverage']) == ('snapshot', {'keywords_total': total, 'keywords_analyzed': total, 'complete': True})


def test_answers_202_while_a_scope_without_a_build_is_computed(large):
    large.build = None

    assert large.call({'sentiment': 'positive'})['statusCode'] == 202


def test_a_cursor_of_a_replaced_build_answers_cursor_expired(large, tenant):
    response = large.after_rebuild({'sentiment': 'positive', 'limit': '2'}, tenant.artifacts(build_id='build-0002'))

    assert status_and_code(response) == (400, 'cursor_expired')


def test_a_cursor_of_another_sentiment_answers_cursor_expired(large):
    token = large.body({'sentiment': 'positive', 'limit': '2'})['next_token']

    assert status_and_code(large.call({'sentiment': 'negative', 'limit': '2', 'next_token': token})) == (400, 'cursor_expired')
