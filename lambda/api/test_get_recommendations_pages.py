"""Tests for get-recommendations.py pages: every keyword, the status join per page, live or snapshot, the time budget."""

from __future__ import annotations

import os
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from shared.artifact_recommendations import recommendations_builder
from testing import action_handler_fixtures as handlers
from testing.events import api_gateway_event, parse_response
from testing.handler_fixtures import handler_fixture
from testing.report_scope_fixtures import REPORT_TABLES_ENV

recs_module = handler_fixture(os.path.dirname(os.path.abspath(__file__)), 'get-recommendations.py', 'get_recommendations_pages_under_test', env=REPORT_TABLES_ENV)

# Missing on three keywords (a visibility gap, a provider gap and competitor dominance), ranked low on a fourth.
ROWS: dict[str, list[dict[str, Any]]] = {
    **{f'missing {index}': [handlers.answer(f'missing {index}', 'openai', handlers.rival(1))] for index in range(3)},
    'low rank': [handlers.answer('low rank', 'openai', handlers.fp(6))],
}


def _get(module: Any, query: dict[str, str] | None, statuses: MagicMock | None = None) -> tuple[int, Any]:
    event = api_gateway_event('GET', '/api/recommendations', query=query)
    join = statuses or MagicMock(return_value={})
    with (
        patch.object(module, 'dynamodb', handlers.action_tables(ROWS)),
        patch.object(module, 'get_brand_config', return_value=handlers.ACTION_BRAND_CONFIG),
        patch.object(module, 'load_sibling_function', return_value=join),
    ):
        return parse_response(module.handler(event, None))


def test_pages_concatenate_to_the_whole_list(recs_module):
    _status, whole = _get(recs_module, {'scope': 'all'})
    _status, first = _get(recs_module, {'scope': 'all', 'limit': '2'})
    _status, rest = _get(recs_module, {'scope': 'all', 'limit': '2', 'next_token': first['next_token']})

    assert [rec['type'] for rec in first['recommendations'] + rest['recommendations']] == [rec['type'] for rec in whole['recommendations']]


def test_totals_count_the_whole_list_on_every_page(recs_module):
    _status, page = _get(recs_module, {'scope': 'all', 'limit': '1'})

    assert (page['total'], page['by_priority']) == (4, {'high': 2, 'medium': 2, 'low': 0})


def test_the_status_join_reads_only_the_page(recs_module):
    statuses = MagicMock(return_value={})
    _status, page = _get(recs_module, {'scope': 'all', 'limit': '1'}, statuses)

    assert statuses.call_args.args == ([page['recommendations'][0]['id']],)


def test_a_live_body_covers_every_keyword_of_the_scope(recs_module):
    _status, body = _get(recs_module, {'scope': 'all'})

    assert (body['coverage'], body['source']) == ({'keywords_total': 4, 'keywords_analyzed': 4, 'complete': True}, 'live')


def test_answers_200_truncated_when_the_deadline_expires_mid_read(recs_module):
    assert handlers.cut_short(recs_module, {'scope': 'all'}, handlers.rival(1), path='/api/recommendations') == (200, True, False)


@pytest.fixture
def snapshot_body(recs_module) -> Any:
    return handlers.served_from_snapshot(recs_module, recommendations_builder(), ROWS, {'scope': 'all'}, handlers.ACTION_BRAND_CONFIG, path='/api/recommendations')


def test_a_large_scope_is_served_from_its_snapshot_with_the_status_joined(snapshot_body):
    assert (snapshot_body['source'], snapshot_body['total'], {rec['status'] for rec in snapshot_body['recommendations']}) == ('snapshot', 4, {'new'})


def test_a_snapshot_body_keeps_the_llm_keywords_out_of_the_response(snapshot_body):
    assert 'llm_keywords' not in snapshot_body


def test_a_scope_without_a_build_answers_202_computing(recs_module):
    status, body, jobs = handlers.computing_jobs(recs_module, ROWS, {'scope': 'all'}, handlers.ACTION_BRAND_CONFIG, path='/api/recommendations')

    assert (status, body['status'], jobs) == (202, 'computing', [('recommendations', {'limit': 50})])


def test_answers_the_configuration_recommendation_without_a_first_party_brand(recs_module):
    event = api_gateway_event('GET', '/api/recommendations', query=None)
    with (
        patch.object(recs_module, 'dynamodb', handlers.action_tables(ROWS)),
        patch.object(recs_module, 'get_brand_config', return_value={'tracked_brands': {}}),
        patch.object(recs_module, 'load_sibling_function', return_value=MagicMock(return_value={})),
    ):
        _status, body = parse_response(recs_module.handler(event, None))

    assert ([rec['type'] for rec in body['recommendations']], body['total']) == (['configuration'], 1)


def test_a_500_keyword_scope_reads_no_keyword_partition(recs_module):
    assert handlers.partitions_read_at_scale(recs_module, '/api/recommendations', {'scope': 'all'}) == (202, 0)
