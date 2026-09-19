"""
Tests for shared.dynamodb_batch.

``query_latest_per_key`` — the semantics the handler callers depend on:
- Duplicates in partition_values are collapsed
- Empty input short-circuits
- Failed queries produce None for that key, not a raised exception
- The query is built with ScanIndexForward=False and Limit=1 (latest row)
- Results preserve input order

``collect_all_items`` — pages are concatenated in order and each page's
``LastEvaluatedKey`` is fed back as the next ``ExclusiveStartKey``.
"""

from __future__ import annotations

from unittest.mock import MagicMock, call

from shared import dynamodb_batch


class QueryFailure(Exception):
    """Expected query failure raised by the test double."""


def _fake_table_with_items(per_key_items: dict[str, list[dict]]) -> MagicMock:
    """Build a MagicMock table whose `.query` returns items matching the
    partition-key value embedded in the KeyConditionExpression.

    boto3's ``Key('pk').eq('u1')`` returns an Equals condition whose
    public ``get_expression()`` method surfaces the operands — we pull
    the right-hand value out to look up items. This mirrors the internal
    structure just enough for the tests without instantiating real
    DynamoDB.
    """
    table = MagicMock()

    def _side_effect(**kwargs):
        cond = kwargs['KeyConditionExpression']
        expression = cond.get_expression()
        # expression is {'format': '{0} {operator} {1}', 'operator': '=',
        #                'values': [Attr, literal]}
        values = expression.get('values', [])
        value = values[1] if len(values) > 1 else ''
        items = per_key_items.get(value, [])
        return {'Items': items}

    table.query.side_effect = _side_effect
    return table


class TestQueryLatestPerKey:
    def test_returns_empty_dict_for_empty_input(self) -> None:
        table = MagicMock()
        assert dynamodb_batch.query_latest_per_key(table, 'pk', []) == {}
        # No queries fired when input is empty.
        table.query.assert_not_called()

    def test_returns_empty_dict_for_falsy_values(self) -> None:
        table = MagicMock()
        assert dynamodb_batch.query_latest_per_key(table, 'pk', ['', None]) == {}
        table.query.assert_not_called()

    def test_collapses_duplicate_partition_values(self) -> None:
        """A caller may pass the same URL twice — we should query once."""
        table = _fake_table_with_items({'u1': [{'crawled_at': '2026-01-01'}]})
        dynamodb_batch.query_latest_per_key(table, 'pk', ['u1', 'u1', 'u1'])
        assert table.query.call_count == 1

    def test_returns_none_when_query_raises(self) -> None:
        """A single partition's failure must not break the whole batch."""
        table = MagicMock()
        table.query.side_effect = QueryFailure('throttled')
        result = dynamodb_batch.query_latest_per_key(table, 'pk', ['u1'])
        assert result == {'u1': None}

    def test_query_uses_scan_index_forward_false_for_latest_first(self) -> None:
        """Contract: latest sort-key row must be returned first."""
        table = _fake_table_with_items({'u1': [{'x': 1}]})
        dynamodb_batch.query_latest_per_key(table, 'pk', ['u1'])
        _, kwargs = table.query.call_args
        assert kwargs['ScanIndexForward'] is False
        assert kwargs['Limit'] == 1

    def test_returns_none_when_partition_has_no_rows(self) -> None:
        table = _fake_table_with_items({'u1': []})
        result = dynamodb_batch.query_latest_per_key(table, 'pk', ['u1'])
        assert result == {'u1': None}

    def test_fetches_all_unique_partition_values(self) -> None:
        table = _fake_table_with_items({
            'u1': [{'id': 1}],
            'u2': [{'id': 2}],
            'u3': [{'id': 3}],
        })
        result = dynamodb_batch.query_latest_per_key(table, 'pk', ['u1', 'u2', 'u3'])
        assert set(result.keys()) == {'u1', 'u2', 'u3'}
        assert result['u1'] == {'id': 1}
        assert result['u2'] == {'id': 2}
        assert result['u3'] == {'id': 3}


class TestCollectAllItems:
    def test_returns_the_items_of_a_single_page(self) -> None:
        operation = MagicMock(return_value={'Items': [{'id': 1}, {'id': 2}]})

        assert dynamodb_batch.collect_all_items(operation) == [{'id': 1}, {'id': 2}]

    def test_concatenates_pages_in_order_until_one_has_no_last_evaluated_key(self) -> None:
        operation = MagicMock(side_effect=[
            {'Items': [{'id': 1}], 'LastEvaluatedKey': {'id': 1}},
            {'Items': [{'id': 2}], 'LastEvaluatedKey': {'id': 2}},
            {'Items': [{'id': 3}]},
        ])

        assert dynamodb_batch.collect_all_items(operation) == [{'id': 1}, {'id': 2}, {'id': 3}]

    def test_passes_each_pages_last_evaluated_key_as_the_next_exclusive_start_key(self) -> None:
        operation = MagicMock(side_effect=[
            {'Items': [], 'LastEvaluatedKey': {'id': 1}},
            {'Items': []},
        ])

        dynamodb_batch.collect_all_items(operation, IndexName='StatusIndex')

        assert [call.kwargs for call in operation.call_args_list] == [
            {'IndexName': 'StatusIndex'},
            {'IndexName': 'StatusIndex', 'ExclusiveStartKey': {'id': 1}},
        ]

    def test_repeats_the_key_condition_on_every_follow_up_page_request(self) -> None:
        operation = MagicMock(side_effect=[
            {
                'Items': [{'id': 'first'}],
                'LastEvaluatedKey': {'pk': 'first'},
            },
            {'Items': [{'id': 'second'}]},
        ])

        result = dynamodb_batch.collect_all_items(
            operation,
            KeyConditionExpression='pk = value',
        )

        assert result == [{'id': 'first'}, {'id': 'second'}]
        assert operation.call_args_list == [
            call(KeyConditionExpression='pk = value'),
            call(
                KeyConditionExpression='pk = value',
                ExclusiveStartKey={'pk': 'first'},
            ),
        ]

    def test_returns_empty_list_when_the_page_has_no_items_key(self) -> None:
        operation = MagicMock(return_value={})

        assert dynamodb_batch.collect_all_items(operation) == []
