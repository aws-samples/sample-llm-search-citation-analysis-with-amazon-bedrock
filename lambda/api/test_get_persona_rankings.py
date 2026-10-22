"""Tests for get-persona-rankings.py — GET /api/persona-rankings."""

from __future__ import annotations

import os
from typing import Any
from unittest.mock import patch

import pytest

from shared.kpi_engine import answers_from_rows, brand_table
from testing.dynamodb_stubs import fake_table
from testing.events import api_gateway_event, parse_response
from testing.handler_fixtures import handler_fixture
from testing.search_results_fixtures import (
    oldest_page_first_table,
    report_dynamodb,
    search_result_row,
    search_results_table,
)

_API_DIR = os.path.dirname(os.path.abspath(__file__))
_ENV = {
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-search-results',
    'DYNAMODB_TABLE_QUERY_PROMPTS': 'test-query-prompts',
    'CORS_ORIGIN_PARAM': '',
}
_KEYWORD = 'hotel sol spa'
_RUN = '2026-09-20T06:00:00.000000Z'

persona_module = handler_fixture(_API_DIR, 'get-persona-rankings.py', 'get_persona_rankings_under_test', env=_ENV)


def _brand(name: str, rank: int, classification: str = 'first_party') -> dict[str, Any]:
    return {'name': name, 'classification': classification, 'rank': rank, 'mention_count': 1, 'sentiment': 'positive'}


# Two engines answer the default persona: Hotel Sol first in both, Rival Inn second in one.
_ROWS = [
    search_result_row(_KEYWORD, 'openai', [_brand('Hotel Sol', 1), _brand('Rival Inn', 2, 'competitor')], timestamp=_RUN),
    search_result_row(_KEYWORD, 'gemini', [_brand('Hotel Sol', 1)], timestamp=_RUN),
]


def _persona_dynamodb(rows: list[dict[str, Any]]) -> Any:
    """A DynamoDB resource holding ``rows`` for the keyword and one named persona, ``default``."""
    prompts = fake_table(scan={'Items': [{'id': 'default', 'name': 'Default'}]})
    return report_dynamodb(search_results_table({_KEYWORD: rows}), other_tables={'test-query-prompts': prompts})


@pytest.fixture
def rankings(persona_module):
    """``get_persona_rankings`` reading ``rows`` for the keyword, with one named persona."""

    def run(rows: list[dict[str, Any]]) -> dict[str, Any]:
        with patch.object(persona_module, 'dynamodb', _persona_dynamodb(rows)):
            return persona_module.get_persona_rankings(_KEYWORD)

    return run


@pytest.fixture
def get_rankings(persona_module):
    """``(status, body)`` of ``GET /api/persona-rankings`` for the keyword with extra ``query`` parameters."""

    def get(query: dict[str, str]) -> tuple[int, Any]:
        event = api_gateway_event('GET', '/api/persona-rankings', query={'keyword': _KEYWORD, **query})
        with patch.object(persona_module, 'dynamodb', _persona_dynamodb(_ROWS)):
            return parse_response(persona_module.handler(event, None))

    return get


def _scores(body: dict[str, Any]) -> dict[str, float]:
    return {brand['name']: brand['visibility_score'] for brand in body['personas'][0]['brands']}


def test_reports_the_kpi_engine_visibility_score_of_each_brand(rankings):
    expected = {row['name']: row['visibility_score'] for row in brand_table(answers_from_rows(_ROWS))}

    assert _scores(rankings(_ROWS)) == expected == {'Hotel Sol': 100.0, 'Rival Inn': 45.0}


def test_scores_a_brand_named_only_outside_a_successful_answer_at_zero(rankings):
    failed = search_result_row(_KEYWORD, 'claude', [_brand('Ghost Hotel', 1)], timestamp=_RUN, status='error')

    assert _scores(rankings([*_ROWS, failed]))['Ghost Hotel'] == 0.0


def test_keeps_rank_mentions_and_sentiment_from_every_row_of_the_persona(rankings):
    hotel_sol = rankings(_ROWS)['personas'][0]['brands'][0]

    assert {key: hotel_sol[key] for key in ('name', 'rank', 'mention_count', 'sentiment', 'classification')} == {
        'name': 'Hotel Sol', 'rank': 1, 'mention_count': 2, 'sentiment': 'positive', 'classification': 'first_party',
    }


@pytest.mark.parametrize('query', [
    pytest.param({}, id='no-persona-filter'),
    pytest.param({'query_prompt_id': 'default'}, id='known-persona'),
])
def test_answers_the_rankings_of_every_matching_persona(get_rankings, query):
    status, body = get_rankings(query)

    assert (status, [persona['persona_id'] for persona in body['personas']]) == (200, ['default'])


def test_rejects_a_persona_missing_from_the_query_prompts_table(get_rankings):
    assert get_rankings({'query_prompt_id': 'ghost'}) == (
        400, {'error': 'Persona not found: ghost', 'field': 'query_prompt_id'},
    )


_OLD_RUN = '2026-08-01T06:00:00.000000Z'


def _rankings_from(persona_module: Any, table: Any) -> dict[str, Any]:
    prompts = fake_table(scan={'Items': [{'id': 'default', 'name': 'Default'}]})
    with patch.object(persona_module, 'dynamodb', report_dynamodb(table, other_tables={'test-query-prompts': prompts})):
        return persona_module.get_persona_rankings(_KEYWORD)


def test_ranks_the_latest_run_when_the_oldest_page_holds_only_older_runs(persona_module):
    old = search_result_row(_KEYWORD, 'openai', [_brand('Old Hotel', 1)], timestamp=_OLD_RUN)
    table = oldest_page_first_table({_KEYWORD: [old, *_ROWS]})

    brands = _rankings_from(persona_module, table)['personas'][0]['brands']

    assert [brand['name'] for brand in brands] == ['Hotel Sol', 'Rival Inn']


def test_reads_the_partition_newest_first(persona_module):
    table = search_results_table({_KEYWORD: _ROWS})

    _rankings_from(persona_module, table)

    assert table.query.call_args_list[0].kwargs['ScanIndexForward'] is False


def test_answers_a_message_for_a_keyword_never_analysed(persona_module):
    body = _rankings_from(persona_module, search_results_table({}))

    assert (body['personas'], body['message']) == ([], 'No search results found for this keyword.')

