"""
Tests for shared.dynamodb_batch.

``batch_get_items`` — the exact-key semantics manifest callers depend on:
- Empty input short-circuits
- Unprocessed keys are retried with bounded exponential backoff
- Processed rows are retained across retries
- Exhausted unprocessed keys raise instead of looking absent

``query_latest_per_key`` collapses duplicate keys, preserves first-seen order,
uses a bounded executor, projects only caller-requested attributes, and treats
one failed partition as missing without discarding successful partitions.

``collect_all_items`` concatenates pages in order and feeds each page's
``LastEvaluatedKey`` into the next request; ``collect_capped_items`` does the
same for at most ``max_pages`` pages and reports whether the cap cut it short.

``count_all_items`` sums ``Select='COUNT'`` pages; ``count_partition_items``
sums one such count per distinct partition value and, unlike
``query_latest_per_key``, lets a failed partition raise.
"""

from __future__ import annotations

import functools
from unittest.mock import MagicMock, call, patch

import pytest

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


def _consistent_get(*ids: str) -> dict:
    """The ``RequestItems`` of a strongly consistent ``batch_get_item`` for these ``id`` keys."""
    return {"table": {"Keys": [{"id": key} for key in ids], "ConsistentRead": True}}


def _consistent_get_one_and_two(resource: MagicMock) -> list[dict]:
    """Strongly consistent ``batch_get_items`` of keys ``one`` and ``two`` from ``table``."""
    return dynamodb_batch.batch_get_items(resource, "table", [{"id": "one"}, {"id": "two"}], consistent_read=True)


def _query_latest_for_u1(rows: list[dict], **options) -> tuple[MagicMock, dict]:
    """Query partition ``u1`` (holding ``rows``) and return the table stub with the result."""
    table = _fake_table_with_items({'u1': rows})
    return table, dynamodb_batch.query_latest_per_key(table, 'pk', ['u1'], **options)


def _paged_operation(*pages: tuple[list[dict], dict | None]) -> MagicMock:
    """A query/scan stub answering ``(items, last_evaluated_key)`` pages in turn; ``None`` ends paging."""
    responses = [
        {'Items': items} if last_key is None else {'Items': items, 'LastEvaluatedKey': last_key}
        for items, last_key in pages
    ]
    return MagicMock(side_effect=responses)


class TestBatchGetItems:
    def test_returns_empty_list_when_no_keys_requested(self) -> None:
        resource = MagicMock()

        result = dynamodb_batch.batch_get_items(resource, "table", [])

        assert result == []
        resource.batch_get_item.assert_not_called()

    def test_returns_processed_rows_when_no_keys_are_unprocessed(self) -> None:
        resource = MagicMock()
        resource.batch_get_item.return_value = {
            "Responses": {"table": [{"id": "two"}, {"id": "one"}]},
        }

        result = _consistent_get_one_and_two(resource)

        assert result == [{"id": "two"}, {"id": "one"}]
        resource.batch_get_item.assert_called_once_with(RequestItems=_consistent_get("one", "two"))

    def test_returns_all_rows_when_unprocessed_keys_succeed_on_retry(self) -> None:
        resource = MagicMock()
        resource.batch_get_item.side_effect = [
            {
                "Responses": {"table": [{"id": "one"}]},
                "UnprocessedKeys": {
                    "table": {"Keys": [{"id": "two"}]},
                },
            },
            {"Responses": {"table": [{"id": "two"}]}},
        ]

        with patch.object(dynamodb_batch.time, "sleep") as sleep:
            result = _consistent_get_one_and_two(resource)

        assert result == [{"id": "one"}, {"id": "two"}]
        assert resource.batch_get_item.call_args_list == [
            call(RequestItems=_consistent_get("one", "two")),
            call(RequestItems=_consistent_get("two")),
        ]
        sleep.assert_called_once_with(0.05)

    def test_raises_batch_get_error_when_unprocessed_keys_exhaust_retries(self) -> None:
        resource = MagicMock()
        resource.batch_get_item.return_value = {
            "UnprocessedKeys": {"table": {"Keys": [{"id": "one"}]}},
        }

        with (
            patch.object(dynamodb_batch.time, "sleep"),
            pytest.raises(
                dynamodb_batch.BatchGetUnprocessedError,
                match="1 keys remained unprocessed for table",
            ),
        ):
            dynamodb_batch.batch_get_items(
                resource,
                "table",
                [{"id": "one"}],
                max_attempts=2,
            )

        assert resource.batch_get_item.call_count == 2


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
        table, _result = _query_latest_for_u1([{'x': 1}])

        kwargs = table.query.call_args.kwargs
        assert kwargs['ScanIndexForward'] is False
        assert kwargs['Limit'] == 1

    def test_forwards_projection_fields_when_the_caller_restricts_attributes(self) -> None:
        table, _result = _query_latest_for_u1(
            [{'title': 'One'}],
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
        executor.__enter__.return_value.map.side_effect = map

        with patch.object(
            dynamodb_batch.concurrent.futures,
            'ThreadPoolExecutor',
            return_value=executor,
        ) as executor_constructor:
            result = dynamodb_batch.query_latest_per_key(table, 'pk', urls)

        executor_constructor.assert_called_once_with(max_workers=10)
        assert list(result) == urls

    def test_returns_none_when_partition_has_no_rows(self) -> None:
        _table, result = _query_latest_for_u1([])

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
    @pytest.mark.parametrize(
        ('pages', 'expected'),
        [
            pytest.param([{'Items': [{'id': 1}, {'id': 2}]}], [{'id': 1}, {'id': 2}], id='one_page'),
            pytest.param(
                [
                    {'Items': [{'id': 1}], 'LastEvaluatedKey': {'id': 1}},
                    {'Items': [{'id': 2}], 'LastEvaluatedKey': {'id': 2}},
                    {'Items': [{'id': 3}]},
                ],
                [{'id': 1}, {'id': 2}, {'id': 3}],
                id='pages_concatenated_in_order_until_last_key_is_absent',
            ),
            pytest.param([{}], [], id='page_without_items_key_is_empty'),
        ],
    )
    def test_returns_the_items_of_every_page_in_order(self, pages: list[dict], expected: list[dict]) -> None:
        operation = MagicMock(side_effect=pages)

        assert dynamodb_batch.collect_all_items(operation) == expected

    @pytest.mark.parametrize('collect', [
        pytest.param(dynamodb_batch.collect_all_items, id='every-page'),
        pytest.param(functools.partial(dynamodb_batch.collect_capped_items, max_pages=5), id='page-capped'),
    ])
    def test_passes_each_last_key_to_the_next_page_request(self, collect) -> None:
        operation = _paged_operation(([], {'id': 1}), ([], None))

        collect(operation, IndexName="StatusIndex")

        assert [page_call.kwargs for page_call in operation.call_args_list] == [
            {'IndexName': 'StatusIndex'},
            {'IndexName': 'StatusIndex', 'ExclusiveStartKey': {'id': 1}},
        ]

    def test_repeats_key_condition_on_every_follow_up_page_request(self) -> None:
        operation = _paged_operation(([{'id': 'first'}], {'pk': 'first'}), ([{'id': 'second'}], None))

        result = dynamodb_batch.collect_all_items(
            operation,
            KeyConditionExpression="pk = value",
        )

        assert result == [{"id": "first"}, {"id": "second"}]
        assert operation.call_args_list == [
            call(KeyConditionExpression="pk = value"),
            call(
                KeyConditionExpression="pk = value",
                ExclusiveStartKey={"pk": "first"},
            ),
        ]


class TestCollectCappedItems:
    @pytest.mark.parametrize('max_pages', [pytest.param(5, id='under-the-cap'), pytest.param(2, id='exactly-at-the-cap')])
    def test_concatenates_the_pages_until_one_has_no_last_evaluated_key(self, max_pages: int) -> None:
        operation = _paged_operation(([{'id': 1}], {'id': 1}), ([{'id': 2}], None))

        assert dynamodb_batch.collect_capped_items(operation, max_pages) == ([{'id': 1}, {'id': 2}], False)

    def test_stops_at_the_cap_and_reports_the_read_as_truncated(self) -> None:
        operation = MagicMock(return_value={'Items': [{'id': 'x'}], 'LastEvaluatedKey': {'id': 'x'}})

        items, truncated = dynamodb_batch.collect_capped_items(operation, 3)

        assert (operation.call_count, len(items), truncated) == (3, 3, True)

    def test_reads_a_page_without_items_as_empty(self) -> None:
        assert dynamodb_batch.collect_capped_items(MagicMock(side_effect=[{}]), 1) == ([], False)


def _counting_table(counts: dict[str, int]) -> MagicMock:
    """A table whose ``query`` answers ``Count = counts[partition value]`` (0 for any other value)."""
    table = MagicMock()
    table.query.side_effect = lambda **kwargs: {'Count': counts.get(kwargs['KeyConditionExpression'].get_expression()['values'][1], 0)}
    return table


class TestCountAllItems:
    def test_asks_for_a_count_only_read(self):
        operation = MagicMock(return_value={'Count': 4})

        assert dynamodb_batch.count_all_items(operation, IndexName='StatusIndex') == 4
        operation.assert_called_once_with(IndexName='StatusIndex', Select='COUNT')

    def test_sums_the_count_of_every_page(self):
        operation = MagicMock(side_effect=[{'Count': 2, 'LastEvaluatedKey': {'id': 'a'}}, {'Count': 0, 'LastEvaluatedKey': {'id': 'b'}}, {'Count': 5}])

        assert dynamodb_batch.count_all_items(operation) == 7

    def test_starts_each_page_after_the_previous_one(self):
        operation = MagicMock(side_effect=[{'Count': 2, 'LastEvaluatedKey': {'id': 'a'}}, {'Count': 5}])

        dynamodb_batch.count_all_items(operation)

        assert operation.call_args_list[1] == call(Select='COUNT', ExclusiveStartKey={'id': 'a'})

    def test_reads_a_missing_count_as_zero(self):
        assert dynamodb_batch.count_all_items(MagicMock(return_value={})) == 0


class TestCountPartitionItems:
    def test_sums_the_counts_of_the_given_partitions(self):
        table = _counting_table({'hotel a': 3, 'hotel b': 4, 'hotel c': 100})

        assert dynamodb_batch.count_partition_items(table, 'keyword', ['hotel a', 'hotel b']) == 7

    def test_counts_a_repeated_partition_once(self):
        table = _counting_table({'hotel a': 3})

        assert dynamodb_batch.count_partition_items(table, 'keyword', ['hotel a', 'hotel a']) == 3
        assert table.query.call_count == 1

    def test_queries_the_named_index_with_a_count_only_read(self):
        table = _counting_table({'hotel a': 3})

        dynamodb_batch.count_partition_items(table, 'keyword', ['hotel a'], index_name='KeywordIndex')

        kwargs = table.query.call_args.kwargs
        assert (kwargs['IndexName'], kwargs['Select']) == ('KeywordIndex', 'COUNT')

    def test_counts_nothing_without_partitions(self):
        table = _counting_table({})

        assert dynamodb_batch.count_partition_items(table, 'keyword', []) == 0
        table.query.assert_not_called()

    def test_raises_when_a_partition_cannot_be_counted(self):
        table = MagicMock()
        table.query.side_effect = QueryFailure('throttled')

        with pytest.raises(QueryFailure, match='throttled'):
            dynamodb_batch.count_partition_items(table, 'keyword', ['hotel a', 'hotel b'])

    def test_runs_at_most_max_workers_queries_at_a_time(self):
        table = _counting_table({})

        with patch.object(dynamodb_batch.concurrent.futures, 'ThreadPoolExecutor', wraps=dynamodb_batch.concurrent.futures.ThreadPoolExecutor) as executor:
            dynamodb_batch.count_partition_items(table, 'keyword', ['a', 'b', 'c'], max_workers=2)

        executor.assert_called_once_with(max_workers=2)
