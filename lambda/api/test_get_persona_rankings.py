"""Tests for get-persona-rankings.py — GET /api/persona-rankings."""

from __future__ import annotations

import os
from typing import Any
from unittest.mock import patch

import pytest

from shared.kpi_engine import answers_from_rows, brand_table
from testing.dynamodb_stubs import fake_table
from testing.handler_fixtures import handler_fixture
from testing.search_results_fixtures import report_dynamodb, search_result_row, search_results_table

_API_DIR = os.path.dirname(os.path.abspath(__file__))
_ENV = {
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-search-results',
    'QUERY_PROMPTS_TABLE': 'test-query-prompts',
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


@pytest.fixture
def rankings(persona_module):
    """``get_persona_rankings`` reading ``rows`` for the keyword, with one named persona."""

    def run(rows: list[dict[str, Any]]) -> dict[str, Any]:
        prompts = fake_table(scan={'Items': [{'id': 'default', 'name': 'Default'}]})
        resource = report_dynamodb(search_results_table({_KEYWORD: rows}), other_tables={'test-query-prompts': prompts})
        with patch.object(persona_module, 'dynamodb', resource):
            return persona_module.get_persona_rankings(_KEYWORD)

    return run


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
