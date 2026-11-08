"""Test support for the export row sources (``shared.export_source_routes``, ``shared.export_sources``)."""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable, Iterator, Mapping
from dataclasses import dataclass, field
from typing import Any

from shared.export_contract import Caller, ExportCursor, ExportMark, ExportRow, ExportRows, ExportRowSource, RowsEnd
from shared.export_source_routes import RouteRequest, reading_for
from shared.request_deadline import Deadline
from testing.clocks import JumpClock

USER = Caller(sub='user-1', email='ana@example.com', groups=frozenset({'Users'}))
ADMIN = Caller(sub='admin-1', email='admin@example.com', groups=frozenset({'Admin'}))


def long_deadline() -> Deadline:
    return Deadline(3_600)


def expired_deadline() -> Deadline:
    return Deadline(0, lambda: 1.0)


#: Computing answers ``all_rows`` waits through before it calls the source stuck.
VIEW_JOB_WAITS = 5


def _drained_items(rows: ExportRows) -> tuple[list[ExportRow | ExportMark], RowsEnd]:
    yielded: list[ExportRow | ExportMark] = []
    while True:
        try:
            yielded.append(next(rows))
        except StopIteration as stop:
            return yielded, stop.value


def drained(rows: ExportRows) -> tuple[list[ExportRow], RowsEnd]:
    """The rows a source's ``rows()`` yields (progress marks left out) and how it ended."""
    items, end = _drained_items(rows)
    return [item for item in items if isinstance(item, ExportRow)], end


def all_rows(source: ExportRowSource, params: Mapping[str, str], cursor: ExportCursor | None = None) -> list[ExportRow]:
    """
    Every row ``source`` yields after ``cursor`` under a deadline that never runs out (it must say it finished).

    A source stopping for a view job still computing is read again from its last cursor, as the export state
    machine does after ``WaitForViewJob`` hears the job finished (the test routes already ran the job).
    """
    rows: list[ExportRow] = []
    end = RowsEnd.STOPPED
    for _attempt in range(VIEW_JOB_WAITS):
        with reading_for(USER.sub) as read:
            items, end = _drained_items(source.rows(params, cursor, long_deadline()))
        rows += [item for item in items if isinstance(item, ExportRow)]
        cursor = items[-1].cursor if items else cursor
        if end is not RowsEnd.STOPPED or read.view_job is None:
            break
    assert end is RowsEnd.FINISHED, f'the source ended {end}'
    return rows


def row_values(rows: Iterable[ExportRow]) -> list[tuple[str, tuple[Any, ...]]]:
    return [(row.sheet, row.values) for row in rows]


def resumed_from_every_row(source: ExportRowSource, params: Mapping[str, str], rows: list[ExportRow]) -> Iterator[tuple[int, list[ExportRow]]]:
    """``(i, rows after rows[i])`` for every row, each read from a cursor that went through JSON (as the worker stores it)."""
    for index, row in enumerate(rows):
        cursor = json.loads(json.dumps(row.cursor))
        yield index, all_rows(source, params, cursor)


def resumes_from_every_row(source: ExportRowSource, params: Mapping[str, str], more_than: int | None = None) -> bool:
    """
    Whether reading ``source`` again from each row's cursor gives exactly the rows after it (no repeat, no skip),
    and it yields more than ``more_than`` rows (when given: enough that the cursor crosses pages).
    """
    rows = all_rows(source, params)
    resumed = {index: row_values(rest) for index, rest in resumed_from_every_row(source, params, rows)}
    return (more_than is None or len(rows) > more_than) and resumed == {index: row_values(rows[index + 1:]) for index in range(len(rows))}


@dataclass
class PagedRoute:
    """A fake router answering one list paged by ``next_token`` (or ``offset``), recording every request."""

    items: list[dict[str, Any]]
    list_key: str = 'items'
    by_offset: bool = False
    computing_first: int = 0
    """Requests answered ``202 computing`` before the list."""
    partial_first: int = 0
    """Requests answered with ``truncated: true`` before a complete page."""
    clock: JumpClock | None = None
    request_seconds: float = 0.0
    """Seconds every request moves ``clock`` on (a router taking its time)."""
    requests: list[RouteRequest] = field(default_factory=list)

    def __call__(self, request: RouteRequest) -> tuple[int, Any]:
        self.requests.append(request)
        if self.clock is not None:
            self.clock.now += self.request_seconds
        if len(self.requests) <= self.computing_first:
            return 202, {'status': 'computing', 'job': {'id': 'job-1', 'started_at': '2026-11-06T08:00:00Z'}, 'retry_after_ms': 1500}
        limit = int(request.query.get('limit', '100'))
        start = int(request.query.get('offset' if self.by_offset else 'next_token', '0'))
        page = self.items[start:start + limit]
        body: dict[str, Any] = {self.list_key: page, 'total': len(self.items)}
        if not self.by_offset:
            body['next_token'] = str(start + limit) if start + limit < len(self.items) else None
        if len(self.requests) <= self.computing_first + self.partial_first:
            body['truncated'] = True
        return 200, body


def fixed_answer(status: int, body: Any) -> Callable[[RouteRequest], tuple[int, Any]]:
    def invoke(_request: RouteRequest) -> tuple[int, Any]:
        return status, body

    return invoke


def numbered_items(count: int) -> list[dict[str, Any]]:
    return [{'name': f'item-{index:03d}', 'rank': index + 1, 'tags': ['a', 'b'], 'kpis': {'rate': index / 10}} for index in range(count)]


