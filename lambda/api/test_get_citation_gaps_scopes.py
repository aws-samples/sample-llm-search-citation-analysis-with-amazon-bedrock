"""Tests for get-citation-gaps.py over a scope: every keyword, paged summaries, enriched top gaps, live or snapshot.

The gap rules are ``shared.citation_gap_rules``'s, proven against the
pre-move handler in ``shared/test_citation_gap_rules.py``.
"""

from __future__ import annotations

import functools
import os
from typing import Any
from unittest.mock import MagicMock, call, patch

from shared.artifact_gaps import gaps_builder
from testing.action_handler_fixtures import (
    ACTION_BRAND_CONFIG,
    action_tables,
    answer,
    computing_jobs,
    cut_short,
    fp,
    get_action,
    partitions_read_at_scale,
    rival,
    served_from_snapshot,
)
from testing.events import api_gateway_event, parse_response
from testing.handler_fixtures import handler_fixture
from testing.report_scope_fixtures import SCOPE_ENV

gaps_module = handler_fixture(os.path.dirname(os.path.abspath(__file__)), 'get-citation-gaps.py', 'get_citation_gaps_scopes_under_test', env=SCOPE_ENV)

ROWS: dict[str, list[dict[str, Any]]] = {
    'beach hotel': [
        answer('beach hotel', 'openai', rival(1), citations=['https://low.example/a'] * 3),
        answer('beach hotel', 'gemini', fp(2), citations=['https://covered.example/b']),
    ],
    'best spa': [
        answer('best spa', 'openai', rival(1), citations=['https://high.example/c']),
        answer('best spa', 'gemini', rival(2), citations=['https://high.example/c']),
    ],
    'city break': [],
}


_get = functools.partial(get_action, path='/api/citation-gaps')


def test_ranks_the_scopes_top_gaps_by_priority_before_citation_count(gaps_module):
    _status, body = _get(gaps_module, ROWS, {'scope': 'all'})

    assert [gap['url'] for gap in body['top_gaps']] == ['https://high.example/c', 'https://low.example/a']


def test_summarises_every_keyword_with_data_and_counts_them(gaps_module):
    _status, body = _get(gaps_module, ROWS, {'scope': 'all'})

    assert (
        [summary['keyword'] for summary in body['keyword_summaries']], body['keywords_analyzed'], body['total_gaps'], body['total_high_priority'],
    ) == (['best spa', 'beach hotel'], 2, 2, 1)


def test_a_live_body_covers_every_keyword_of_the_scope(gaps_module):
    _status, body = _get(gaps_module, ROWS, {'scope': 'all'})

    assert (body['coverage'], body['source'], body['keywords_truncated']) == ({'keywords_total': 3, 'keywords_analyzed': 3, 'complete': True}, 'live', False)


def test_limit_pages_the_summaries_and_the_token_answers_the_rest(gaps_module):
    _status, first = _get(gaps_module, ROWS, {'scope': 'all', 'limit': '1'})
    _status, second = _get(gaps_module, ROWS, {'scope': 'all', 'limit': '1', 'next_token': first['next_token']})

    assert (
        [s['keyword'] for s in first['keyword_summaries'] + second['keyword_summaries']], first['keyword_summaries_total'], second['next_token'],
    ) == (['best spa', 'beach hotel'], 2, None)


def test_a_token_of_another_keyword_set_is_expired(gaps_module):
    _status, first = _get(gaps_module, ROWS, {'scope': 'all', 'limit': '1'})
    status, body = _get(gaps_module, {**ROWS, 'new keyword': []}, {'scope': 'all', 'limit': '1', 'next_token': first['next_token']})

    assert (status, body['code']) == (400, 'cursor_expired')


def test_enriches_the_returned_top_gaps_with_one_crawl_lookup(gaps_module):
    crawled = MagicMock(return_value={'https://high.example/c': {'title': 'High'}})

    with patch.object(gaps_module, '_batch_crawled_info', crawled):
        _status, body = _get(gaps_module, ROWS, {'scope': 'all'})

    assert (crawled.mock_calls, body['top_gaps'][0]['title']) == ([call(['https://high.example/c', 'https://low.example/a'])], 'High')


def test_answers_the_first_party_error_without_reading_any_keyword(gaps_module):
    resource = action_tables(ROWS)
    event = api_gateway_event('GET', '/api/citation-gaps', query={'group_id': 'g1'})
    with patch.object(gaps_module, 'dynamodb', resource), patch.object(gaps_module, 'get_brand_config', return_value={'tracked_brands': {}}):
        status, body = parse_response(gaps_module.handler(event, None))

    assert (status, body, resource.Table('test-search-results').query.call_count) == (200, {'error': 'No first-party brands configured'}, 0)


def test_answers_200_truncated_when_the_deadline_expires_mid_read(gaps_module):
    assert cut_short(gaps_module, {'scope': 'all'}, rival(1), path='/api/citation-gaps', citations=['https://x.example/']) == (200, True, False)


def test_a_large_scope_is_served_from_its_snapshot(gaps_module):
    body = served_from_snapshot(gaps_module, gaps_builder(), ROWS, {'scope': 'all'}, ACTION_BRAND_CONFIG, path='/api/citation-gaps')

    assert (body['source'], body['total_gaps'], body['scope']['kind']) == ('snapshot', 2, 'all')


def test_a_scope_without_a_build_answers_202_computing(gaps_module):
    status, body, jobs = computing_jobs(gaps_module, ROWS, {'scope': 'all'}, ACTION_BRAND_CONFIG, path='/api/citation-gaps')

    assert (status, body['status'], jobs[0][0]) == (202, 'computing', 'citation-gaps')


def test_a_500_keyword_group_reads_no_keyword_partition(gaps_module):
    assert partitions_read_at_scale(gaps_module, '/api/citation-gaps', {'scope': 'all'}) == (202, 0)
