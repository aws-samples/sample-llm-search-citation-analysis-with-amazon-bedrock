"""
The paged lists of ``GET /api/alerts`` and ``GET /api/alerts/content-changes`` (2.45.0 wave 5).

- KPI alerts: newest first over the ``StatusCreatedIndex`` partitions of the
  statuses asked (``open``, ``acknowledged`` or both, merged by
  ``shared.merged_pages``), ``limit`` a page, ``next_token`` for the next.
- Content-change markers of one group: newest first over its partition
  (``shared.partition_pages`` start keys).

``total`` counts every item of the list (a ``Select=COUNT`` read of the
partitions, keys only); ``total_approximate`` says the count stopped at
``COUNT_MAX_PAGES`` pages.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from boto3.dynamodb.conditions import Key

from shared.cursors import encode_cursor
from shared.merged_pages import MergeSpec, decode_positions, merged_page, query_reader
from shared.partition_pages import decode_key

#: The index the alerts are listed through.
ALERTS_INDEX = 'StatusCreatedIndex'
#: The key of an alert in that index (table key, then the index's partition and sort keys).
ALERT_KEY = ('id', 'status', 'created_at')
#: The key of a content-change marker.
CHANGE_KEY = ('group_id', 'changed_at')
#: ``Select=COUNT`` pages a total reads at most (each reads up to 1 MB of keys).
COUNT_MAX_PAGES = 20


class BadCursorError(ValueError):
    """The ``next_token`` is not a position of this list."""


@dataclass(frozen=True)
class ListPage:
    items: list[dict[str, Any]]
    next_token: str | None
    total: int
    total_approximate: bool


def alert_spec(statuses: Sequence[str]) -> MergeSpec:
    """How the alerts of ``statuses`` merge into one newest-first list."""
    return MergeSpec(
        partitions=tuple(statuses), key_names=ALERT_KEY,
        sort_key=lambda item: (str(item.get('created_at', '')), str(item.get('id', ''))),
        identity=lambda item: item.get('id') if isinstance(item.get('id'), str) else None,
    )


def count_query(table: Any, **query: Any) -> tuple[int, bool]:
    """How many items ``query`` matches (keys only) and whether ``COUNT_MAX_PAGES`` stopped the count."""
    params: dict[str, Any] = {**query, 'Select': 'COUNT'}
    total = 0
    for _ in range(COUNT_MAX_PAGES):
        response = table.query(**params)
        total += int(response.get('Count') or 0)
        start = response.get('LastEvaluatedKey')
        if not start:
            return total, False
        params['ExclusiveStartKey'] = start
    return total, True


def alerts_page(table: Any, statuses: Sequence[str], limit: int, token: str | None) -> ListPage:
    """One newest-first page of the alerts of ``statuses`` after ``token`` (``BadCursorError`` for a token of another list)."""
    spec = alert_spec(statuses)
    positions = decode_positions(token, spec)
    if positions is None:
        raise BadCursorError(token)
    page = merged_page(query_reader(table, index_name=ALERTS_INDEX, partition_attribute='status'), spec, positions, limit)
    counts = [count_query(table, IndexName=ALERTS_INDEX, KeyConditionExpression=Key('status').eq(status)) for status in statuses]
    return ListPage(page.items, page.next_token, sum(count for count, _cut in counts), any(cut for _count, cut in counts))


def content_changes_page(table: Any, group_id: str, limit: int, token: str | None) -> ListPage:
    """One newest-first page of ``group_id``'s content-change markers after ``token``."""
    query: dict[str, Any] = {'KeyConditionExpression': Key('group_id').eq(group_id)}
    params: dict[str, Any] = {**query, 'ScanIndexForward': False, 'Limit': limit}
    if token is not None:
        start = decode_key(token, CHANGE_KEY)
        if start is None or start.get('group_id') != group_id:
            raise BadCursorError(token)
        params['ExclusiveStartKey'] = start
    response = table.query(**params)
    total, approximate = count_query(table, **query)
    following = response.get('LastEvaluatedKey')
    return ListPage(list(response.get('Items', [])), encode_cursor(following) if following else None, total, approximate)


__all__ = ['ALERTS_INDEX', 'COUNT_MAX_PAGES', 'BadCursorError', 'ListPage', 'alert_spec', 'alerts_page', 'content_changes_page', 'count_query']
