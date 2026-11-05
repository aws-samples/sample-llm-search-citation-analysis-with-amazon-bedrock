"""Tests for the projected, capped and deadline-bound Citations reads (``shared.citation_rollup_source``)."""

from __future__ import annotations

from collections.abc import Iterator

import pytest

from shared.citation_rollup_source import (
    CITATION_ATTRIBUTE_NAMES,
    ReadBudget,
    query_keyword_citations,
    query_scope_citations,
    reading_deadline,
    scan_citations,
)
from shared.request_deadline import Deadline, activate_deadline, clear_request_deadline, current_deadline
from testing.citation_rollup_fixtures import SegmentedTable, TickingClock, citation_rows

_ROWS = citation_rows(keywords=20, urls_per_keyword=50)
_KEYWORDS = [f'keyword {index:03d}' for index in range(20)]


@pytest.fixture(autouse=True)
def _no_leftover_deadline() -> Iterator[None]:
    yield
    clear_request_deadline()


def _read_scope(table: SegmentedTable, max_pages: int) -> tuple[list[dict], bool]:
    return query_scope_citations(table, _KEYWORDS, max_pages=max_pages, max_rows=10_000, max_pages_per_keyword=5)


def _row_keys(rows: list[dict]) -> list[tuple[str, str]]:
    return sorted((row['keyword'], row['normalized_url']) for row in rows)


class TestScanCitations:
    def test_answers_a_one_page_table_with_a_single_unsegmented_scan(self):
        table = SegmentedTable(_ROWS, max_page_rows=5_000)

        rows, truncated = scan_citations(table, max_pages_per_segment=4)

        assert (len(table.scans), 'Segment' in table.scans[0], len(rows), truncated) == (1, False, 1_000, False)

    def test_reads_every_row_exactly_once_through_the_segments_of_a_larger_table(self):
        table = SegmentedTable(_ROWS, max_page_rows=40)

        rows, truncated = scan_citations(table, max_pages_per_segment=100, segments=8)

        assert (_row_keys(rows), truncated) == (_row_keys(_ROWS), False)

    def test_scans_with_eight_segments_by_default(self):
        table = SegmentedTable(_ROWS, max_page_rows=40)

        scan_citations(table, max_pages_per_segment=100)

        assert sorted({scan['Segment'] for scan in table.scans[1:]}) == list(range(8))

    def test_projects_only_the_attributes_the_aggregation_reads(self):
        table = SegmentedTable(_ROWS, max_page_rows=5_000)

        rows, _ = scan_citations(table, max_pages_per_segment=4)

        assert set(rows[0]) == set(CITATION_ATTRIBUTE_NAMES.values())

    def test_reports_truncated_when_a_segment_reaches_its_page_cap(self):
        table = SegmentedTable(_ROWS, max_page_rows=10)

        rows, truncated = scan_citations(table, max_pages_per_segment=2, segments=4)

        assert (len(rows), truncated) == (4 * 2 * 10, True)

    def test_stops_after_the_first_page_and_reports_truncated_when_the_deadline_expires_mid_read(self):
        activate_deadline(Deadline(0.5, TickingClock(step=1.0)))
        table = SegmentedTable(_ROWS, max_page_rows=40)

        rows, truncated = scan_citations(table, max_pages_per_segment=100)

        assert (len(rows), truncated, current_deadline().cut) == (40, True, True)


class TestQueryScopeCitations:
    def test_reads_every_partition_of_the_scope_when_the_budget_suffices(self):
        table = SegmentedTable(_ROWS, max_page_rows=20)

        rows, truncated = _read_scope(table, max_pages=100)

        assert (_row_keys(rows), truncated) == (_row_keys(_ROWS), False)

    def test_reads_at_most_the_total_page_budget_across_every_keyword(self):
        # Every keyword holds 50 rows: two full pages of 25.
        table = SegmentedTable(_ROWS, max_page_rows=25)

        rows, truncated = _read_scope(table, max_pages=7)

        assert (len(rows), truncated) == (7 * 25, True)

    def test_refuses_another_page_once_the_row_budget_is_spent(self):
        budget = ReadBudget(pages=100, rows=120)
        budget.take_page()
        budget.count_rows(120)

        assert budget.take_page() is False

    def test_grants_a_page_while_rows_and_pages_remain(self):
        budget = ReadBudget(pages=1, rows=1)

        assert (budget.take_page(), budget.take_page()) == (True, False)

    def test_reads_nothing_more_and_reports_truncated_when_the_deadline_has_expired(self):
        activate_deadline(Deadline(0, lambda: 1.0))
        table = SegmentedTable(_ROWS, max_page_rows=20)

        rows, truncated = _read_scope(table, max_pages=100)

        assert (rows, truncated) == ([], True)

    def test_reports_truncated_when_one_keyword_passes_its_page_cap(self):
        table = SegmentedTable(_ROWS, max_page_rows=20)

        rows, truncated = query_keyword_citations(table, 'keyword 003', max_pages=2)

        assert (len(rows), truncated) == (40, True)


class TestReadingDeadline:
    def test_ends_the_read_reserve_seconds_before_the_request_deadline(self):
        activate_deadline(Deadline(10, lambda: 0.0))

        with reading_deadline(6.0) as read:
            remaining = read.remaining()

        assert remaining == pytest.approx(4.0, abs=0.05)

    def test_marks_the_request_deadline_cut_when_the_read_was_cut(self):
        request = activate_deadline(Deadline(3, lambda: 0.0))

        with reading_deadline(6.0) as read:
            read.stop_reading('a test read')

        assert (current_deadline() is request, request.cut) == (True, True)
