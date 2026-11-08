"""Like-for-like comparison of two runs: matched (keyword, persona, engine, market) cells and the comparison state."""

from __future__ import annotations

from typing import Any

import pytest

from shared.kpi_comparison import (
    COMPARABLE,
    COMPARISON_STATES,
    INCOMPLETE,
    NO_PREVIOUS,
    SCOPE_CHANGED,
    answered_share,
    compare_runs,
)
from shared.kpi_engine import answers_from_rows, filter_branded

_BEFORE = '2026-09-01T10:00:00Z'
_AFTER = '2026-09-08T10:00:00Z'


def _row(provider: str, timestamp: str = _AFTER, **fields: Any) -> dict[str, Any]:
    """One answer row of 'hotel spa' (default persona, global market) unless ``fields`` say otherwise."""
    return {
        'keyword': 'hotel spa', 'timestamp': timestamp, 'provider': provider, 'status': 'success',
        'query_prompt_id': 'default', 'market_id': 'global', 'brands': [], 'citations': [], **fields,
    }


def _run(timestamp: str, *providers: str) -> list[dict[str, Any]]:
    return [_row(provider, timestamp) for provider in providers]


class TestComparisonState:
    def test_lists_every_state(self):
        assert COMPARISON_STATES == ('no_previous', 'scope_changed', 'incomplete', 'comparable')

    def test_is_no_previous_without_an_earlier_run(self):
        assert compare_runs(None, _run(_AFTER, 'openai')).state == NO_PREVIOUS

    def test_is_comparable_when_both_runs_answered_the_same_cells(self):
        assert compare_runs(_run(_BEFORE, 'openai', 'gemini'), _run(_AFTER, 'openai', 'gemini')).state == COMPARABLE

    def test_is_scope_changed_when_the_runs_share_no_cell(self):
        assert compare_runs(_run(_BEFORE, 'openai'), _run(_AFTER, 'claude')).state == SCOPE_CHANGED

    def test_is_scope_changed_when_only_the_market_differs(self):
        before = [_row('openai', _BEFORE, market_id='cl-es')]

        assert compare_runs(before, _run(_AFTER, 'openai')).state == SCOPE_CHANGED

    def test_is_incomplete_when_a_run_answered_under_ninety_percent(self):
        current = [*_run(_AFTER, 'openai', 'gemini', 'claude', 'perplexity'), {**_row('google_ai_overview'), 'status': 'error'}]

        assert compare_runs(_run(_BEFORE, 'openai', 'gemini'), current).state == INCOMPLETE

    def test_counts_a_no_answer_reply_as_answered_for_completeness(self):
        current = [*_run(_AFTER, 'openai'), {**_row('google_ai_overview'), 'status': 'no_answer'}]

        assert compare_runs(_run(_BEFORE, 'openai'), current).state == COMPARABLE


class TestMatchedCells:
    def test_compares_only_the_cells_answered_in_both_runs(self):
        comparison = compare_runs(_run(_BEFORE, 'openai'), _run(_AFTER, 'openai', 'claude'))

        assert [answer.provider for answer in comparison.current] == ['openai']

    def test_matches_on_the_persona(self):
        before = [_row('openai', _BEFORE, query_prompt_id='family'), _row('openai', _BEFORE)]
        after = [_row('openai', query_prompt_id='business'), _row('openai')]

        assert compare_runs(before, after).matched_cells == 1

    #: One neutral and one branded answer per run, in the same cells.
    MIXED_BEFORE = [_row('openai', _BEFORE), _row('gemini', _BEFORE, branded=True)]
    MIXED_AFTER = [_row('openai'), _row('gemini', branded=True)]

    def test_compares_neutral_answers_by_default(self):
        assert [answer.provider for answer in compare_runs(self.MIXED_BEFORE, self.MIXED_AFTER).current] == ['openai']

    def test_compares_every_answer_with_the_all_filter(self):
        assert compare_runs(self.MIXED_BEFORE, self.MIXED_AFTER, 'all').matched_cells == 2

    def test_returns_no_answers_for_a_comparison_that_is_not_comparable(self):
        comparison = compare_runs(_run(_BEFORE, 'openai'), _run(_AFTER, 'claude'))

        assert (comparison.previous, comparison.current) == ((), ())

    def test_stores_the_state_cells_and_answered_shares(self):
        assert compare_runs(_run(_BEFORE, 'openai'), _run(_AFTER, 'openai')).to_json() == {
            'state': 'comparable', 'matched_cells': 1, 'answered_share': {'previous': 100.0, 'current': 100.0},
        }


class TestAnsweredShare:
    def test_ignores_web_search_rows(self):
        assert answered_share([_row('openai'), {**_row('brave'), 'status': 'error'}]) == 100.0

    def test_is_empty_when_nothing_was_planned(self):
        assert answered_share([_row('brave')]) is None

    def test_reads_a_row_without_status_as_answered(self):
        row = _row('openai')
        del row['status']

        assert answered_share([row]) == 100.0


class TestFilterBranded:
    ROWS = [_row('openai'), _row('gemini', branded=True), _row('claude', branded=False)]

    @pytest.mark.parametrize(('branded', 'providers'), [
        ('neutral', ['openai', 'claude']),
        ('branded', ['gemini']),
        ('all', ['openai', 'gemini', 'claude']),
    ])
    def test_keeps_the_answers_of_the_filter(self, branded, providers):
        assert [answer.provider for answer in filter_branded(answers_from_rows(self.ROWS), branded)] == providers
