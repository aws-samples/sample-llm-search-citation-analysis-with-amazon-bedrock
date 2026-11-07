"""``GET /api/visibility?branded=``: the answers to queries that name the brand, that do not, or every answer."""

from __future__ import annotations

import os
from typing import Any

import pytest

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
