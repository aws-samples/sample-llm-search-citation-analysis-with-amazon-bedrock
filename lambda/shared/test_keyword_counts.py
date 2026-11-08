"""Tests for shared.keyword_counts: the KeywordLatest ``counts`` block, counted once in full and then run by run."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

from shared.keyword_counts import CRAWLED_INDEX, CRAWLED_RECOUNT_DAYS, RUNS_KEPT_DAYS, KeywordCounter, fold_old_runs
from testing.assertions import present
from testing.client_errors import throttled


def fake_count_table(count: int) -> MagicMock:
    """A table whose ``Select=COUNT`` query answers ``count`` in one page."""
    table = MagicMock()
    table.query.return_value = {'Count': count}
    return table


def _counter(searches: int = 50, citations: int = 7, crawled: int = 4) -> KeywordCounter:
    return KeywordCounter(fake_count_table(searches), fake_count_table(citations), fake_count_table(crawled))


class TestFirstBlock:
    def test_searches_count_the_whole_partition_once(self):
        assert present(_counter(searches=50).counts('hotel coruna', None, {'2026-10-01T06:00:00Z': 8}))['searches'] == 50

    def test_the_base_is_the_partition_without_the_runs_counted(self):
        assert present(_counter(searches=50).counts('hotel coruna', None, {'2026-10-01T06:00:00Z': 8}))['base'] == 42

    def test_citations_and_crawled_pages_are_counted(self):
        block = present(_counter(citations=7, crawled=4).counts('hotel coruna', None, {'2026-10-01T06:00:00Z': 8}))
        assert (block['citations'], block['crawled']) == (7, 4)

    def test_crawled_pages_are_counted_on_the_keyword_index(self):
        crawled = fake_count_table(4)
        KeywordCounter(fake_count_table(50), fake_count_table(7), crawled).counts('hotel coruna', None, {'2026-10-01T06:00:00Z': 8})
        assert crawled.query.call_args.kwargs['IndexName'] == CRAWLED_INDEX


class TestNextRuns:
    PREVIOUS = {'searches': 50, 'citations': 7, 'crawled': 4, 'base': 42, 'runs': {'2026-10-01T06:00:00Z': 8}}

    def test_a_new_run_adds_its_rows_without_counting_the_partition_again(self):
        counter = _counter(searches=999)
        block = present(counter.counts('hotel coruna', self.PREVIOUS, {'2026-10-02T06:00:00Z': 10}))
        assert (block['searches'], counter.search_table.query.call_count) == (60, 0)

    def test_a_rerun_replaces_the_runs_count(self):
        block = present(_counter().counts('hotel coruna', self.PREVIOUS, {'2026-10-01T06:00:00Z': 9}))
        assert block['searches'] == 51


def _daily(days: int) -> dict[str, int]:
    """``days`` daily runs from 2025-10-01, 10 rows each."""
    start = datetime(2025, 10, 1, 6, 0, tzinfo=UTC)
    return {(start + timedelta(days=day)).strftime('%Y-%m-%dT%H:%M:%S.000000Z'): 10 for day in range(days)}


class TestOldRunsFolded:
    PREVIOUS = {'searches': 4_000, 'citations': 7, 'crawled': 4, 'base': 0, 'runs': _daily(400)}

    def test_runs_older_than_the_kept_window_leave_the_block(self):
        block = present(_counter().counts('hotel coruna', self.PREVIOUS, {}))
        assert len(block['runs']) == RUNS_KEPT_DAYS + 1

    def test_folding_keeps_the_searches_total(self):
        block = present(_counter().counts('hotel coruna', self.PREVIOUS, {}))
        assert (block['searches'], block['base']) == (4_000, 10 * (400 - RUNS_KEPT_DAYS - 1))

    def test_a_block_without_runs_is_left_as_it_is(self):
        assert fold_old_runs({}, 12) == ({}, 12)


class TestCrawledRecount:
    COUNTED = {'searches': 50, 'citations': 7, 'crawled': 4, 'base': 42, 'runs': {'2026-10-01T06:00:00.000000Z': 8}, 'crawled_counted_at': '2026-10-01T06:00:00.000000Z'}

    def test_the_crawled_count_is_kept_within_the_recount_days(self):
        crawled = fake_count_table(99)
        counter = KeywordCounter(fake_count_table(50), fake_count_table(7), crawled)
        block = present(counter.counts('hotel coruna', self.COUNTED, {'2026-10-03T06:00:00.000000Z': 8}))
        assert (block['crawled'], crawled.query.call_count) == (4, 0)

    def test_the_crawled_count_is_read_again_after_the_recount_days(self):
        later = (datetime(2026, 10, 1, 6, 0, tzinfo=UTC) + timedelta(days=CRAWLED_RECOUNT_DAYS)).strftime('%Y-%m-%dT%H:%M:%S.000000Z')
        block = present(_counter(crawled=99).counts('hotel coruna', self.COUNTED, {later: 8}))
        assert (block['crawled'], block['crawled_counted_at']) == (99, later)

    def test_a_block_without_a_count_time_counts_the_crawled_pages(self):
        previous = {key: value for key, value in self.COUNTED.items() if key != 'crawled_counted_at'}
        assert present(_counter(crawled=99).counts('hotel coruna', previous, {'2026-10-02T06:00:00.000000Z': 8}))['crawled'] == 99


class TestUnreadableCounts:
    def test_a_count_that_does_not_finish_leaves_the_block_out(self):
        citations = fake_count_table(3)
        citations.query.side_effect = [{'Count': 3, 'LastEvaluatedKey': {'k': 1}}, throttled('Query')]
        counter = KeywordCounter(fake_count_table(5), citations, fake_count_table(1))
        assert counter.counts('hotel coruna', None, {'2026-10-01T06:00:00Z': 1}) is None

    def test_without_the_crawl_table_there_is_no_block(self):
        assert KeywordCounter(fake_count_table(5), fake_count_table(3), None).counts('hotel coruna', None, {}) is None


def test_a_count_that_answers_no_number_leaves_the_block_out():
    odd = fake_count_table(5)
    odd.query.return_value = {'Count': 'many'}
    assert KeywordCounter(odd, fake_count_table(3), fake_count_table(1)).counts('hotel coruna', None, {'2026-10-01T06:00:00Z': 1}) is None
