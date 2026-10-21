"""Tests for ``shared.bounded_counts``: counts that finish inside an API request."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any
from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError

from shared.bounded_counts import Count, Deadline, count_pages, partition_count, table_count
from testing.client_errors import throttled
from testing.dynamodb_stubs import fake_table
from testing.search_results_fixtures import key_parts


class FakeClock:
    """A monotonic clock the test moves by hand."""

    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def _pages(*counts: int) -> list[dict[str, Any]]:
    """``Select='COUNT'`` pages answering ``counts``, each but the last pointing at the next."""
    return [
        {'Count': count, **({'LastEvaluatedKey': {'id': f'k-{index}'}} if index < len(counts) - 1 else {})}
        for index, count in enumerate(counts)
    ]


def _described_table(size_bytes: int, item_count: int, *scan_counts: int) -> MagicMock:
    table = fake_table()
    table.table_name = 'test-table'
    table.meta.client.describe_table.return_value = {'Table': {'TableSizeBytes': size_bytes, 'ItemCount': item_count}}
    table.scan.side_effect = _pages(*scan_counts)
    return table


class TestDeadline:
    def test_is_not_expired_before_its_budget_has_elapsed(self):
        clock = FakeClock()
        deadline = Deadline(5, clock)
        clock.now = 4.9

        assert deadline.expired() is False

    def test_is_expired_once_its_budget_has_elapsed(self):
        clock = FakeClock()
        deadline = Deadline(5, clock)
        clock.now = 5

        assert deadline.expired() is True


class TestCountPages:
    def test_sums_every_page_when_time_allows(self):
        operation = MagicMock(side_effect=_pages(2, 3, 4))

        assert count_pages(operation, Deadline(60)) == (9, True)

    def test_stops_after_the_page_read_when_the_deadline_passes(self):
        clock = FakeClock()
        deadline = Deadline(1, clock)

        def page(**kwargs: Any) -> Mapping[str, Any]:
            clock.now += 1
            return {'Count': 5, 'LastEvaluatedKey': {'id': 'next'}}

        assert count_pages(page, deadline) == (5, False)

    def test_reads_the_first_page_even_with_an_expired_deadline(self):
        operation = MagicMock(return_value={'Count': 7})

        assert count_pages(operation, Deadline(0)) == (7, True)


class TestTableCount:
    def test_counts_a_small_table_exactly(self):
        table = _described_table(1_000, 3, 2, 4)

        assert table_count(table, Deadline(60)) == Count(6)

    def test_reports_the_described_item_count_of_a_large_table_without_scanning(self):
        table = _described_table(40 * 1024 ** 3, 1_234_567)

        count = table_count(table, Deadline(60))

        assert count == Count(1_234_567, approximate=True)
        table.scan.assert_not_called()

    def test_reads_the_table_description_fresh_on_every_call(self):
        table = _described_table(10, 1, 1)
        table.scan.side_effect = None
        table.scan.return_value = {'Count': 1}

        table_count(table, Deadline(60))
        table_count(table, Deadline(60))

        assert table.meta.client.describe_table.call_count == 2

    def test_reports_the_larger_of_partial_count_and_item_count_when_the_deadline_cuts_an_exact_count(self):
        table = _described_table(1_000, 50, 10, 10)

        assert table_count(table, Deadline(0)) == Count(50, approximate=True)

    def test_propagates_a_failed_description(self):
        table = _described_table(1_000, 3, 1)
        table.meta.client.describe_table.side_effect = throttled('DescribeTable')

        with pytest.raises(ClientError, match='DescribeTable'):
            table_count(table, Deadline(60))


def _partition_table(counts: Mapping[str, list[int]]) -> MagicMock:
    """A table whose ``query`` answers each keyword's pages of ``counts`` in turn (one page per call)."""
    remaining = {keyword: _pages(*pages) for keyword, pages in counts.items()}

    def query(**kwargs: Any) -> Mapping[str, Any]:
        return remaining[key_parts(kwargs['KeyConditionExpression'])[0]].pop(0)

    table = fake_table()
    table.query.side_effect = query
    return table


class TestPartitionCount:
    def test_sums_every_partition_exactly_when_time_allows(self):
        table = _partition_table({'a': [1, 2], 'b': [4]})

        assert partition_count(table, 'keyword', ['b', 'a', 'a'], Deadline(60)) == Count(7)

    def test_counts_nothing_for_no_partition(self):
        assert partition_count(fake_table(), 'keyword', [], Deadline(60)) == Count(0)

    def test_reads_no_partition_once_the_deadline_has_passed(self):
        table = fake_table()

        count = partition_count(table, 'keyword', ['a', 'b'], Deadline(0))

        assert count == Count(0, approximate=True)
        table.query.assert_not_called()

    def test_estimates_unfinished_partitions_from_the_finished_ones(self):
        clock = FakeClock()
        deadline = Deadline(1, clock)
        table = _partition_table({'a': [10], 'b': [6], 'c': [2, 50]})

        def query_then_tick(**kwargs: Any) -> Mapping[str, Any]:
            page = _partition_query(**kwargs)
            if key_parts(kwargs['KeyConditionExpression'])[0] == 'c':
                clock.now = 2
            return page

        _partition_query = table.query.side_effect
        table.query.side_effect = query_then_tick

        count = partition_count(table, 'keyword', ['a', 'b', 'c'], deadline, max_workers=1)

        assert count == Count(10 + 6 + 8, approximate=True)

    def test_queries_the_named_index(self):
        table = fake_table(query={'Count': 1})

        partition_count(table, 'keyword', ['a'], Deadline(60), index_name='KeywordIndex')

        assert table.query.call_args.kwargs['IndexName'] == 'KeywordIndex'

    def test_propagates_a_failed_partition(self):
        table = fake_table()
        table.query.side_effect = throttled('Query')

        with pytest.raises(ClientError, match='Query'):
            partition_count(table, 'keyword', ['a'], Deadline(60))
