"""
Item counts that finish inside an API request.

A ``Select='COUNT'`` scan or query returns no items but still reads every one
of them, 1 MB per page: counting a SearchResults table that holds tens of GB
of answer text takes minutes, far past API Gateway's 29 s. The dashboard
totals therefore count in one of two ways:

- ``table_count``: a table small enough (per ``DescribeTable``'s
  ``TableSizeBytes``) is counted exactly; a larger one reports
  ``DescribeTable``'s ``ItemCount``, which DynamoDB refreshes about every six
  hours. Fresh installs and demos keep exact numbers; a large tenant gets a
  bounded, slightly stale one.
- ``partition_count``: the rows of a set of partitions (one market's keyword
  texts), counted in parallel until a ``Deadline``; partitions the deadline
  cut short are estimated from the ones that finished.

Either way the result says whether it is ``approximate``, so the response can
tell the reader instead of passing an estimate off as an exact count.
"""

from __future__ import annotations

import concurrent.futures
import time
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from boto3.dynamodb.conditions import Key

#: Tables up to this size are counted exactly (about 64 one-MB pages, a few seconds).
EXACT_COUNT_MAX_BYTES = 64 * 1024 * 1024

#: How long the counts of one request may read, in seconds, before estimating the rest.
COUNT_TIME_BUDGET_SECONDS = 8.0

#: Partitions counted at a time.
PARTITION_COUNT_WORKERS = 10


@dataclass(frozen=True)
class Count:
    """An item count, and whether it is an estimate rather than an exact count."""

    value: int
    approximate: bool = False


class Deadline:
    """A point in time after which counting stops reading further pages."""

    def __init__(self, seconds: float, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._ends_at = clock() + seconds

    def expired(self) -> bool:
        return self._clock() >= self._ends_at


def count_pages(operation: Callable[..., Mapping[str, Any]], deadline: Deadline, **params: Any) -> tuple[int, bool]:
    """``Select='COUNT'`` pages of ``operation`` summed until done or ``deadline``: ``(count, complete)``.

    The first page is always read, so a count always makes progress.
    """
    response = operation(**params, Select='COUNT')
    count = response.get('Count', 0)
    while 'LastEvaluatedKey' in response:
        if deadline.expired():
            return count, False
        response = operation(**params, Select='COUNT', ExclusiveStartKey=response['LastEvaluatedKey'])
        count += response.get('Count', 0)
    return count, True


def _described(table: Any) -> Mapping[str, Any]:
    """The table's current ``DescribeTable`` (the resource's cached attributes would never refresh)."""
    return table.meta.client.describe_table(TableName=table.table_name)['Table']


def table_count(table: Any, deadline: Deadline, *, exact_max_bytes: int = EXACT_COUNT_MAX_BYTES) -> Count:
    """How many items ``table`` holds: exact when it is small, ``DescribeTable``'s ``ItemCount`` otherwise.

    A small table whose exact count the deadline cuts short reports the larger
    of the partial count and ``ItemCount``, as an estimate.
    """
    description = _described(table)
    item_count = int(description.get('ItemCount', 0) or 0)
    if int(description.get('TableSizeBytes', 0) or 0) > exact_max_bytes:
        return Count(item_count, approximate=True)
    counted, complete = count_pages(table.scan, deadline)
    if complete:
        return Count(counted)
    return Count(max(counted, item_count), approximate=True)


def _estimated_total(results: list[tuple[int, bool] | None]) -> Count:
    """The sum of every partition's count, the unfinished ones estimated from the finished ones' mean."""
    finished = [result[0] for result in results if result is not None and result[1]]
    unfinished = [0 if result is None else result[0] for result in results if result is None or not result[1]]
    if not unfinished:
        return Count(sum(finished))
    mean = round(sum(finished) / len(finished)) if finished else 0
    return Count(sum(finished) + sum(max(partial, mean) for partial in unfinished), approximate=True)


def partition_count(
    table: Any,
    partition_key_name: str,
    partition_values: Iterable[str],
    deadline: Deadline,
    *,
    index_name: str | None = None,
    max_workers: int = PARTITION_COUNT_WORKERS,
) -> Count:
    """How many items of ``table`` (or its ``index_name``) carry one of ``partition_values`` as partition key.

    One count per distinct value, ``max_workers`` at a time; a partition not
    started before ``deadline`` is not read. When any partition is unfinished
    the total is an estimate: each unfinished partition counts as the larger
    of what was read of it and the finished partitions' mean. A failed read
    propagates, because a partial sum would read as a real count.
    """
    values = sorted(set(partition_values))
    index = {'IndexName': index_name} if index_name else {}

    def count_one(value: str) -> tuple[int, bool] | None:
        if deadline.expired():
            return None
        return count_pages(table.query, deadline, **index, KeyConditionExpression=Key(partition_key_name).eq(value))

    if not values:
        return Count(0)
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(max_workers, len(values))) as pool:
        return _estimated_total(list(pool.map(count_one, values)))


__all__ = [
    'COUNT_TIME_BUDGET_SECONDS',
    'EXACT_COUNT_MAX_BYTES',
    'PARTITION_COUNT_WORKERS',
    'Count',
    'Deadline',
    'count_pages',
    'partition_count',
    'table_count',
]
