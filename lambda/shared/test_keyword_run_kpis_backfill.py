"""Tests for shared/keyword_run_kpis_backfill.py: rolling up the runs stored before the rollup table existed."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from shared.keyword_run_kpis import tally_from_item
from shared.keyword_run_kpis_backfill import Cursor, KeywordRunKpisBackfill, keyword_pages, run_backfill
from shared.kpi_tally import tally_kpis
from shared.request_deadline import Deadline
from shared.scoped_reports import load_window_runs
from testing.client_errors import throttled
from testing.keyword_run_kpis_fixtures import rollup_items, rollup_table
from testing.window_budget_fixtures import ticking_deadline
from testing.window_rows_fixtures import group_window_rows, paged_search_results_table, run_timestamp, volume_keyword

_KEYWORDS = [volume_keyword(0), volume_keyword(1)]
_ROWS = group_window_rows(2, 4, answers_per_run=3)
_OWNED = ['hotel-coruna-mar.es']
_CONFIG = {'first_party_domains': _OWNED}


def _job(stored: dict[str, list[dict[str, Any]]], deadline: Deadline | None = None, *, page_size: int = 400, rebuild: bool = False) -> KeywordRunKpisBackfill:
    return KeywordRunKpisBackfill(
        paged_search_results_table(_ROWS, page_size), rollup_table(stored), _CONFIG, deadline or Deadline(60), rebuild=rebuild,
    )


def _timestamps(stored: dict[str, list[dict[str, Any]]], keyword: str) -> list[str]:
    return sorted(item['run_timestamp'] for item in stored.get(keyword, []))


@pytest.fixture
def backfilled() -> tuple[dict[str, Any], dict[str, list[dict[str, Any]]]]:
    """One whole backfill of both keywords into an empty table: its response and the rows written."""
    stored: dict[str, list[dict[str, Any]]] = {}
    return run_backfill(_job(stored), keyword_pages(None, _KEYWORDS, None), Cursor()), stored


class TestBackfill:
    def test_writes_one_row_per_run_of_every_keyword(self, backfilled):
        response, stored = backfilled

        assert (response['done'], response['runs_written'], _timestamps(stored, _KEYWORDS[1])) == (True, 8, [run_timestamp(index) for index in range(4)])

    def test_rows_written_equal_the_rows_the_workflow_writes(self, backfilled):
        written = sorted(backfilled[1][_KEYWORDS[0]], key=lambda item: item['run_timestamp'])

        assert list(map(tally_from_item, written)) == list(map(tally_from_item, rollup_items(_ROWS, _OWNED)[_KEYWORDS[0]]))

    def test_window_kpis_after_the_backfill_equal_the_kpis_of_the_rows(self, backfilled):
        stored = backfilled[1]

        rolled = load_window_runs(paged_search_results_table(_ROWS), _KEYWORDS, '2026-01-01', _OWNED, rollups=rollup_table(stored))
        raw = load_window_runs(paged_search_results_table(_ROWS), _KEYWORDS, '2026-01-01', _OWNED)

        assert tally_kpis([run for runs in rolled.runs.values() for run in runs], _OWNED) == tally_kpis([run for runs in raw.runs.values() for run in runs], _OWNED)

    def test_skips_runs_already_rolled_up_for_the_current_owned_domains(self):
        stored = rollup_items(_ROWS, _OWNED)

        response = run_backfill(_job(stored), keyword_pages(None, _KEYWORDS, None), Cursor())

        assert (response['runs_written'], response['runs_skipped']) == (0, 8)

    def test_rewrites_runs_rolled_up_for_other_owned_domains(self):
        stored = rollup_items(_ROWS, [])

        response = run_backfill(_job(stored), keyword_pages(None, _KEYWORDS, None), Cursor())

        assert response['runs_written'] == 8

    def test_rebuild_rewrites_every_run(self):
        stored = rollup_items(_ROWS, _OWNED)

        response = run_backfill(_job(stored, rebuild=True), keyword_pages(None, _KEYWORDS, None), Cursor())

        assert response['runs_written'] == 8

    def test_counts_a_row_that_fails_to_write_and_carries_on(self):
        job = _job({})
        job.rollups.put_item.side_effect = throttled('PutItem')

        response = run_backfill(job, keyword_pages(None, _KEYWORDS[:1], None), Cursor())

        assert (response['done'], response['write_failures']) == (True, 4)


class TestBackfillResumes:
    @pytest.fixture
    def stopped(self) -> tuple[dict[str, Any], dict[str, list[dict[str, Any]]]]:
        """The backfill stopped by its deadline after the first keyword's first page (five rows: runs 0 and 1 whole)."""
        stored: dict[str, list[dict[str, Any]]] = {}
        # Checks: the first keyword's start, then after its first page.
        response = run_backfill(_job(stored, ticking_deadline(2), page_size=7), keyword_pages(None, _KEYWORDS, None), Cursor())
        return response, stored

    def test_answers_the_cursor_of_the_last_run_written_when_the_deadline_stops_it(self, stopped):
        response, _stored = stopped

        assert (response['done'], response['cursor']) == (False, {'scan_key': None, 'keyword': _KEYWORDS[0], 'after': run_timestamp(1)})

    def test_writes_the_runs_read_whole_before_the_deadline(self, stopped):
        _response, stored = stopped

        assert _timestamps(stored, _KEYWORDS[0]) == [run_timestamp(0), run_timestamp(1)]

    def test_resuming_from_the_cursor_writes_every_run_left(self, stopped):
        response, stored = stopped

        resumed = run_backfill(_job(stored), keyword_pages(None, _KEYWORDS, None), Cursor.from_event(response['cursor']))

        assert (resumed['done'], resumed['runs_written'], _timestamps(stored, _KEYWORDS[0])) == (True, 6, [run_timestamp(index) for index in range(4)])

    def test_answers_the_next_keyword_when_the_deadline_is_spent_between_keywords(self):
        # Checks: the first keyword's start, its single page's end, then the second keyword's start.
        response = run_backfill(_job({}, ticking_deadline(3)), keyword_pages(None, _KEYWORDS, None), Cursor())

        assert response['cursor'] == {'scan_key': None, 'keyword': _KEYWORDS[1], 'after': None}


class TestKeywordPages:
    def test_walks_the_keywords_table_page_by_page_from_the_scan_key(self):
        table = MagicMock()
        table.scan.side_effect = [
            {'Items': [{'keyword': 'a'}, {'keyword': ''}], 'LastEvaluatedKey': {'id': 'k1'}},
            {'Items': [{'keyword': 'b'}, {'id': 'no text'}]},
        ]

        assert list(keyword_pages(table, None, {'id': 'k0'})) == [({'id': 'k0'}, ['a']), ({'id': 'k1'}, ['b'])]

    @pytest.mark.parametrize(('value', 'expected'), [
        (None, Cursor()),
        ('cursor', Cursor()),
        ({'scan_key': {'id': 'k1'}, 'keyword': 'a', 'after': 't'}, Cursor({'id': 'k1'}, 'a', 't')),
        ({'scan_key': 'k1', 'keyword': 3, 'after': None}, Cursor()),
    ])
    def test_reads_a_cursor_from_the_event(self, value, expected):
        assert Cursor.from_event(value) == expected
