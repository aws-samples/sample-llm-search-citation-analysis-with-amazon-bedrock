"""
Budget-bounded, cursor-paginated reads of DynamoDB partitions.

``/searches`` and ``/crawled-content`` hand their rows out one page at a time:
a page is one newest-first ``query`` of a partition, cut to
``shared.response_budget.PAGE_BUDGET_BYTES`` with ``take_within_budget``, and
its ``next_token`` (``shared.cursors``) is the key of the last row the page
kept, so a cut never loses the rows after it.

``newest_merged_page`` does the same over several partitions at once (the
unfiltered ``/searches``, one ``ProviderIndex`` partition per provider): a
k-way merge, newest first, whose cursor keeps one start key per partition.
"""

from __future__ import annotations

import heapq
import logging
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

from boto3.dynamodb.conditions import Key

from shared.cursors import decode_cursor, encode_cursor
from shared.response_budget import take_within_budget

logger = logging.getLogger(__name__)

# How many partitions ``newest_merged_page`` reads at a time.
MERGE_MAX_WORKERS = 10

# A merged cursor marks a partition it has read to the end with this value.
DONE = 'done'

Row = dict[str, Any]
RowFilter = Callable[[Row], bool]


def projection_params(attributes: Sequence[str]) -> dict[str, Any]:
    """``query`` arguments projecting ``attributes``, every name aliased (several are reserved words)."""
    names = {f'#p{index}': name for index, name in enumerate(attributes)}
    return {'ProjectionExpression': ', '.join(names), 'ExpressionAttributeNames': names}


def row_key(row: Mapping[str, Any], key_attributes: Sequence[str]) -> dict[str, Any]:
    """The ``ExclusiveStartKey`` that resumes a query right after ``row``."""
    return {name: row[name] for name in key_attributes}


def decode_key(token: str, key_attributes: Sequence[str]) -> dict[str, Any] | None:
    """The start key a single-partition ``next_token`` carries; ``None`` when it is malformed."""
    decoded = decode_cursor(token, key_attributes)
    if decoded is None or not _is_key(decoded, key_attributes):
        return None
    return decoded


def _is_key(value: Any, key_attributes: Sequence[str]) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == set(key_attributes)
        and all(isinstance(part, str) and part for part in value.values())
    )


@dataclass(frozen=True)
class PartitionRead:
    """One newest-first query of the partition ``key_name = value`` (of ``index_name`` when given)."""

    key_name: str
    value: str
    limit: int
    index_name: str | None = None
    projection: Sequence[str] | None = None

    def query(self, table: Any, start_key: Mapping[str, Any] | None) -> tuple[list[Row], dict[str, Any] | None]:
        """One page: its rows and DynamoDB's ``LastEvaluatedKey`` (``None`` at the partition's end)."""
        params: dict[str, Any] = {
            'KeyConditionExpression': Key(self.key_name).eq(self.value),
            'ScanIndexForward': False,
            'Limit': self.limit,
        }
        if self.index_name is not None:
            params['IndexName'] = self.index_name
        if self.projection is not None:
            params.update(projection_params(self.projection))
        if start_key is not None:
            params['ExclusiveStartKey'] = dict(start_key)
        response = table.query(**params)
        return response.get('Items', []), response.get('LastEvaluatedKey')


def cut_page(
    rows: Sequence[Row], last_evaluated_key: Mapping[str, Any] | None, key_attributes: Sequence[str],
) -> tuple[list[Row], dict[str, Any] | None]:
    """``rows`` cut to the page budget, and the start key of the next page (``None`` at the end).

    A cut page resumes after its last row; a whole page resumes where DynamoDB
    stopped (rows a caller filtered out after the read are skipped for good).
    """
    page, truncated = take_within_budget(rows)
    if truncated:
        return page, row_key(page[-1], key_attributes)
    return page, dict(last_evaluated_key) if last_evaluated_key else None


def partition_page(
    table: Any,
    read: PartitionRead,
    key_attributes: Sequence[str],
    start_key: Mapping[str, Any] | None,
    keep: RowFilter | None = None,
) -> tuple[list[Row], str | None]:
    """One budget-bounded page of a partition, newest first, and its ``next_token``.

    ``keep`` drops rows after the read (a filter DynamoDB cannot express on the
    key); a filtered page can be short, or empty while ``next_token`` is set.
    """
    rows, last_evaluated_key = read.query(table, start_key)
    if keep is not None:
        rows = [row for row in rows if keep(row)]
    page, next_key = cut_page(rows, last_evaluated_key, key_attributes)
    return page, encode_cursor(next_key)


# ---------------------------------------------------------------------------
# Merged partitions
# ---------------------------------------------------------------------------

def decode_merged_cursor(token: str, key_attributes: Sequence[str]) -> dict[str, Any] | None:
    """The per-partition start keys a merged ``next_token`` carries; ``None`` when it is malformed.

    Each value is a start key or ``DONE``; a partition the token does not name
    is read from its newest row.
    """
    decoded = decode_cursor(token, ('partitions',))
    if decoded is None:
        return None
    partitions = decoded['partitions']
    if not isinstance(partitions, dict):
        return None
    if not all(isinstance(name, str) and (value == DONE or _is_key(value, key_attributes))
               for name, value in partitions.items()):
        return None
    return partitions


@dataclass
class _Stream:
    """One partition's fetched rows, consumed newest first."""

    name: str
    rows: list[Row]
    last_evaluated_key: dict[str, Any] | None
    start: Any
    consumed: int = 0
    failed: bool = False

    @property
    def exhausted(self) -> bool:
        return self.consumed >= len(self.rows)

    def next_start(self, key_attributes: Sequence[str]) -> Any:
        """Where the next page resumes this partition: a key, ``DONE``, or ``None`` (from its newest row)."""
        if self.failed:
            return self.start
        if self.exhausted:
            return dict(self.last_evaluated_key) if self.last_evaluated_key else DONE
        if self.consumed == 0:
            return self.start
        return row_key(self.rows[self.consumed - 1], key_attributes)


@dataclass
class MergedPage:
    rows: list[Row] = field(default_factory=list)
    next_token: str | None = None


def _fetch_streams(
    table: Any, reads: Mapping[str, PartitionRead], starts: Mapping[str, Any], keep: RowFilter | None,
) -> list[_Stream]:
    def fetch(name: str) -> _Stream:
        start = starts.get(name)
        if start == DONE:
            return _Stream(name, [], None, DONE)
        try:
            rows, last_evaluated_key = reads[name].query(table, start)
        except Exception:
            # One failing partition must not blank the others; it is retried
            # from the same key on the next page.
            logger.exception('Error querying partition %s', name)
            return _Stream(name, [], None, start, failed=True)
        if keep is not None:
            rows = [row for row in rows if keep(row)]
        return _Stream(name, rows, last_evaluated_key, start)

    names = list(reads)
    with ThreadPoolExecutor(max_workers=min(MERGE_MAX_WORKERS, len(names)) or 1) as pool:
        return list(pool.map(fetch, names))


def _merge(streams: list[_Stream], sort_attribute: str, max_items: int) -> list[Row]:
    """Rows newest first by ``sort_attribute`` until ``max_items``, or until a partition with more rows runs dry.

    A partition whose fetched rows are used up while DynamoDB still holds more
    stops the merge: its next rows could be newer than any other partition's.
    """
    merged: list[Row] = []
    if any(not stream.rows and stream.last_evaluated_key for stream in streams):
        # A partition whose read was all filtered out may still hold newer
        # rows than the others: this page only moves its cursor on.
        return merged
    heap = [(_descending(stream.rows[0], sort_attribute), index) for index, stream in enumerate(streams) if stream.rows]
    heapq.heapify(heap)
    while heap and len(merged) < max_items:
        _, index = heapq.heappop(heap)
        stream = streams[index]
        merged.append(stream.rows[stream.consumed])
        stream.consumed += 1
        if not stream.exhausted:
            heapq.heappush(heap, (_descending(stream.rows[stream.consumed], sort_attribute), index))
        elif stream.last_evaluated_key:
            break
    return merged


def _descending(row: Row, sort_attribute: str) -> tuple[str, ...]:
    """A heap key ordering ISO timestamps newest first."""
    return (*(chr(0x10FFFF - ord(character)) for character in str(row.get(sort_attribute, ''))), chr(0x10FFFF))


def newest_merged_page(
    table: Any,
    reads: Mapping[str, PartitionRead],
    *,
    key_attributes: Sequence[str],
    sort_attribute: str,
    cursor: Mapping[str, Any] | None,
    max_items: int,
    keep: RowFilter | None = None,
) -> MergedPage:
    """Up to ``max_items`` rows of every partition in ``reads``, newest first, cut to the page budget.

    Each partition is read from its start key in ``cursor`` (newest row
    without one) with ``PartitionRead.limit`` rows, so the merge always has
    enough rows for a full page. The ``next_token`` holds the key of the last
    row taken from each partition; ``None`` once every partition is done.
    """
    starts = dict(cursor or {})
    streams = _fetch_streams(table, reads, starts, keep)
    merged = _merge(streams, sort_attribute, max_items)
    page, truncated = take_within_budget(merged)
    if truncated:
        _unconsume(streams, merged[len(page):])
    next_starts = {stream.name: stream.next_start(key_attributes) for stream in streams}
    if all(start == DONE for start in next_starts.values()):
        return MergedPage(page, None)
    resumable = {name: start for name, start in next_starts.items() if start is not None}
    return MergedPage(page, encode_cursor({'partitions': resumable}))


def _unconsume(streams: list[_Stream], dropped: list[Row]) -> None:
    """Give rows the budget cut back to their partitions so the next page starts with them."""
    dropped_ids = {id(row) for row in dropped}
    for stream in streams:
        stream.consumed -= sum(1 for row in stream.rows[:stream.consumed] if id(row) in dropped_ids)
