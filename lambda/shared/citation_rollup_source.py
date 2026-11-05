"""
Reads of the Citations table that ``/citations`` and its rollup are built from.

A Citations row carries more than the URL list needs (``original_urls``,
``priority``, ``first_seen``, ``last_updated``); every read here projects the
five attributes the aggregation uses (``CITATION_PROJECTION``), which cuts
what DynamoDB sends and boto3 deserializes. DynamoDB's 1 MB page limit counts
the rows before projection, so a page still holds about 2,800 rows; the
saving is transfer and parsing time, not pages.

- ``scan_citations`` reads the whole table. A table that fits in one page is
  answered by that page; a larger one is read again as a parallel scan of
  ``SCAN_SEGMENTS`` segments, each capped and stopping at the request's
  deadline (``shared.request_deadline``), so the read overlaps network waits
  instead of paying them one page at a time.
- ``query_scope_citations`` reads one partition per keyword of a scope under
  a TRUE total cap (``ReadBudget``: pages and rows across every keyword, not
  a share per keyword), plus the deadline.

Both return ``(rows, truncated)``; ``truncated`` means a cap or the deadline
cut the read and the caller must say its answer is partial.
"""

from __future__ import annotations

import threading
from collections.abc import Generator, Sequence
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any

from boto3.dynamodb.conditions import Key

from shared.dynamodb_batch import collect_capped_items
from shared.request_deadline import Deadline, activate_deadline, current_deadline
from shared.scope_params import map_scope_keywords

CitationRow = dict[str, Any]

#: The attributes ``shared.citation_pages.aggregate_citations`` reads, aliased (``keyword`` is safe, the rest are short).
CITATION_PROJECTION = '#kw, #url, #cnt, #prov, #ct'
CITATION_ATTRIBUTE_NAMES = {
    '#kw': 'keyword',
    '#url': 'normalized_url',
    '#cnt': 'citation_count',
    '#prov': 'citing_providers',
    '#ct': 'content_type',
}

#: Parallel scan segments of a table larger than one page.
SCAN_SEGMENTS = 8


def projected(**params: Any) -> dict[str, Any]:
    """``params`` plus the Citations projection."""
    return {
        **params,
        'ProjectionExpression': CITATION_PROJECTION,
        'ExpressionAttributeNames': dict(CITATION_ATTRIBUTE_NAMES),
    }


@contextmanager
def reading_deadline(reserve_seconds: float) -> Generator[Deadline]:
    """A deadline ``reserve_seconds`` earlier than the request's, active for the block.

    The reads stop at it, which leaves the reserve for aggregating, sorting
    and serializing what they returned. When the block exits the request's
    deadline is active again and is marked ``cut`` if the read was.
    """
    request = current_deadline()
    read = activate_deadline(Deadline(max(0.0, request.remaining() - reserve_seconds)))
    try:
        yield read
    finally:
        activate_deadline(request)
        if read.cut:
            request.cut = True


def _scan_segment(table: Any, segment: int, segments: int, max_pages: int) -> tuple[list[CitationRow], bool]:
    return collect_capped_items(table.scan, max_pages, **projected(Segment=segment, TotalSegments=segments))


def scan_citations(
    table: Any, max_pages_per_segment: int, segments: int = SCAN_SEGMENTS,
) -> tuple[list[CitationRow], bool]:
    """Every projected Citations row, at most ``max_pages_per_segment`` pages per segment, deadline-bound.

    The first, unsegmented page answers a table that fits in it with one
    call; for a larger table it is dropped (a plain scan's pages do not line
    up with segments) and the segments are read in parallel.
    """
    first = table.scan(**projected())
    if not first.get('LastEvaluatedKey'):
        return list(first.get('Items', [])), False
    if current_deadline().stop_reading('the Citations scan'):
        return list(first.get('Items', [])), True
    with ThreadPoolExecutor(max_workers=segments) as pool:
        parts = list(pool.map(lambda segment: _scan_segment(table, segment, segments, max_pages_per_segment), range(segments)))
    rows = [row for part_rows, _ in parts for row in part_rows]
    return rows, any(truncated for _, truncated in parts)


@dataclass
class ReadBudget:
    """Pages and rows a multi-keyword read may still take, shared by its worker threads."""

    pages: int
    rows: int
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def take_page(self) -> bool:
        """Whether one more page may be read (and count it)."""
        with self._lock:
            if self.pages <= 0 or self.rows <= 0:
                return False
            self.pages -= 1
            return True

    def count_rows(self, count: int) -> None:
        with self._lock:
            self.rows -= count


def _query_partition(table: Any, keyword: str, max_pages: int, budget: ReadBudget) -> tuple[list[CitationRow], bool]:
    """One keyword's partition: at most ``max_pages`` pages, while ``budget`` and the deadline last."""
    deadline = current_deadline()
    params = projected(KeyConditionExpression=Key('keyword').eq(keyword))
    rows: list[CitationRow] = []
    for _page in range(max_pages):
        if not budget.take_page():
            return rows, True
        response = table.query(**params)
        page_rows = response.get('Items', [])
        rows.extend(page_rows)
        budget.count_rows(len(page_rows))
        last_key = response.get('LastEvaluatedKey')
        if not last_key:
            return rows, False
        params['ExclusiveStartKey'] = last_key
        if deadline.stop_reading('a Citations partition read'):
            return rows, True
    return rows, True


def query_keyword_citations(table: Any, keyword: str, max_pages: int) -> tuple[list[CitationRow], bool]:
    """One keyword's projected partition, at most ``max_pages`` pages, deadline-bound."""
    return _query_partition(table, keyword, max_pages, ReadBudget(pages=max_pages, rows=max_pages * 10_000))


def query_scope_citations(
    table: Any, keywords: Sequence[str], *, max_pages: int, max_rows: int, max_pages_per_keyword: int,
) -> tuple[list[CitationRow], bool]:
    """Every keyword's projected partition, in parallel, under one total budget of pages and rows.

    A keyword reached after the budget or the deadline is spent reads
    nothing and makes the answer ``truncated``.
    """
    budget = ReadBudget(pages=max_pages, rows=max_rows)
    partitions = map_scope_keywords(
        keywords,
        lambda keyword: _query_partition(table, keyword, max_pages_per_keyword, budget),
        lambda _keyword: ([], True),
    )
    rows = [row for partition_rows, _ in partitions for row in partition_rows]
    return rows, any(truncated for _, truncated in partitions)
