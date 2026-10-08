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
import time
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
        assert list(report.body(FARO)['facts']) == [
            'engines', 'prompt_engine', 'citation_ownership', 'owned_pages', 'competitor_caveats', 'portfolio', 'stability',
        ]

    def test_places_the_brand_per_keyword_and_engine_of_the_latest_runs(self, report: ScopedReport):
        prompt_engine = report.body(FARO)['facts']['prompt_engine']

        assert [(row['keyword'], row['positions'], row['lost_engines']) for row in prompt_engine['keywords']] == [
            ('faro spa weekend', {'gemini': None, 'openai': 1}, ['gemini']),
            ('faro lighthouse hotel', {'openai': 1}, []),
        ]

    def test_splits_the_citations_by_the_competitor_domains_of_the_brand_config(self, insights: ModuleType, history_since: MagicMock):
        config = {**OWNED, 'competitor_domains': {'Rival Inn': ['rival-inn.com']}}
        rows = {**SEARCH_ROWS, 'faro lighthouse hotel': [
            result('faro lighthouse hotel', 'openai', [brand('Hotel Faro', 'first_party')], citations=['https://rival-inn.com/spa', 'https://guide.pt/faro']),
        ]}
        with _wired(insights, brand_config=config, search_rows=rows) as wired:
            ownership = wired.body(FARO)['facts']['citation_ownership']

        assert ownership['engines'][1] == {
            'engine': 'openai', 'answers': 2, 'citations': 3, 'owned': 1, 'competitors': {'Rival Inn': 1}, 'third_party': 1,
        }

    def test_counts_every_non_owned_citation_as_third_party_without_competitor_domains(self, report: ScopedReport):
        ownership = report.body(FARO)['facts']['citation_ownership']

        assert (ownership['competitors_configured'], [(row['engine'], row['owned'], row['third_party']) for row in ownership['engines']]) == (
            False, [('gemini', 0, 0), ('openai', 2, 0)],
        )

    def test_lists_the_most_cited_owned_page(self, report: ScopedReport):
        pages = report.body(FARO)['facts']['owned_pages']['pages']

        assert pages == [{'url': 'hotel-faro.com/rooms', 'section': 'hotel-faro.com/rooms', 'is_document': False, 'citations': 2, 'engines': ['openai']}]

    def test_counts_the_caveats_of_each_competitor(self, report: ScopedReport):
        assert [(row['name'], row['mentions']) for row in report.body(FARO)['facts']['competitor_caveats']] == [('Rival Inn', 1)]

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

    def test_has_no_narrative_while_none_is_stored(self, report: ScopedReport):
        assert report.body(FARO)['narrative'] is None


class TestNarrative:
    def test_reads_the_narrative_stored_for_the_groups_latest_run(
        self, report: ScopedReport, insights: ModuleType, monkeypatch: pytest.MonkeyPatch,
    ):
        stored = {'run_timestamp': RUN_TS, 'insights': [], 'recommendations': [], 'dropped': 0}
        loader = MagicMock(return_value=stored)
        monkeypatch.setattr(insights, 'load_narrative', loader)

        body = report.body(FARO)

        assert (body['narrative'], loader.call_args.args) == (stored, ('group#faro', RUN_TS))

    def test_reads_no_narrative_for_a_scope_that_is_not_a_group(
        self, report: ScopedReport, insights: ModuleType, monkeypatch: pytest.MonkeyPatch,
    ):
        loader = MagicMock(return_value={'run_timestamp': RUN_TS})
        monkeypatch.setattr(insights, 'load_narrative', loader)

        body = report.body({'keyword': 'faro spa weekend'})

        assert (body['narrative'], loader.call_count) == (None, 0)


class TestReads:
    def test_reads_only_the_latest_run_without_the_llm_text(self, report: ScopedReport):
        report.call({'keyword': 'faro spa weekend'})

        search_table = report.tables['search']
        run_read = search_table.query.call_args.kwargs
        assert (search_table.query.call_count, sort_condition(run_read)) == (2, ('begins_with', f'{RUN_TS}#'))
        assert 'response' not in run_read['ProjectionExpression']

    def test_answers_plain_json_numbers_for_stored_decimals(self, insights: ModuleType, history_since: MagicMock):
        stored = {**brand('Hotel Faro', 'first_party'), 'rank': Decimal(2), 'mention_count': Decimal(1)}
        with _wired(insights, search_rows={'faro spa weekend': [result('faro spa weekend', 'openai', [stored])]}) as wired:
            body = wired.body(FARO)

        assert json.loads(json.dumps(body, allow_nan=False)) == body
        assert body['facts']['stability'] == [{**STABILITY[1], 'runs': 1, 'position_min': 2.0, 'position_max': 2.0, 'position_range': 0.0, 'unstable': False}]


# ---------------------------------------------------------------------------
# Budget (requirement 11.3): a group at the 100-keyword report cap, each keyword
# answered by four engines for three personas in two runs, every answer naming
# five brands and citing eight URLs.
# ---------------------------------------------------------------------------

CAP_ENGINES = ('openai', 'perplexity', 'gemini', 'claude')
CAP_PERSONAS = ('default', 'family', 'business')
CAP_RUNS = (OLD_TS, '2026-09-18T10:00:00Z')
#: Seconds the in-memory work may take at the cap: a fraction of API Gateway's 29-second limit, leaving the reads room.
CAP_BUDGET_SECONDS = 5.0
CAP_BRANDS = [
    brand('Hotel Faro', 'first_party', rank=2),
    brand('Faro Spa', 'first_party', rank=4, sentiment='mixed'),
    {**brand('Rival Inn', 'competitor', rank=1, sentiment='negative'), 'sentiment_reason': 'Dated rooms'},
    brand('Casa Mar', 'competitor', rank=3, sentiment='mixed'),
    brand('Guest House', 'other', rank=5),
]
CAP_CITATIONS = [
    'https://www.hotel-faro.com/rooms', 'https://hotel-faro.com/files/brochure.pdf', 'https://rival-inn.com/spa',
    'https://casa-mar.pt/', 'https://guide.pt/faro', 'https://booking.example/faro', 'https://blog.example/a', 'https://news.example/b',
]


def _cap_rows(keyword: str) -> list[dict[str, Any]]:
    return [
        result(keyword, engine, CAP_BRANDS, timestamp=run, citations=CAP_CITATIONS, query_prompt_id=persona)
        for run in CAP_RUNS for engine in CAP_ENGINES for persona in CAP_PERSONAS
    ]


class TestBudget:
    def test_answers_a_group_at_the_keyword_cap_well_inside_the_api_gateway_limit(self, insights: ModuleType, history_since: MagicMock):
        keywords = [f'faro keyword {index:03}' for index in range(100)]
        active = [{'id': f'kw-{index}', 'keyword': keyword, 'status': 'active', 'group_ids': {'faro'}} for index, keyword in enumerate(keywords)]
        config = {**OWNED, 'competitor_domains': {'Rival Inn': ['rival-inn.com'], 'Casa Mar': ['casa-mar.pt']}}
        with _wired(insights, brand_config=config, search_rows={keyword: _cap_rows(keyword) for keyword in keywords}, active=active) as wired:
            started = time.perf_counter()
            body = wired.body(FARO)
            elapsed = time.perf_counter() - started

        assert (body['keywords_with_data'], len(body['facts']['prompt_engine']['keywords']), body['facts']['prompt_engine']['omitted']) == (100, 50, 50)
        assert elapsed < CAP_BUDGET_SECONDS
