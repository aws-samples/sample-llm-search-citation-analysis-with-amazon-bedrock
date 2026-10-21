"""
Newest-first pages merged from several DynamoDB index partitions.

Some lists live in one GSI partition per kind (Content Studio rows per
``status``, research jobs per ``type``) but are shown as one newest-first
list. A page reads up to ``limit`` items from each partition after its own
position, merges them by sort key and keeps the newest that fit the page
budget. The continuation token carries one position per partition:

- ``None``: nothing of the partition consumed yet (start at its newest item)
- a key dict: the index key of the last item consumed (``ExclusiveStartKey``)
- ``"end"``: the partition is exhausted

Correctness rule: the merge never takes an item older than the oldest item
*read* from a partition that still has unread items, because an unread item
of that partition could be newer. It stops right after consuming the last
read item of such a partition; the next page reads on from there.
"""

from __future__ import annotations

import heapq
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from boto3.dynamodb.conditions import Key

from shared.cursors import decode_cursor, encode_cursor
from shared.response_budget import PAGE_BUDGET_BYTES, json_bytes

END = 'end'

Item = dict[str, Any]
# (partition, exclusive start key or None, limit) -> (items, has_more)
PartitionReader = Callable[[str, dict[str, Any] | None, int], tuple[list[Item], bool]]


@dataclass(frozen=True)
class MergeSpec:
    """How to merge one kind of list.

    ``key_names`` are the index key attributes of an item (table key plus the
    index's partition and sort key); a position in the cursor must carry
    exactly these, as strings.
    """

    partitions: tuple[str, ...]
    key_names: tuple[str, ...]
    sort_key: Callable[[Item], tuple[str, ...]]
    # Items sharing an identity (the same row seen in two partitions while its
    # index image moves) keep only the freshest; the others are passed over.
    identity: Callable[[Item], str | None] = lambda _item: None
    freshness: Callable[[Item], tuple[str, ...]] = lambda _item: ()


@dataclass(frozen=True)
class MergedPage:
    items: list[Item]
    next_token: str | None


def _valid_position(position: Any, key_names: Sequence[str]) -> bool:
    if position is None or position == END:
        return True
    return (
        isinstance(position, dict)
        and set(position) == set(key_names)
        and all(isinstance(value, str) and value for value in position.values())
    )


def decode_positions(token: str | None, spec: MergeSpec) -> dict[str, Any] | None:
    """Per-partition positions of ``token`` (all ``None`` without one); ``None`` when malformed."""
    if token is None:
        return dict.fromkeys(spec.partitions)
    decoded = decode_cursor(token, spec.partitions)
    if decoded is None or not all(_valid_position(decoded[name], spec.key_names) for name in spec.partitions):
        return None
    return decoded


@dataclass
class _Read:
    items: list[Item]
    has_more: bool


def _read_all(read: PartitionReader, positions: Mapping[str, Any], limit: int) -> dict[str, _Read]:
    reads: dict[str, _Read] = {}
    for partition, position in positions.items():
        if position == END:
            reads[partition] = _Read([], False)
            continue
        items, has_more = read(partition, position, limit)
        reads[partition] = _Read(items, has_more)
    return reads


def _candidates(reads: Mapping[str, _Read], spec: MergeSpec) -> list[tuple[str, int, Item, bool]]:
    """Every read item newest first, flagged ``True`` when a fresher image of the same row was read."""
    # A k-way merge, not a sort: it keeps each partition's own read order even
    # where sort keys tie, so "consumed" is always a prefix of every partition.
    flat = list(heapq.merge(
        *([(partition, index, item) for index, item in enumerate(read.items)] for partition, read in reads.items()),
        key=lambda entry: spec.sort_key(entry[2]),
        reverse=True,
    ))
    freshest: dict[str, tuple[str, int]] = {}
    for partition, index, item in flat:
        identity = spec.identity(item)
        if identity is None:
            continue
        current = freshest.get(identity)
        if current is None or spec.freshness(item) > spec.freshness(reads[current[0]].items[current[1]]):
            freshest[identity] = (partition, index)
    return [
        (partition, index, item, _is_stale(spec.identity(item), (partition, index), freshest))
        for partition, index, item in flat
    ]


def _is_stale(identity: str | None, where: tuple[str, int], freshest: Mapping[str, tuple[str, int]]) -> bool:
    return identity is not None and freshest[identity] != where


@dataclass
class _Cut:
    page: list[Item]
    consumed: dict[str, int]


def _cut(
    candidates: Sequence[tuple[str, int, Item, bool]],
    reads: Mapping[str, _Read],
    limit: int,
    max_bytes: int,
) -> _Cut:
    """The newest candidates within ``limit`` and ``max_bytes``, and how many of each partition were passed."""
    cut = _Cut([], {})
    used = 2
    for partition, index, item, stale in candidates:
        if not stale:
            cost = json_bytes(item) + 2
            if len(cut.page) >= limit or (cut.page and used + cost > max_bytes):
                break
            cut.page.append(item)
            used += cost
        cut.consumed[partition] = index + 1
        read = reads[partition]
        if read.has_more and index + 1 == len(read.items):
            break
    return cut


def _next_positions(
    positions: Mapping[str, Any],
    reads: Mapping[str, _Read],
    consumed: Mapping[str, int],
    spec: MergeSpec,
) -> dict[str, Any]:
    following: dict[str, Any] = {}
    for partition, position in positions.items():
        read = reads[partition]
        count = consumed.get(partition, 0)
        if count == len(read.items) and not read.has_more:
            following[partition] = END
        elif count == 0:
            following[partition] = position
        else:
            last = read.items[count - 1]
            following[partition] = {name: str(last[name]) for name in spec.key_names}
    return following


def merged_page(
    read: PartitionReader,
    spec: MergeSpec,
    positions: Mapping[str, Any],
    limit: int,
    max_bytes: int = PAGE_BUDGET_BYTES,
) -> MergedPage:
    """One newest-first page over every partition from ``positions`` (see module docstring)."""
    reads = _read_all(read, positions, limit)
    cut = _cut(_candidates(reads, spec), reads, limit, max_bytes)
    following = _next_positions(positions, reads, cut.consumed, spec)
    finished = all(position == END for position in following.values())
    return MergedPage(cut.page, None if finished else encode_cursor(following))


def query_reader(
    table: Any,
    *,
    index_name: str,
    partition_attribute: str,
    **query_options: Any,
) -> PartitionReader:
    """A ``PartitionReader`` over one GSI queried newest first (``ScanIndexForward=False``)."""
    def read(partition: str, start_key: dict[str, Any] | None, limit: int) -> tuple[list[Item], bool]:
        params: dict[str, Any] = {
            'IndexName': index_name,
            'KeyConditionExpression': Key(partition_attribute).eq(partition),
            'ScanIndexForward': False,
            'Limit': limit,
            **query_options,
        }
        if start_key is not None:
            params['ExclusiveStartKey'] = start_key
        response = table.query(**params)
        return list(response.get('Items', [])), bool(response.get('LastEvaluatedKey'))

    return read
