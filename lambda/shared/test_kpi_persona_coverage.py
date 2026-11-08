"""A persona's KPIs leave out the engines asked only the plain keyword (Google AI Overviews) and name them as not covered."""

from __future__ import annotations

import pytest

from shared.kpi_engine import engines_not_covered
from testing.kpi_latest_fixtures import scope_latests, served_visibility, snapshot_artifacts
from testing.search_result_fixtures import successful_answer_row

_RUN = '2026-10-01T06:00:00.000000Z'
_KEYWORD = 'spa'


def _answer(provider: str, persona: str) -> dict:
    """An answer of ``provider`` to ``spa`` under ``persona``, naming the first party first."""
    row = successful_answer_row(
        keyword=_KEYWORD, timestamp=_RUN, provider=provider, brands=[('Hotel Sol', 'first_party', 1)], citations=[],
    )
    return {**row, 'query_prompt_id': persona}


#: One run with a persona: OpenAI and Gemini answer the persona, Google AI Overviews the plain keyword.
_ROWS = [_answer('openai', 'family'), _answer('gemini', 'family'), _answer('google_ai_overview', 'default')]


def _served(persona: str | None) -> dict:
    artifacts = snapshot_artifacts(scope_latests([_KEYWORD], _ROWS, []), keywords_total=1)
    body = served_visibility(artifacts, persona=persona, page_size=None)
    assert body is not None
    return body


@pytest.mark.parametrize('persona', [None, 'default'])
def test_names_no_engine_when_figures_are_not_narrowed_to_a_persona(persona):
    assert engines_not_covered(persona) == []


def test_names_google_ai_overviews_when_figures_are_narrowed_to_a_persona():
    assert engines_not_covered('family') == ['google_ai_overview']


def test_leaves_google_ai_overviews_out_of_a_personas_engine_count():
    assert _served('family')['kpis']['engines'] == 2


def test_lists_no_google_ai_overviews_row_among_a_personas_engines():
    assert 'google_ai_overview' not in {row['engine'] for row in _served('family')['engines']}


def test_names_google_ai_overviews_as_not_covered_in_a_personas_body():
    assert _served('family')['engines_not_covered'] == ['google_ai_overview']


def test_counts_google_ai_overviews_when_every_answer_is_shown():
    body = _served(None)

    assert (body['kpis']['engines'], body['engines_not_covered']) == (3, [])
