"""
DynamoDB parallel-query helpers.

Several handlers need the latest-by-sort-key row for each of N primary
keys — a pattern DynamoDB's `BatchGetItem` can't express because it
requires the exact composite key, not "latest per partition". The
alternative is N concurrent `Query` calls with a bounded thread pool.

This module centralizes that pattern so callers don't spawn their own
executors (audit item 16).

Usage:

    from shared.dynamodb_batch import query_latest_per_key

    results = query_latest_per_key(
        table=my_table,
        partition_key_name='normalized_url',
        partition_values=list_of_urls,
        max_workers=10,
    )
    # results: dict[str, dict | None] — maps each partition value to the
    # latest item (or None if no rows).
"""

from __future__ import annotations

import concurrent.futures
import logging
from collections.abc import Iterable
from typing import Any

from boto3.dynamodb.conditions import Key

logger = logging.getLogger(__name__)

# Default concurrency. Keep well under DynamoDB's per-partition limits
# (3000 read units, 1000 write units at 1 RCU each for strongly-consistent
# reads). 10 workers x O(1 query per worker) is safe for any table.
_DEFAULT_MAX_WORKERS = 10


def query_latest_per_key(
    table: Any,
    partition_key_name: str,
    partition_values: Iterable[str],
    *,
    max_workers: int = _DEFAULT_MAX_WORKERS,
    limit: int = 1,
) -> dict[str, dict | None]:
    """Fetch the latest item for each partition-key value in parallel.

    ``DynamoDB.Table.query`` with ``ScanIndexForward=False`` returns items
    in descending sort-key order; paired with ``Limit=1`` it gives the
    latest row for that partition. Calls fan out through a thread pool so
    wall-clock time stays ~constant regardless of the number of keys
    (up to the executor's max workers).

    Args:
        table: boto3 DynamoDB Table resource.
        partition_key_name: Name of the table's partition key attribute.
        partition_values: Iterable of values to query. Duplicates are
            collapsed; order is preserved. Falsy values (``None``,
            ``""``) are dropped before the fan-out — callers that
            want them surfaced as errors should filter upstream.
        max_workers: Upper bound on concurrent queries. Default 10.
        limit: Items to return per partition (kept as ``limit`` to keep the
            door open for top-N variants later; keep at 1 for the
            "latest row" semantics).

    Returns:
        Dict mapping each partition value to the latest item found, or
        None if the partition had no rows / the query raised. Errors are
        logged, not raised — a single bad partition must not fail the
        whole request.
    """
    # Preserve order, drop duplicates.
    seen: set[str] = set()
    ordered_values: list[str] = []
    for v in partition_values:
        if v and v not in seen:
            seen.add(v)
            ordered_values.append(v)

    if not ordered_values:
        return {}

    def _query_one(value: str) -> tuple[str, dict | None]:
        try:
            response = table.query(
                KeyConditionExpression=Key(partition_key_name).eq(value),
                Limit=limit,
                ScanIndexForward=False,
            )
            items = response.get('Items', [])
            return value, (items[0] if items else None)
        except Exception as e:
            logger.error(
                "query_latest_per_key failed for %s=%r: %s",
                partition_key_name, value, e,
            )
            return value, None

    workers = min(max_workers, len(ordered_values))
    results: dict[str, dict | None] = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        for value, item in pool.map(_query_one, ordered_values):
            results[value] = item

    return results



def collect_all_items(operation: Any, **params: Any) -> list[dict[str, Any]]:
    """Call a paginated DynamoDB query/scan operation through every page."""
    items: list[dict[str, Any]] = []
    request = dict(params)
    while True:
        response = operation(**request)
        items.extend(response.get('Items', []))
        last_key = response.get('LastEvaluatedKey')
        if not last_key:
            return items
        request['ExclusiveStartKey'] = last_key
