"""Tests for shared/scoped_reports.load_window_runs over per-run KPI rollups (``shared.keyword_run_kpis``).

The rollup path must answer exactly what the raw path answers (every run's
tally equal, so every KPI and view built from them equal), read no
SearchResults row a rollup covers, and keep the 2.42.0 time-budget rules.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from typing import Any

import pytest
from hypothesis import given, settings

from shared.kpi_tally import tally_kpis
from shared.request_deadline import Deadline
from shared.scoped_reports import WindowRuns, load_window_runs
from shared.visibility_views import trend_view
from testing.keyword_run_kpis_fixtures import rollup_items, rollup_table
from testing.kpi_row_strategies import KEYWORDS, OWNED_CHOICES, OWNED_DOMAINS, search_rows
from testing.window_budget_fixtures import active_deadline, ticking_deadline, window_read_budget
from testing.window_rows_fixtures import (
    group_window_rows,
    paged_search_results_table,
    record_rows_read,
    run_timestamp,
    volume_keyword,
)

_START = '2026-01-01T00:00:00.000000Z'
_KEYWORDS = [volume_keyword(0), volume_keyword(1)]
_ROWS = group_window_rows(2, 6, answers_per_run=3)
_OWNED = ['hotel-coruna-mar.es']


def _by_keyword(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[row['keyword']].append(row)
    return dict(grouped)


def _for_any_rows(test: Callable[..., None]) -> Callable[..., None]:
    """Run ``test(self, by_keyword, owned)`` for generated SearchResults rows (grouped by keyword) and owned domains."""
    return settings(max_examples=60, deadline=None)(given(by_keyword=search_rows().map(_by_keyword), owned=OWNED_DOMAINS)(test))


def _paged_rollups() -> Any:
    """The rollups of ``_ROWS`` in pages of two rows."""
    return rollup_table(rollup_items(_ROWS, _OWNED), page_size=2)


def _raw(rows_by_keyword: dict[str, list[dict[str, Any]]], owned: Any) -> WindowRuns:
    """The window of ``KEYWORDS`` read from SearchResults alone (no rollup table)."""
    return load_window_runs(paged_search_results_table(rows_by_keyword), list(KEYWORDS), _START, owned)


def _rolled(rows_by_keyword: dict[str, list[dict[str, Any]]], owned: Any, items: dict[str, list[dict[str, Any]]]) -> WindowRuns:
    """The window of ``KEYWORDS`` read from the rollup rows ``items`` first."""
    return load_window_runs(paged_search_results_table(rows_by_keyword), list(KEYWORDS), _START, owned, rollups=rollup_table(items))


def _first_keyword(rollups: Any, **options: Any) -> WindowRuns:
    """The window of the first of ``_KEYWORDS`` (``_ROWS``) read with ``rollups``."""
    return load_window_runs(paged_search_results_table(_ROWS), _KEYWORDS[:1], _START, _OWNED, rollups=rollups, **options)


def _timestamps(window: WindowRuns) -> list[str]:
    return [run.timestamp for run in window.runs[_KEYWORDS[0]]]


class TestRollupsEqualRawRows:
    @_for_any_rows
    def test_every_run_read_from_rollups_equals_the_run_read_from_its_rows(self, by_keyword, owned):
        assert _rolled(by_keyword, owned, rollup_items(by_keyword, owned)).runs == _raw(by_keyword, owned).runs

    @_for_any_rows
    def test_trend_view_of_rollups_equals_the_trend_view_of_the_rows(self, by_keyword, owned):
        keywords = list(KEYWORDS)

        rolled = trend_view(keywords, _rolled(by_keyword, owned, rollup_items(by_keyword, owned)).runs, 'week', owned)

        assert rolled == trend_view(keywords, _raw(by_keyword, owned).runs, 'week', owned)

    @_for_any_rows
    def test_runs_older_than_a_keywords_first_rollup_are_read_from_its_rows(self, by_keyword, owned):
        # Only each keyword's newest run was rolled up (the release that added the table ran once).
        newest = {keyword: items[-1:] for keyword, items in rollup_items(by_keyword, owned).items()}

        assert _rolled(by_keyword, owned, newest).runs == _raw(by_keyword, owned).runs

    @_for_any_rows
    def test_a_rollup_counted_against_other_owned_domains_is_retallied_from_its_rows(self, by_keyword, owned):
        other = next(choice for choice in OWNED_CHOICES[1:] if choice != owned)

        rolled = _rolled(by_keyword, owned, rollup_items(by_keyword, other))

        assert [tally_kpis(runs, owned) for runs in rolled.runs.values()] == [tally_kpis(runs, owned) for runs in _raw(by_keyword, owned).runs.values()]


class TestRollupReads:
    def test_reads_no_search_results_row_a_rollup_covers(self):
        table = paged_search_results_table(_ROWS)
        rows_read = record_rows_read(table)

        load_window_runs(table, _KEYWORDS, _START, _OWNED, rollups=rollup_table(rollup_items(_ROWS, _OWNED)))

        assert rows_read == []

    def test_reads_through_the_run_until(self):
        window = _first_keyword(rollup_table(rollup_items(_ROWS, _OWNED)), until=run_timestamp(2))

        assert _timestamps(window) == [run_timestamp(index) for index in range(3)]

    def test_leaves_brand_counts_unread_when_asked(self):
        window = _first_keyword(rollup_table(rollup_items(_ROWS, _OWNED)), brands=False)

        assert {run.brands for run in window.runs[_KEYWORDS[0]]} == {()}

    def test_skips_a_run_whose_rollup_has_no_answer(self):
        items = rollup_items(_ROWS, _OWNED)
        items[_KEYWORDS[0]][-1] = {**items[_KEYWORDS[0]][-1], 'answers': 0, 'engines': '{}'}

        assert _timestamps(_first_keyword(rollup_table(items))) == [run_timestamp(index) for index in range(5)]


class TestRollupTimeBudget:
    @pytest.mark.parametrize(('rollups', 'checks'), [
        # Checks: the keyword's start, then after the first page (runs 5 and 4 of six, two a page).
        pytest.param(_paged_rollups, 2, id='rollup-page-read'),
        # Checks: the keyword's start, the newest stale run's rebuild, then the next one finds the budget spent.
        pytest.param(lambda: rollup_table(rollup_items(_ROWS, [])), 3, id='stale-rollup-rebuild'),
    ])
    def test_keeps_the_newest_runs_of_a_single_keyword_and_names_the_cut_when_the_budget_stops_it(self, rollups, checks):
        with window_read_budget(lambda: ticking_deadline(checks)):
            window = _first_keyword(rollups())

        assert (_timestamps(window), window.truncated_before) == ([run_timestamp(5)], run_timestamp(4))

    def test_skips_a_keyword_of_several_the_budget_stops_mid_read(self):
        with window_read_budget(lambda: ticking_deadline(2)):
            window = load_window_runs(
                paged_search_results_table(_ROWS), _KEYWORDS, _START, _OWNED, rollups=_paged_rollups(),
            )

        assert _KEYWORDS[0] in window.skipped

    def test_marks_the_request_deadline_cut_when_the_rollup_read_stopped(self):
        with active_deadline(Deadline(60, lambda: 0.0)) as request, window_read_budget(lambda: ticking_deadline(2)):
            _first_keyword(_paged_rollups())

        assert request.cut is True
