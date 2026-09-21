"""
DynamoDB read helpers: exact-key batch reads, latest-per-key queries, and pages.

Several handlers need either exact primary-key rows through ``BatchGetItem`` or
the latest-by-sort-key row for each of N primary keys. This module centralizes
those patterns, including DynamoDB's required retry loop for unprocessed batch
keys, so callers do not implement subtly different completeness semantics.

Usage:

    from shared.dynamodb_batch import batch_get_items, collect_all_items, query_latest_per_key

    items = batch_get_items(
        dynamodb_resource,
        'ExampleTable',
        [{'id': 'one'}, {'id': 'two'}],
        consistent_read=True,
    )

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
import time
from collections.abc import Callable, Iterable, Mapping
from typing import Any

from boto3.dynamodb.conditions import Key

logger = logging.getLogger(__name__)

# Default concurrency. Keep well under DynamoDB's per-partition limits
# (3000 read units, 1000 write units at 1 RCU each for strongly-consistent
# reads). 10 workers x O(1 query per worker) is safe for any table.
_DEFAULT_MAX_WORKERS = 10
_BATCH_GET_MAX_ATTEMPTS = 3
_BATCH_GET_BASE_DELAY_SECONDS = 0.05


class BatchGetUnprocessedError(RuntimeError):
    """DynamoDB still had unprocessed keys after the bounded retry budget."""


def batch_get_items(
    resource: Any,
    table_name: str,
    keys: list[dict[str, Any]],
    *,
    consistent_read: bool = False,
    max_attempts: int = _BATCH_GET_MAX_ATTEMPTS,
    base_delay_seconds: float = _BATCH_GET_BASE_DELAY_SECONDS,
) -> list[dict[str, Any]]:
    """Fetch exact keys and retry only the keys DynamoDB leaves unprocessed.

    ``BatchGetItem`` does not preserve request order, so callers that need a
    stable order must join the returned rows back to their requested keys. A
    response with missing rows is valid; exhausting retries with unprocessed
    keys is not, because those keys are unknown rather than absent.
    """
    if not keys:
        return []
    if max_attempts < 1:
        raise ValueError("max_attempts must be at least 1")

    request: dict[str, Any] = {"Keys": keys}
    if consistent_read:
        request["ConsistentRead"] = True
    items: list[dict[str, Any]] = []

    for attempt in range(max_attempts):
        response = resource.batch_get_item(RequestItems={table_name: request})
        items.extend(response.get("Responses", {}).get(table_name, []))
        unprocessed = response.get("UnprocessedKeys", {}).get(table_name, {})
        unprocessed_keys = unprocessed.get("Keys", [])
        if not unprocessed_keys:
            return items
        if attempt + 1 == max_attempts:
            raise BatchGetUnprocessedError(f"{len(unprocessed_keys)} keys remained unprocessed for {table_name}")
        time.sleep(base_delay_seconds * (2**attempt))
        request = {**unprocessed, "Keys": unprocessed_keys}
        if consistent_read:
            request["ConsistentRead"] = True

    return items


def collect_all_items(operation: Callable[..., Mapping[str, Any]], **params: Any) -> list[dict[str, Any]]:
    """Every item a table's ``query`` or ``scan`` returns, following pagination.

    DynamoDB pages at 1 MB: each page's ``LastEvaluatedKey`` becomes the next
    call's ``ExclusiveStartKey`` until a page arrives without one. ``params``
    are the keyword arguments of ``operation`` and are not mutated.
    """
    items: list[dict[str, Any]] = []
    while True:
        response = operation(**params)
        items.extend(response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            return items
        params["ExclusiveStartKey"] = last_key


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
