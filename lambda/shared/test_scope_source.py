"""Tests for shared.scope_source: the live / snapshot routing rule."""

from __future__ import annotations

import pytest

from shared.scope_params import ReportScope
from shared.scope_source import LATEST_RUNS, LIVE_ROWS_BUDGET, estimated_rows, route_report_scope, route_scope


def test_estimated_rows_multiplies_keywords_personas_engines_and_runs() -> None:
    assert estimated_rows(100, 10, 4, 2) == 8000


def test_estimated_rows_counts_one_persona_when_none_is_enabled() -> None:
    assert estimated_rows(100, 0, 4) == 100 * 4 * LATEST_RUNS


def test_estimated_rows_rejects_negative_sizes() -> None:
    with pytest.raises(ValueError, match='never negative'):
        estimated_rows(-1, 1, 4)


def test_scope_at_the_budget_goes_live() -> None:
    assert route_scope('group', 100, personas=10, engines=4) == 'live'


def test_scope_one_keyword_over_the_budget_goes_to_the_snapshot() -> None:
    assert route_scope('group', 101, personas=10, engines=4) == 'snapshot'


def test_scope_all_of_ten_x_goes_to_the_snapshot() -> None:
    assert route_scope('all', 5000, personas=10, engines=4) == 'snapshot'


@pytest.mark.parametrize('kind', ['keyword', 'keywords'])
def test_keyword_and_keyword_id_scopes_always_go_live(kind: str) -> None:
    assert route_scope(kind, 100, personas=10, engines=4, runs_needed=365) == 'live'


def test_a_window_counts_its_runs_against_the_budget() -> None:
    assert route_scope('group', 20, personas=1, engines=4, runs_needed=365) == 'snapshot'


def test_budget_is_one_hundred_keywords_of_forty_answers_over_two_runs() -> None:
    assert LIVE_ROWS_BUDGET == 100 * 40 * 2


def test_a_report_scope_of_ten_x_all_goes_to_the_snapshot() -> None:
    scope = ReportScope(kind='all', keywords=tuple(f'k{index}' for index in range(5_000)), scope={'mode': 'all'}, label='All keywords')
    assert route_report_scope(scope, personas=10, engines=4) == 'snapshot'


def test_a_report_scope_of_one_hundred_keywords_goes_live() -> None:
    scope = ReportScope(kind='group', keywords=tuple(f'k{index}' for index in range(100)), scope={'group_ids': ['g']}, label='Group')
    assert route_report_scope(scope, personas=10, engines=4) == 'live'
