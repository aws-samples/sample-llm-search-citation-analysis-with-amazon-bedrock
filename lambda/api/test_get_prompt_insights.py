"""Tests for get-prompt-insights.py: routing (live or snapshot), the latest-run lists, the scope contract and the time budget.

The classification rules are ``shared.prompt_classification``'s, proven
against the pre-move handler in ``shared/test_prompt_classification.py``;
these tests drive the handler through fake tables and a stand-in snapshot store.
"""

from __future__ import annotations

import functools
import os
from typing import Any

from shared.artifact_prompts import prompts_builder
from testing.action_handler_fixtures import (
    ACTION_BRAND_CONFIG,
    EARLIER,
    answer,
    computing_jobs,
    cut_short,
    fp,
    get_action,
    partitions_read_at_scale,
    rival,
    served_from_snapshot,
)
from testing.handler_fixtures import handler_fixture
from testing.report_scope_fixtures import REPORT_TABLES_ENV

insights_module = handler_fixture(os.path.dirname(os.path.abspath(__file__)), 'get-prompt-insights.py', 'get_prompt_insights_under_test', env=REPORT_TABLES_ENV)

ROWS: dict[str, list[dict[str, Any]]] = {
    'best spa': [answer('best spa', 'openai', fp(1)), answer('best spa', 'gemini', fp(2))],
    'beach hotel': [answer('beach hotel', 'openai', rival(1)), answer('beach hotel', 'openai', fp(1), timestamp=EARLIER)],
    'city break': [answer('city break', 'openai', fp(8))],
}


_get = functools.partial(get_action, path='/api/prompt-insights')


def test_classifies_every_keyword_from_its_latest_run(insights_module):
    _status, body = _get(insights_module, ROWS)

    assert {key: [record['keyword'] for record in body[key]] for key in ('winning_prompts', 'losing_prompts', 'opportunity_prompts')} == {
        'winning_prompts': ['best spa'], 'losing_prompts': ['city break'], 'opportunity_prompts': ['beach hotel'],
    }


def test_a_live_body_covers_every_keyword_of_the_scope(insights_module):
    _status, body = _get(insights_module, ROWS, {'scope': 'all'})

    assert (body['coverage'], body['source'], body['truncated']) == ({'keywords_total': 3, 'keywords_analyzed': 3, 'complete': True}, 'live', False)


def test_summary_counts_every_prompt_while_lists_hold_the_limit(insights_module):
    rows = {f'losing {index}': [answer(f'losing {index}', 'openai', fp(9))] for index in range(4)}
    _status, body = _get(insights_module, rows, {'limit': '1'})

    assert (len(body['losing_prompts']), body['summary']['losing_count']) == (1, 4)


def test_a_type_keeps_one_list_and_the_summary(insights_module):
    _status, body = _get(insights_module, ROWS, {'type': 'opportunities'})

    assert set(body) >= {'opportunity_prompts', 'summary'}
    assert 'winning_prompts' not in body


def test_answers_400_without_a_first_party_brand(insights_module):
    status, body = _get(insights_module, ROWS, config={'tracked_brands': {'competitors': ['Parador']}})

    assert (status, body['error']) == (400, 'No first-party brands configured')


def test_answers_400_for_a_scope_without_active_keywords(insights_module):
    status, _body = _get(insights_module, ROWS, {'group_id': 'unknown'})

    assert status == 400


def test_answers_200_truncated_when_the_deadline_expires_mid_read(insights_module):
    assert cut_short(insights_module, None, fp(9), path='/api/prompt-insights') == (200, True, False)


def test_a_large_scope_is_served_from_its_snapshot(insights_module):
    body = served_from_snapshot(insights_module, prompts_builder(), ROWS, {'scope': 'all'}, ACTION_BRAND_CONFIG, path='/api/prompt-insights')

    assert (body['source'], body['summary']['winning_count'], body['as_of']) == ('snapshot', 1, '2026-10-05T07:12:00Z')


def test_a_scope_without_a_build_answers_202_computing(insights_module):
    status, body, jobs = computing_jobs(insights_module, ROWS, {'scope': 'all'}, ACTION_BRAND_CONFIG, path='/api/prompt-insights')

    assert (status, body['status'], jobs) == (202, 'computing', [('prompt-insights', {})])


def test_a_500_keyword_scope_reads_no_keyword_partition(insights_module):
    assert partitions_read_at_scale(insights_module, '/api/prompt-insights', {'scope': 'all'}) == (202, 0)
