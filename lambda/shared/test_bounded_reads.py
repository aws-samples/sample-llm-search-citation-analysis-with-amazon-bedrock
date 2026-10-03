"""
Tests for shared.bounded_reads.

``collect_capped_items`` follows ``LastEvaluatedKey`` for at most ``max_pages``
pages and reports whether the cap cut the read short; ``newest_items`` reads one
newest-first page of a table or GSI partition.
"""

from __future__ import annotations

from unittest.mock import MagicMock, call

import pytest
from boto3.dynamodb.conditions import Key

from shared.bounded_reads import collect_capped_items, collect_capped_partition, newest_items


def _pages(*pages: dict) -> MagicMock:
    operation = MagicMock()
    operation.side_effect = list(pages)
    return operation


class TestCollectCappedItems:
    @pytest.mark.parametrize('max_pages', [pytest.param(5, id='under-the-cap'), pytest.param(2, id='exactly-at-the-cap')])
    def test_concatenates_the_pages_until_one_has_no_last_evaluated_key(self, max_pages: int) -> None:
        operation = _pages({'Items': [{'id': 1}], 'LastEvaluatedKey': {'id': 1}}, {'Items': [{'id': 2}]})

        assert collect_capped_items(operation, max_pages) == ([{'id': 1}, {'id': 2}], False)

    def test_feeds_each_last_evaluated_key_into_the_next_request(self) -> None:
        operation = _pages({'Items': [], 'LastEvaluatedKey': {'id': 1}}, {'Items': []})

        collect_capped_items(operation, 5, IndexName='UrlIndex')

        assert operation.call_args_list == [call(IndexName='UrlIndex'), call(IndexName='UrlIndex', ExclusiveStartKey={'id': 1})]

    def test_stops_at_the_cap_and_reports_the_read_as_truncated(self) -> None:
        operation = MagicMock(return_value={'Items': [{'id': 'x'}], 'LastEvaluatedKey': {'id': 'x'}})

        items, truncated = collect_capped_items(operation, 3)

        assert (operation.call_count, len(items), truncated) == (3, 3, True)

    def test_reads_a_page_without_items_as_empty(self) -> None:
        assert collect_capped_items(_pages({}), 1) == ([], False)


class TestCollectCappedPartition:
    def test_pages_through_the_named_index_partition(self) -> None:
        table = MagicMock()
        table.query.side_effect = [{'Items': [{'id': 1}], 'LastEvaluatedKey': {'id': 1}}, {'Items': [{'id': 2}]}]

        items, truncated = collect_capped_partition(table, 'normalized_url', 'https://a.com/x', 3, index_name='UrlIndex')

        assert (items, truncated, table.query.call_args.kwargs) == ([{'id': 1}, {'id': 2}], False, {
            'KeyConditionExpression': Key('normalized_url').eq('https://a.com/x'),
            'IndexName': 'UrlIndex',
            'ExclusiveStartKey': {'id': 1},
        })

    def test_reads_the_tables_own_partition_without_an_index(self) -> None:
        table = MagicMock()
        table.query.return_value = {'Items': []}

        collect_capped_partition(table, 'keyword', 'k', 1)

        table.query.assert_called_once_with(KeyConditionExpression=Key('keyword').eq('k'))


class TestNewestItems:
    def test_queries_one_newest_first_page_of_the_partition(self) -> None:
        table = MagicMock()
        table.query.return_value = {'Items': [{'keyword': 'k'}]}

        assert newest_items(table, 'keyword', 'k', 7) == [{'keyword': 'k'}]
        table.query.assert_called_once_with(KeyConditionExpression=Key('keyword').eq('k'), ScanIndexForward=False, Limit=7)

    def test_reads_the_named_index_when_given(self) -> None:
        table = MagicMock()
        table.query.return_value = {}

        assert newest_items(table, 'provider', 'openai', 50, index_name='ProviderIndex') == []
        assert table.query.call_args.kwargs['IndexName'] == 'ProviderIndex'

    def test_omits_the_index_name_without_one(self) -> None:
        table = MagicMock()
        table.query.return_value = {'Items': []}

        newest_items(table, 'keyword', 'k', 1)

        assert 'IndexName' not in table.query.call_args.kwargs
