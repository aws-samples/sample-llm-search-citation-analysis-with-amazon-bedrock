"""``GET /api/visibility?branded=``: the answers to queries that name the brand, that do not, or every answer."""

from __future__ import annotations

import os
from typing import Any

import pytest

from shared.kpi_engine import answer_from_row
from testing.events import parse_response
from testing.report_scope_fixtures import brand, load_scoped_handler, result, scoped_report

_HERE = os.path.dirname(os.path.abspath(__file__))
_HOTEL = brand('Hotel Coruna', 'first_party', 1, 1)


def _branded(row: dict[str, Any]) -> dict[str, Any]:
    return {**row, 'branded': True}


def _neutral(row: dict[str, Any]) -> dict[str, Any]:
    return {**row, 'branded': False}


_ROWS = {
    'hotel coruna spa': [
        _branded(result('hotel coruna spa', 'openai', [_HOTEL])),
        _neutral(result('hotel coruna spa', 'gemini', [_HOTEL])),
        _neutral(result('hotel coruna spa', 'claude', [])),
    ],
    # Stored before the branded flag (2.43.0): no row carries it.
    'hotel marino spa': [result('hotel marino spa', 'openai', [_HOTEL]), result('hotel marino spa', 'gemini', [])],
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

    @pytest.mark.parametrize('branded', ['neutral', 'branded'])
    def test_leaves_a_run_stored_before_the_flag_out_of_a_filtered_view(self, visibility_env, branded):
        assert visibility_env.body({'keyword': 'hotel marino spa', 'branded': branded})['kpis']['answers'] == 0

    def test_keeps_a_run_stored_before_the_flag_in_the_unfiltered_view(self, visibility_env):
        assert visibility_env.body({'keyword': 'hotel marino spa'})['kpis']['answers'] == 2
