"""
Tests for shared.bounded_reads.

``collect_capped_partition`` pages through one table or GSI partition under a
page cap.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from boto3.dynamodb.conditions import Key

from shared.bounded_reads import collect_capped_partition


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
