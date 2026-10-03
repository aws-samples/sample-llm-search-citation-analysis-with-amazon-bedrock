"""
Bounded DynamoDB reads: page-capped pagination and newest-first single pages.

``shared.dynamodb_batch.collect_all_items`` follows every page. The read
handlers here never do: ``/citations`` and ``/citations/url-breakdown`` stop
after a fixed number of 1 MB pages (and say whether they stopped early so the
caller can log the truncation), and ``/searches`` / ``/crawled-content`` read
one newest-first page of a partition.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from boto3.dynamodb.conditions import Key


def collect_capped_items(
    operation: Callable[..., Mapping[str, Any]], max_pages: int, **params: Any,
) -> tuple[list[dict[str, Any]], bool]:
    """The items of at most ``max_pages`` pages of ``operation`` (a table's ``query`` or ``scan``).

    Each page's ``LastEvaluatedKey`` becomes the next call's
    ``ExclusiveStartKey``. Returns ``(items, truncated)``: ``truncated`` is
    true when the last page read still had a ``LastEvaluatedKey``, i.e. the
    cap cut the read short.
    """
    items: list[dict[str, Any]] = []
    for _page in range(max_pages):
        response = operation(**params)
        items.extend(response.get('Items', []))
        last_key = response.get('LastEvaluatedKey')
        if not last_key:
            return items, False
        params['ExclusiveStartKey'] = last_key
    return items, True


def _partition_query(key_name: str, value: str, index_name: str | None) -> dict[str, Any]:
    """The ``query`` arguments selecting the partition ``key_name = value`` of the table or its GSI ``index_name``."""
    params: dict[str, Any] = {'KeyConditionExpression': Key(key_name).eq(value)}
    if index_name is not None:
        params['IndexName'] = index_name
    return params


def collect_capped_partition(
    table: Any, key_name: str, value: str, max_pages: int, *, index_name: str | None = None,
) -> tuple[list[dict[str, Any]], bool]:
    """``collect_capped_items`` over the partition ``key_name = value`` (of the GSI ``index_name`` when given)."""
    return collect_capped_items(table.query, max_pages, **_partition_query(key_name, value, index_name))


def newest_items(table: Any, key_name: str, value: str, limit: int, *, index_name: str | None = None) -> list[dict[str, Any]]:
    """The newest ``limit`` rows of the partition ``key_name = value`` (one page, sort key descending).

    ``index_name`` reads a GSI partition instead of the table's own.
    """
    params = _partition_query(key_name, value, index_name)
    return table.query(**params, ScanIndexForward=False, Limit=limit).get('Items', [])
