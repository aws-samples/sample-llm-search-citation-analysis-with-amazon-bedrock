"""Tests for get-reports-competitor.py: the scope parameters, every competitor, paged outranked keywords, live or snapshot.

The rollup rules are ``shared.competitor_evidence``'s, proven against the
pre-move handler in ``shared/test_competitor_evidence.py``.
"""

from __future__ import annotations

import os
from typing import Any

from shared.artifact_competitor import competitor_builder
from testing import action_handler_fixtures as handlers
from testing.handler_fixtures import handler_fixture
from testing.report_scope_fixtures import REPORT_TABLES_ENV

competitor_module = handler_fixture(
    os.path.dirname(os.path.abspath(__file__)), 'get-reports-competitor.py', 'get_reports_competitor_under_test', env=REPORT_TABLES_ENV,
)

CONFIG = {**handlers.ACTION_BRAND_CONFIG, 'tracked_brands': {'first_party': ['Hotel Sol'], 'competitors': ['Parador', 'Hotel Mar']}}
ROWS: dict[str, list[dict[str, Any]]] = {
    'beach hotel': [
        handlers.answer('beach hotel', 'openai', handlers.rival(1), handlers.fp(5)),
        handlers.answer('beach hotel', 'gemini', handlers.rival(2), citations=['https://guide.example/a']),
    ],
    'best spa': [handlers.answer('best spa', 'openai', handlers.rival(2), handlers.fp(3))],
    'city break': [handlers.answer('city break', 'openai', handlers.fp(1), handlers.rival(4))],
}


def _get(module: Any, query: dict[str, str] | None, rows: dict[str, Any] = ROWS) -> tuple[int, Any]:
    return handlers.get_action(module, rows, query, CONFIG, path='/api/reports/competitor')


def test_lists_the_outranked_keywords_biggest_gap_first(competitor_module):
    _status, body = _get(competitor_module, {'competitor': 'Parador'})

    assert [(row['keyword'], row['rank_delta']) for row in body['rollup']['outranked_keywords']] == [('beach hotel', 4), ('best spa', 1)]


def test_honours_the_scope_parameters(competitor_module):
    _status, body = _get(competitor_module, {'competitor': 'Parador', 'keyword': 'best spa'})

    assert ([row['keyword'] for row in body['rollup']['outranked_keywords']], body['scope']['kind']) == (['best spa'], 'keyword')


def test_pages_the_outranked_keywords(competitor_module):
    _status, first = _get(competitor_module, {'competitor': 'Parador', 'limit': '1'})
    _status, second = _get(competitor_module, {'competitor': 'Parador', 'limit': '1', 'next_token': first['next_token']})

    assert (
        [row['keyword'] for row in first['rollup']['outranked_keywords'] + second['rollup']['outranked_keywords']],
        first['rollup']['outranked_keywords_total'], second['next_token'],
    ) == (['beach hotel', 'best spa'], 2, None)


def test_reads_the_2_43_keyword_limit_as_the_page_size(competitor_module):
    _status, body = _get(competitor_module, {'competitor': 'Parador', 'keyword_limit': '1'})

    assert len(body['rollup']['outranked_keywords']) == 1


def test_rolls_up_every_configured_competitor_without_one(competitor_module):
    _status, body = _get(competitor_module, None)

    assert ([rollup['competitor'] for rollup in body['rollups']], body['competitors_truncated']) == (['Parador', 'Hotel Mar'], False)


def test_counts_the_exclusive_sources(competitor_module):
    _status, body = _get(competitor_module, {'competitor': 'Parador'})

    assert (body['rollup']['exclusive_source_count'], [t['url'] for t in body['rollup']['outreach_targets']]) == (1, ['https://guide.example/a'])


def test_answers_400_for_an_unconfigured_competitor(competitor_module):
    status, body = _get(competitor_module, {'competitor': 'Ritz'})

    assert (status, body['field']) == (400, 'competitor')


def test_a_live_body_covers_every_keyword_of_the_scope(competitor_module):
    _status, body = _get(competitor_module, {'competitor': 'Parador'})

    assert (body['coverage'], body['source'], body['keywords_analyzed']) == ({'keywords_total': 3, 'keywords_analyzed': 3, 'complete': True}, 'live', 3)


def test_answers_200_truncated_when_the_deadline_expires_mid_read(competitor_module):
    assert handlers.cut_short(competitor_module, {'competitor': 'Parador'}, handlers.rival(1), path='/api/reports/competitor') == (200, True, False)


def test_a_large_scope_is_served_from_its_snapshot(competitor_module):
    body = handlers.served_from_snapshot(competitor_module, competitor_builder(), ROWS, {'competitor': 'Parador', 'scope': 'all'}, CONFIG, path='/api/reports/competitor')

    assert (body['source'], body['rollup']['outranked_keywords_total']) == ('snapshot', 2)


def test_a_scope_without_a_build_answers_202_computing(competitor_module):
    status, _body, jobs = handlers.computing_jobs(competitor_module, ROWS, {'scope': 'all'}, CONFIG, path='/api/reports/competitor')

    assert (status, jobs[0][0]) == (202, 'reports-competitor')


def test_a_500_keyword_scope_reads_no_keyword_partition(competitor_module):
    assert handlers.partitions_read_at_scale(competitor_module, '/api/reports/competitor', {'scope': 'all'}) == (202, 0)
