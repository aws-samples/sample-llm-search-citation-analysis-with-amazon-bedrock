"""``GET /api/visibility?branded=``: the answers to queries that name the brand, that do not, or every answer."""

from __future__ import annotations

import os
from typing import Any

import pytest

from shared.kpi_engine import answer_from_row, answers_from_rows
from testing.events import parse_response
from testing.report_scope_fixtures import brand, load_scoped_handler, result, scoped_report

_HERE = os.path.dirname(os.path.abspath(__file__))
_HOTEL = brand('Hotel Coruna', 'first_party', 1, 1)


def _branded(row: dict[str, Any]) -> dict[str, Any]:
    return {**row, 'branded': True}


_ROWS = {
    'hotel coruna spa': [
        _branded(result('hotel coruna spa', 'openai', [_HOTEL])),
        result('hotel coruna spa', 'gemini', [_HOTEL]),
        result('hotel coruna spa', 'claude', []),
    ],
    'best hotels galicia': [],
    'hotel marino beach': [],
}


@pytest.fixture(scope='module')
def visibility():
    return load_scoped_handler(_HERE, 'get-visibility-metrics.py', '_branded')


@pytest.fixture
def visibility_env(visibility):
    with scoped_report(visibility, {}, search_rows=_ROWS) as report:
        yield report


class TestBrandedFilter:
    @pytest.mark.parametrize(('branded', 'answers', 'mention_rate'), [
        ('all', 3, 66.7),
        ('neutral', 2, 50.0),
        ('branded', 1, 100.0),
    ])
    def test_measures_the_answers_the_filter_keeps(self, visibility_env, branded, answers, mention_rate):
        kpis = visibility_env.body({'keyword': 'hotel coruna spa', 'branded': branded})['kpis']

        assert (kpis['answers'], kpis['mention_rate']) == (answers, mention_rate)

    def test_measures_every_answer_without_the_parameter(self, visibility_env):
        body = visibility_env.body({'keyword': 'hotel coruna spa'})

        assert (body['branded'], body['kpis']['answers']) == ('all', 3)

    def test_rejects_an_unknown_filter(self, visibility_env):
        status, body = parse_response(visibility_env.call({'keyword': 'hotel coruna spa', 'branded': 'yes'}))

        assert (status, body['field']) == (400, 'branded')


class TestUnclassifiedPreviousRun:
    def test_a_row_without_the_branded_flag_is_unclassified(self):
        old, new = answer_from_row(result('hotel coruna spa', 'openai', [_HOTEL])), answer_from_row(_branded(result('x', 'openai', [])))

        assert old is not None
        assert new is not None
        assert (old.branded_classified, new.branded_classified) == (False, True)

    def test_names_the_keywords_whose_run_predates_the_flag(self, visibility):
        run = {
            'old': answers_from_rows([result('old', 'openai', [_HOTEL])]),
            'new': answers_from_rows([{**result('new', 'openai', [_HOTEL]), 'branded': False}]),
        }

        assert visibility._unclassified_keywords(run) == ['old']

    def test_reports_how_many_keywords_a_filtered_view_could_not_compare(self, visibility_env):
        body = visibility_env.body({'keyword': 'hotel coruna spa', 'branded': 'neutral'})

        assert body['change_unclassified_keywords'] == 0

    def test_counts_the_keywords_whose_latest_run_predates_the_flag_in_a_filtered_view(self, visibility_env):
        filtered = visibility_env.body({'keyword': 'hotel coruna spa', 'branded': 'branded'})
        every = visibility_env.body({'keyword': 'hotel coruna spa'})

        assert (filtered['unclassified_keywords'], every['unclassified_keywords']) == (1, 0)
