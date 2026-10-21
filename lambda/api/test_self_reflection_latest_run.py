"""POST /api/self-reflection reads the keyword's latest run newest-first.

``fetch_search_data`` used to take the latest run from the first ascending
page of the keyword partition, which past 1 MB of history held only the
oldest runs: the reflection then explained a months-old ranking.
"""

from __future__ import annotations

import os
from typing import Any
from unittest.mock import patch

from testing.handler_fixtures import handler_fixture
from testing.latest_run_fixtures import oldest_page_first_table
from testing.search_results_fixtures import report_dynamodb, search_result_row, search_results_table

_API_DIR = os.path.dirname(os.path.abspath(__file__))
_KEYWORD = 'hotel con spa en a coruña'
_RUN = '2026-09-20T06:00:00.000000Z'
_OLD_RUN = '2026-08-01T06:00:00.000000Z'

reflection = handler_fixture(
    _API_DIR,
    'self-reflection.py',
    'self_reflection_latest_run_under_test',
    env={
        'DYNAMODB_TABLE_SELF_REFLECTION': 'test-self-reflection',
        'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-search-results',
        'DYNAMODB_TABLE_QUERY_PROMPTS': 'test-query-prompts',
        'DYNAMODB_TABLE_BRAND_CONFIG': 'test-brand-config',
        'CORS_ORIGIN_PARAM': '',
    },
)


def _row(provider: str, timestamp: str, response: str, persona: str = 'default') -> dict[str, Any]:
    brands = [{'name': 'Hotel Coruña', 'rank': 1 if timestamp == _RUN else 4, 'classification': 'first_party'}]
    return search_result_row(_KEYWORD, provider, brands, timestamp=timestamp, query_prompt_id=persona, response=response)


_ROWS = [
    _row('openai', _OLD_RUN, 'respuesta antigua'),
    _row('openai', _RUN, 'respuesta nueva'),
    _row('gemini', _RUN, 'otra respuesta', persona='familia'),
]


def _fetch(module: Any, table: Any, persona: str) -> tuple[str, list[dict[str, Any]]]:
    with patch.object(module, 'dynamodb', report_dynamodb(table)):
        return module.fetch_search_data(_KEYWORD, persona)


def test_reads_the_latest_run_when_the_oldest_page_holds_only_older_runs(reflection):
    text, brands = _fetch(reflection, oldest_page_first_table({_KEYWORD: _ROWS}), 'default')

    assert (text, [brand['rank'] for brand in brands]) == ('[openai]: respuesta nueva', [1])


def test_keeps_every_persona_of_the_latest_run_for_all(reflection):
    text, _brands = _fetch(reflection, search_results_table({_KEYWORD: _ROWS}), 'all')

    assert sorted(text.split('\n\n')) == ['[gemini]: otra respuesta', '[openai]: respuesta nueva']


def test_answers_nothing_for_a_keyword_never_analysed(reflection):
    assert _fetch(reflection, search_results_table({}), 'default') == ('', [])


def test_reads_the_answer_text_through_a_projection(reflection):
    table = search_results_table({_KEYWORD: _ROWS})

    _fetch(reflection, table, 'default')

    run_read = table.query.call_args_list[-1].kwargs
    assert (run_read['ProjectionExpression'], run_read['ExpressionAttributeNames']['#rs']) == (
        'keyword, #ts, provider, query_prompt_id, brands, #rs', 'response',
    )
