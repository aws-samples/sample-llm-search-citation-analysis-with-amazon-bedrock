"""
Volume tests for GET /api/visibility: the brand leaderboard of a large scope.

Before: ``brands`` listed every brand the answers named. A 100-keyword scope
whose answers each name 50 local brands (hotels, airlines, agencies) holds
5,000 rows of ~350 bytes (more with accented names): ~1.8 MB, growing with
every keyword and engine, while the dashboard shows the top of the
leaderboard. Now the view lists the ``BRANDS_LIMIT`` most visible brands,
then the first-party and tracked brands ranked below them, with
``brands_total`` and each row's ``position``.
"""

from __future__ import annotations

import os
from typing import Any
from unittest.mock import patch

import pytest

from shared.visibility_views import BRANDS_LIMIT
from testing.events import api_gateway_event, parse_response
from testing.handler_fixtures import handler_fixture
from testing.report_scope_fixtures import REPORT_TABLES_ENV
from testing.response_size import assert_within_page_budget
from testing.search_results_fixtures import active_keywords_table, report_dynamodb, search_results_table
from testing.sentiment_examples_fixtures import stored_answer, stored_brand

_API_DIR = os.path.dirname(os.path.abspath(__file__))

visibility_handler = handler_fixture(_API_DIR, 'get-visibility-metrics.py', 'get_visibility_metrics_volume_under_test', env=REPORT_TABLES_ENV)

_ENGINES = ('openai', 'perplexity', 'gemini', 'claude')
_KEYWORDS = [f'hoteles con encanto en la región {index:03d}' for index in range(100)]
_LOCAL_BRANDS = 50
_CONFIG = {
    'tracked_brands': {'first_party': ['Altiplano Air'], 'competitors': ['Cóndor Vuelos']},
    'first_party_domains': ['altiplano.example'],
}


def _local_brands(keyword_index: int) -> list[dict[str, Any]]:
    """50 local brands of one keyword, named by every engine."""
    return [
        stored_brand(f'Hotel Ñandú Señorial {keyword_index:03d}-{rank:02d}', 'positive', classification='other', rank=rank + 1)
        for rank in range(_LOCAL_BRANDS)
    ]


#: The tracked brands, named once, low in one answer: the least visible brands of the scope.
_TRACKED = [
    stored_brand('Altiplano Air', 'neutral', rank=_LOCAL_BRANDS + 5),
    stored_brand('Cóndor Vuelos', 'neutral', classification='other', rank=_LOCAL_BRANDS + 6),
]


def _rows() -> dict[str, list[dict[str, Any]]]:
    rows = {
        keyword: [stored_answer(keyword, engine, _local_brands(index)) for engine in _ENGINES]
        for index, keyword in enumerate(_KEYWORDS)
    }
    rows[_KEYWORDS[0]][0]['brands'].extend(_TRACKED)
    return rows


@pytest.fixture
def body_and_response(visibility_handler) -> tuple[Any, dict[str, Any]]:
    keywords = active_keywords_table([{'id': f'k{index}', 'keyword': keyword, 'status': 'active'} for index, keyword in enumerate(_KEYWORDS)])
    with (
        patch.object(visibility_handler, 'dynamodb', report_dynamodb(search_results_table(_rows()), keywords)),
        patch.object(visibility_handler, 'get_brand_config', return_value=_CONFIG),
    ):
        response = visibility_handler.handler(api_gateway_event('GET', '/api/visibility', query={'scope': 'all'}), None)
    return parse_response(response)[1], response


class TestBrandLeaderboard:
    def test_stays_within_page_budget_when_answers_name_5000_brands(self, body_and_response):
        assert_within_page_budget(body_and_response[1])

    def test_lists_the_most_visible_brands_and_counts_every_brand(self, body_and_response):
        body = body_and_response[0]

        assert (body['brands_total'], [row['position'] for row in body['brands'][:BRANDS_LIMIT]]) == (
            100 * _LOCAL_BRANDS + 2, list(range(1, BRANDS_LIMIT + 1)),
        )

    def test_lists_the_first_party_and_tracked_brands_ranked_below_the_top(self, body_and_response):
        listed_beyond = [(row['name'], row['position'] > BRANDS_LIMIT) for row in body_and_response[0]['brands'][BRANDS_LIMIT:]]

        assert sorted(listed_beyond) == [('Altiplano Air', True), ('Cóndor Vuelos', True)]
