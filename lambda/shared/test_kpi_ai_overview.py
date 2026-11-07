"""Google AI Overviews rows in the KPI engine: ``no_answer`` is excluded, presence is counted."""

from __future__ import annotations

from typing import Any

from shared.kpi_engine import KPI_IDS, answers_from_rows, brand_kpis, overview_presence

_EXAMPLE_AIR = {'name': 'Example Air', 'classification': 'first_party', 'rank': 1, 'sentiment': 'positive'}


def _aio_row(status: str, **extra: Any) -> dict[str, Any]:
    return {'keyword': 'flights to coruña', 'provider': 'google_ai_overview', 'status': status,
            'timestamp': '2026-10-02T10:00:00Z', 'brands': [], 'citations': [], **extra}


_ANSWERED = _aio_row('success', brands=[_EXAMPLE_AIR], citations=['https://example.com/fares'])
_NO_OVERVIEW = _aio_row('no_answer')
_FAILED = _aio_row('error')


def test_counts_answered_overview_as_answer():
    assert brand_kpis(answers_from_rows([_ANSWERED]))['answers'] == 1


def test_excludes_no_answer_rows_from_every_kpi():
    with_page = brand_kpis(answers_from_rows([_ANSWERED, _NO_OVERVIEW]))

    assert with_page == brand_kpis(answers_from_rows([_ANSWERED]))


def test_keeps_mention_rate_at_full_when_other_pages_showed_no_overview():
    kpis = brand_kpis(answers_from_rows([_ANSWERED, _NO_OVERVIEW, _NO_OVERVIEW]))

    assert kpis['mention_rate'] == 100.0


def test_reports_overview_shown_for_one_of_two_queries_when_one_page_had_none():
    assert overview_presence([_ANSWERED, _NO_OVERVIEW]) == {
        'aio_overviews': 1, 'aio_queries': 2, 'aio_presence_rate': 50.0,
    }


def test_leaves_failed_calls_out_of_presence_denominator():
    assert overview_presence([_ANSWERED, _FAILED])['aio_queries'] == 1


def test_ignores_other_engines_rows_in_presence():
    openai = {**_ANSWERED, 'provider': 'openai'}

    assert overview_presence([openai]) == {'aio_overviews': 0, 'aio_queries': 0, 'aio_presence_rate': None}


def test_keeps_presence_out_of_kpi_ids():
    assert set(overview_presence([])).isdisjoint(KPI_IDS)
