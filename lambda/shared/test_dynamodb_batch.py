"""
Tests for shared.dynamodb_batch.

``query_latest_per_key`` collapses duplicate keys, preserves first-seen order,
uses a bounded executor, projects only caller-requested attributes, and treats
one failed partition as missing without discarding successful partitions.

``collect_all_items`` concatenates pages in order and feeds each page's
``LastEvaluatedKey`` into the next request.
"""

from __future__ import annotations

from unittest.mock import MagicMock, call, patch

from shared import dynamodb_batch


class QueryFailure(Exception):
    """Expected query failure raised by the test double."""


def _fake_table_with_items(per_key_items: dict[str, list[dict]]) -> MagicMock:
    """Build a table whose query returns rows for the condition's key value."""
    table = MagicMock()

    def _side_effect(**kwargs):
        condition = kwargs['KeyConditionExpression']
        expression = condition.get_expression()
        values = expression.get('values', [])
        value = values[1] if len(values) > 1 else ''
        return {'Items': per_key_items.get(value, [])}

    table.query.side_effect = _side_effect
    return table


class TestQueryLatestPerKey:
    def test_returns_empty_dict_when_no_partition_values_are_requested(self) -> None:
        table = MagicMock()

        result = dynamodb_batch.query_latest_per_key(table, 'pk', [])

        assert result == {}
        table.query.assert_not_called()

    def test_returns_empty_dict_when_every_partition_value_is_falsy(self) -> None:
        table = MagicMock()

        result = dynamodb_batch.query_latest_per_key(table, 'pk', ['', None])

        assert result == {}
        table.query.assert_not_called()

    def test_queries_duplicate_partition_values_once(self) -> None:
        table = _fake_table_with_items({'u1': [{'crawled_at': '2026-01-01'}]})

        dynamodb_batch.query_latest_per_key(table, 'pk', ['u1', 'u1', 'u1'])

        assert table.query.call_count == 1

    def test_returns_none_when_a_partition_query_fails(self) -> None:
        table = MagicMock()
        table.query.side_effect = QueryFailure('throttled')

        result = dynamodb_batch.query_latest_per_key(table, 'pk', ['u1'])

        assert result == {'u1': None}

    def test_keeps_successful_rows_when_another_partition_query_fails(self) -> None:
        table = MagicMock()
        table.query.side_effect = [
            {'Items': [{'id': 'one'}]},
            QueryFailure('throttled'),
            {'Items': [{'id': 'three'}]},
        ]

        result = dynamodb_batch.query_latest_per_key(
            table,
            'pk',
            ['u1', 'u2', 'u3'],
            max_workers=1,
        )

        assert result == {
            'u1': {'id': 'one'},
            'u2': None,
            'u3': {'id': 'three'},
        }

    def test_requests_latest_row_when_a_partition_is_queried(self) -> None:
        table = _fake_table_with_items({'u1': [{'x': 1}]})

        dynamodb_batch.query_latest_per_key(table, 'pk', ['u1'])

        kwargs = table.query.call_args.kwargs
        assert kwargs['ScanIndexForward'] is False
        assert kwargs['Limit'] == 1

    def test_forwards_projection_fields_when_the_caller_restricts_attributes(self) -> None:
        table = _fake_table_with_items({'u1': [{'title': 'One'}]})

        dynamodb_batch.query_latest_per_key(
            table,
            'pk',
            ['u1'],
            projection_expression='#title, crawled_at',
            expression_attribute_names={'#title': 'title'},
        )

        kwargs = table.query.call_args.kwargs
        assert {
            'ProjectionExpression': kwargs['ProjectionExpression'],
            'ExpressionAttributeNames': kwargs['ExpressionAttributeNames'],
        } == {
            'ProjectionExpression': '#title, crawled_at',
            'ExpressionAttributeNames': {'#title': 'title'},
        }

    def test_bounds_concurrent_queries_at_ten_when_more_keys_are_requested(self) -> None:
        urls = [f'u{index}' for index in range(25)]
        table = _fake_table_with_items({url: [{'id': url}] for url in urls})
        executor = MagicMock()
        executor.__enter__.return_value.map.side_effect = lambda operation, values: map(operation, values)

        with patch.object(
            dynamodb_batch.concurrent.futures,
            'ThreadPoolExecutor',
            return_value=executor,
        ) as executor_constructor:
            result = dynamodb_batch.query_latest_per_key(table, 'pk', urls)

        executor_constructor.assert_called_once_with(max_workers=10)
        assert list(result) == urls

    def test_returns_none_when_partition_has_no_rows(self) -> None:
        table = _fake_table_with_items({'u1': []})

        result = dynamodb_batch.query_latest_per_key(table, 'pk', ['u1'])

        assert result == {'u1': None}

    def test_preserves_first_seen_order_when_fetching_unique_partition_values(self) -> None:
        table = _fake_table_with_items({
            'u1': [{'id': 1}],
            'u2': [{'id': 2}],
            'u3': [{'id': 3}],
        })

        result = dynamodb_batch.query_latest_per_key(table, 'pk', ['u2', 'u1', 'u2', 'u3'])

        assert list(result) == ['u2', 'u1', 'u3']
        assert list(result.values()) == [{'id': 2}, {'id': 1}, {'id': 3}]


class TestCollectAllItems:
    def test_returns_items_when_operation_has_one_page(self) -> None:
        operation = MagicMock(return_value={'Items': [{'id': 1}, {'id': 2}]})

        result = dynamodb_batch.collect_all_items(operation)

        assert result == [{'id': 1}, {'id': 2}]

    def test_concatenates_pages_in_order_until_last_key_is_absent(self) -> None:
        operation = MagicMock(side_effect=[
            {'Items': [{'id': 1}], 'LastEvaluatedKey': {'id': 1}},
            {'Items': [{'id': 2}], 'LastEvaluatedKey': {'id': 2}},
            {'Items': [{'id': 3}]},
        ])

        result = dynamodb_batch.collect_all_items(operation)

        assert result == [{'id': 1}, {'id': 2}, {'id': 3}]

    def test_passes_each_last_key_to_the_next_page_request(self) -> None:
        operation = MagicMock(side_effect=[
            {'Items': [], 'LastEvaluatedKey': {'id': 1}},
            {'Items': []},
        ])

        dynamodb_batch.collect_all_items(operation, IndexName='StatusIndex')

        assert [page_call.kwargs for page_call in operation.call_args_list] == [
            {'IndexName': 'StatusIndex'},
            {'IndexName': 'StatusIndex', 'ExclusiveStartKey': {'id': 1}},
        ]

    def test_repeats_key_condition_on_every_follow_up_page_request(self) -> None:
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

    def test_returns_empty_list_when_page_has_no_items_key(self) -> None:
        operation = MagicMock(return_value={})

        result = dynamodb_batch.collect_all_items(operation)

        assert result == []
