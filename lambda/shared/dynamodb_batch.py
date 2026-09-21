"""
DynamoDB read helpers: parallel latest-per-key queries and page collection.

Several handlers need the latest-by-sort-key row for each of N primary
keys — a pattern DynamoDB's `BatchGetItem` can't express because it
requires the exact composite key, not "latest per partition". The
alternative is N concurrent `Query` calls with a bounded thread pool.

This module centralizes that pattern so callers don't spawn their own
executors (audit item 16), and the ``LastEvaluatedKey`` pagination loop
every full read of a table or index otherwise re-implements.

Usage:

    from shared.dynamodb_batch import collect_all_items, query_latest_per_key

    results = query_latest_per_key(
        table=my_table,
        partition_key_name='normalized_url',
        partition_values=list_of_urls,
        max_workers=10,
    )
    # results: dict[str, dict | None] — maps each partition value to the
    # latest item (or None if no rows).

    rows = collect_all_items(my_table.query, IndexName='StatusIndex', KeyConditionExpression=...)
"""

from __future__ import annotations

import concurrent.futures
import logging
from collections.abc import Callable, Iterable, Mapping
from typing import Any

from boto3.dynamodb.conditions import Key

logger = logging.getLogger(__name__)

# Default concurrency. Keep well under DynamoDB's per-partition limits
# (3000 read units, 1000 write units at 1 RCU each for strongly-consistent
# reads). 10 workers x O(1 query per worker) is safe for any table.
_DEFAULT_MAX_WORKERS = 10


def collect_all_items(operation: Callable[..., Mapping[str, Any]], **params: Any) -> list[dict[str, Any]]:
    """Every item a table's ``query`` or ``scan`` returns, following pagination.

    DynamoDB pages at 1 MB: each page's ``LastEvaluatedKey`` becomes the next
    call's ``ExclusiveStartKey`` until a page arrives without one. ``params``
    are the keyword arguments of ``operation`` and are not mutated.
    """
    items: list[dict[str, Any]] = []
    while True:
        response = operation(**params)
        items.extend(response.get('Items', []))
        last_key = response.get('LastEvaluatedKey')
        if not last_key:
            return items
        params['ExclusiveStartKey'] = last_key


def query_latest_per_key(
    table: Any,
    partition_key_name: str,
    partition_values: Iterable[str | None],
    *,
    max_workers: int = _DEFAULT_MAX_WORKERS,
    limit: int = 1,
    projection_expression: str | None = None,
    expression_attribute_names: Mapping[str, str] | None = None,
) -> dict[str, dict | None]:
    """Fetch the latest item for each partition-key value in parallel.

    ``DynamoDB.Table.query`` with ``ScanIndexForward=False`` returns items
    in descending sort-key order; paired with ``Limit=1`` it gives the
    latest row for that partition. Calls fan out through a thread pool so
    wall-clock time stays roughly constant regardless of the number of keys,
    up to ``max_workers``.

    Duplicate values are collapsed in first-seen order. Falsy values are
    omitted. Optional projection arguments are forwarded to every query so
    callers can avoid transferring attributes they do not consume. One
    partition failure is logged and represented by ``None`` without failing
    successful partitions.
    """
    seen: set[str] = set()
    ordered_values: list[str] = []
    for value in partition_values:
        if value and value not in seen:
            seen.add(value)
            ordered_values.append(value)

    if not ordered_values:
        return {}

    def _query_one(value: str) -> tuple[str, dict | None]:
        query_params: dict[str, Any] = {
            'KeyConditionExpression': Key(partition_key_name).eq(value),
            'Limit': limit,
            'ScanIndexForward': False,
        }
        if projection_expression is not None:
            query_params['ProjectionExpression'] = projection_expression
        if expression_attribute_names is not None:
            query_params['ExpressionAttributeNames'] = dict(expression_attribute_names)

        try:
            response = table.query(**query_params)
        except Exception:
            logger.exception(
                'query_latest_per_key failed for %s=%r',
                partition_key_name, value,
            )
            return value, None

        items = response.get('Items', [])
        return value, (items[0] if items else None)

    workers = min(max_workers, len(ordered_values))
    results: dict[str, dict | None] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for value, item in pool.map(_query_one, ordered_values):
            results[value] = item

    return results
