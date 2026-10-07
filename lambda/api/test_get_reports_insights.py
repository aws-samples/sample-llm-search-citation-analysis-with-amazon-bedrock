"""Tests for get-reports-insights.py — GET /api/reports/insights.

The handler is wired to the fakes of ``testing.report_scope_fixtures``: the
Keywords table lists the Faro and Porto keywords below and the SearchResults
partitions answer from ``SEARCH_ROWS``. ``history_since`` is pinned so the
Faro group's older run is inside every window.
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Iterator, Mapping, Sequence
from contextlib import AbstractContextManager
from decimal import Decimal
from types import ModuleType
from typing import Any
from unittest.mock import MagicMock

import pytest

from testing.events import parse_response
from testing.report_scope_fixtures import (
    OLD_TS,
    RUN_TS,
    ScopedReport,
    brand,
    fail_reads_of,
    load_scoped_handler,
    result,
    scoped_report,
)
from testing.search_results_fixtures import sort_condition

_HERE = os.path.dirname(os.path.abspath(__file__))

FARO = {'group_id': 'faro'}
OWNED = {'first_party_domains': ['hotel-faro.com']}
SINCE = '2026-06-12T10:00:00.000000Z'
FARO_SITE = ['https://www.hotel-faro.com/rooms']

ACTIVE_KEYWORDS = [
    {'id': 'kw-spa', 'keyword': 'faro spa weekend', 'status': 'active', 'group_ids': {'faro'}},
    {'id': 'kw-lighthouse', 'keyword': 'faro lighthouse hotel', 'status': 'active', 'group_ids': {'faro'}},
    {'id': 'kw-porto', 'keyword': 'porto river view hotel', 'status': 'active', 'group_ids': {'porto'}},
]

# The Faro group's latest run ranks Hotel Faro first on both keywords, cited by
# OpenAI only; Gemini names a rival alone. The spa keyword's older run ranked the
# brand fourth, a swing of three positions.
SEARCH_ROWS = {
    'faro spa weekend': [
        result('faro spa weekend', 'openai', [brand('Hotel Faro', 'first_party')], citations=FARO_SITE),
        result('faro spa weekend', 'gemini', [brand('Rival Inn', 'competitor')]),
        result('faro spa weekend', 'openai', [brand('Hotel Faro', 'first_party', rank=4)], timestamp=OLD_TS),
    ],
    'faro lighthouse hotel': [
        result('faro lighthouse hotel', 'openai', [brand('Hotel Faro', 'first_party')], citations=FARO_SITE),
    ],
    'porto river view hotel': [],
}

STABILITY = [
    {'keyword': 'faro lighthouse hotel', 'runs': 1, 'position_min': 1.0, 'position_max': 1.0, 'position_range': 0.0, 'flips': 0, 'unstable': False},
    {'keyword': 'faro spa weekend', 'runs': 2, 'position_min': 1.0, 'position_max': 4.0, 'position_range': 3.0, 'flips': 0, 'unstable': True},
]


def _wired(
    module: ModuleType,
    brand_config: Mapping[str, Any] = OWNED,
    search_rows: Mapping[str, list[dict[str, Any]]] = SEARCH_ROWS,
    active: Sequence[Mapping[str, Any]] = ACTIVE_KEYWORDS,
) -> AbstractContextManager[ScopedReport]:
    """``module`` reading the Faro fixtures, with ``get_brand_config`` answering ``brand_config``."""
    return scoped_report(module, brand_config, search_rows=search_rows, active=list(active))


@pytest.fixture(scope='module')
def insights() -> ModuleType:
    return load_scoped_handler(_HERE, 'get-reports-insights.py')


@pytest.fixture
def history_since(insights: ModuleType, monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    """``history_since`` pinned to ``SINCE``, so the window is a fixed sort-key bound."""
    pinned = MagicMock(return_value=SINCE)
    monkeypatch.setattr(insights, 'history_since', pinned)
    return pinned


@pytest.fixture
def report(insights: ModuleType, history_since: MagicMock) -> Iterator[ScopedReport]:
    with _wired(insights) as wired:
        yield wired


class TestScope:
    def test_requires_a_scope(self, report: ScopedReport):
        status, body = parse_response(report.call(None))

        assert (status, body['field']) == (400, 'keyword')

    def test_refuses_a_scope_without_active_keywords(self, report: ScopedReport):
        response = report.call({'group_id': 'nope'})

        assert parse_response(response) == (400, {'error': 'No active keywords match the selected scope (1 group(s)).', 'field': 'scope'})

    def test_echoes_the_scope_of_a_group(self, report: ScopedReport):
        body = report.body(FARO)

        assert (body['scope'], body['keywords_truncated']) == (
            {'mode': 'groups', 'group_ids': ['faro'], 'kind': 'group', 'label': '1 group(s)', 'keyword_count': 2},
            False,
        )

    @pytest.mark.parametrize(('params', 'coverage'), [
        pytest.param(FARO, (RUN_TS, 2, 2), id='group'),
        pytest.param({'scope': 'all'}, (RUN_TS, 3, 2), id='all keywords'),
    ])
    def test_describes_the_latest_runs_the_facts_rest_on(self, report: ScopedReport, params, coverage):
        body = report.body(params)

        assert (body['timestamp'], body['keywords_analyzed'], body['keywords_with_data']) == coverage

    def test_caps_a_group_at_one_hundred_keywords(self, insights: ModuleType, history_since: MagicMock):
        crowd = [{'id': f'faro-{i}', 'keyword': f'faro keyword {i:03}', 'status': 'active', 'group_ids': {'faro'}} for i in range(101)]
        with _wired(insights, active=crowd) as wired:
            body = wired.body(FARO)

        assert (body['keywords_analyzed'], body['keywords_truncated'], body['scope']['keyword_count']) == (100, True, 101)


class TestWindow:
    def test_looks_back_days_days_for_a_groups_history(self, report: ScopedReport, history_since: MagicMock):
        report.call({**FARO, 'days': '30'})

        history_since.assert_called_once_with(30)

    def test_defaults_to_ninety_days(self, report: ScopedReport, history_since: MagicMock):
        report.call(FARO)

        history_since.assert_called_once_with(90)

    def test_reads_no_history_outside_a_group(self, report: ScopedReport, history_since: MagicMock):
        report.call({'scope': 'all'})

        history_since.assert_not_called()

    @pytest.mark.parametrize('days', ['0', '366'])
    def test_refuses_a_window_outside_one_to_365_days(self, report: ScopedReport, days):
        assert report.call({**FARO, 'days': days})['statusCode'] == 400

    @pytest.mark.parametrize('days', ['1', '365'])
    def test_accepts_a_window_of_one_to_365_days(self, report: ScopedReport, days):
        assert report.call({**FARO, 'days': days})['statusCode'] == 200


class TestFacts:
    def test_groups_the_facts_by_kind(self, report: ScopedReport):
        assert list(report.body(FARO)['facts']) == ['engines', 'portfolio', 'stability']

    def test_names_the_play_each_engine_calls_for(self, report: ScopedReport):
        engines = report.body(FARO)['facts']['engines']

        assert [(row['engine'], row['play'], row['kpis']['answers'], row['kpis']['citation_rate']) for row in engines] == [
            ('gemini', 'get_mentioned_and_cited', 1, 0.0),
            ('openai', 'defend', 2, 100.0),
        ]

    def test_decides_the_play_on_the_ranking_alone_without_owned_domains(self, insights: ModuleType, history_since: MagicMock):
        with _wired(insights, brand_config={}) as wired:
            body = wired.body(FARO)

        assert (body['citations_configured'], [(row['engine'], row['play']) for row in body['facts']['engines']]) == (
            False, [('gemini', 'get_ranked_first'), ('openai', 'defend')],
        )

    def test_says_when_owned_domains_are_configured(self, report: ScopedReport):
        assert report.body(FARO)['citations_configured'] is True

    def test_measures_how_far_each_keyword_of_a_group_swung(self, report: ScopedReport):
        assert report.body(FARO)['facts']['stability'] == STABILITY

    @pytest.mark.parametrize('params', [
        pytest.param({'scope': 'all'}, id='all keywords'),
        pytest.param({'keyword': 'faro spa weekend'}, id='one keyword'),
        pytest.param({'keyword_ids': 'kw-spa,kw-lighthouse'}, id='selected keywords'),
    ])
    def test_has_no_stability_facts_outside_a_group(self, report: ScopedReport, params):
        assert report.body(params)['facts']['stability'] == []

    def test_counts_a_keyword_that_cannot_be_read_as_without_data(self, report: ScopedReport, caplog):
        fail_reads_of(report.tables['search'], 'faro lighthouse hotel')
        with caplog.at_level(logging.ERROR):
            body = report.body(FARO)

        assert (body['keywords_with_data'], [row['keyword'] for row in body['facts']['stability']]) == (1, ['faro spa weekend'])
        assert "Scoped report failed for 'faro lighthouse hotel'" in [record.getMessage() for record in caplog.records]


class TestInsights:
    def test_ranks_the_insights_most_severe_first(self, report: ScopedReport):
        insights = report.body(FARO)['insights']

        assert [(insight['id'], insight['severity']) for insight in insights] == [
            ('engine_play:gemini', 'medium'),
            ('unstable_keyword:faro spa weekend', 'low'),
        ]

    def test_repeats_the_fact_numbers_an_insight_rests_on(self, report: ScopedReport):
        gemini = report.body(FARO)['insights'][0]

        assert (gemini['evidence'], gemini['block']) == (
            {'top_1_share': 0.0, 'citation_rate': 0.0, 'answers': 1, 'play': 'get_mentioned_and_cited'},
            'insights_engine_playbook',
        )

    def test_reserves_the_narrative(self, report: ScopedReport):
        assert report.body(FARO)['narrative'] is None


class TestReads:
    def test_reads_only_the_latest_run_without_the_llm_text(self, report: ScopedReport):
        report.call({'keyword': 'faro spa weekend'})

        search_table = report.tables['search']
        run_read = search_table.query.call_args.kwargs
        assert (search_table.query.call_count, sort_condition(run_read)) == (2, ('begins_with', f'{RUN_TS}#'))
        assert 'response' not in run_read['ProjectionExpression']

    def test_answers_plain_json_numbers_for_stored_decimals(self, insights: ModuleType, history_since: MagicMock):
        stored = {**brand('Hotel Faro', 'first_party'), 'rank': Decimal('2'), 'mention_count': Decimal('1')}
        with _wired(insights, search_rows={'faro spa weekend': [result('faro spa weekend', 'openai', [stored])]}) as wired:
            body = wired.body(FARO)

        assert json.loads(json.dumps(body, allow_nan=False)) == body
        assert body['facts']['stability'] == [{**STABILITY[1], 'runs': 1, 'position_min': 2.0, 'position_max': 2.0, 'position_range': 0.0, 'unstable': False}]
