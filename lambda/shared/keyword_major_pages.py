"""
Pages of a list ordered keyword by keyword (design 2.45.0 §2.5, live keyword cursors ``{k, r, f}``).

The appearances of ``GET /brand-mentions?view=appearances`` and the examples
of ``GET /visibility/sentiment-examples`` are ordered keyword-major: every
item of one keyword, then the next keyword's. A page therefore needs only the
keywords it covers: ``collect_page`` starts at a ``KeywordCursor`` (keyword
index, items of it already returned), reads keyword after keyword through
``read`` until it holds ``limit`` items, and ``next_position`` says where
the next page starts once the caller knows how many items it kept (the byte
budget may keep fewer).

``slots`` are the keywords that may hold items, in list order, each with the
count the caller expects (an exact count live, the build's count from a
snapshot index); a slot with no items is never read. The request's time
budget (``shared.request_deadline``) stops the reading between keywords: the
page is then short, ``stopped`` is set, and the next page resumes at the
keyword that was not read.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

from shared.request_deadline import current_deadline
from shared.snapshot_artifacts import KeywordCursor, encode_keyword_cursor


@dataclass(frozen=True)
class Slot:
    """A keyword that may hold items: its index in the list's keyword order and the items expected."""

    index: int
    count: int


@dataclass(frozen=True)
class Placed[ItemT]:
    """One item of a page and its position: keyword index and offset among that keyword's items."""

    index: int
    offset: int
    item: ItemT


@dataclass
class PageRead[ItemT]:
    """What ``collect_page`` read."""

    items: list[Placed[ItemT]] = field(default_factory=list)
    lengths: dict[int, int] = field(default_factory=dict)
    """Items each keyword read actually holds."""
    stopped: tuple[int, int] | None = None
    """Where the reading stopped for the time budget (keyword index, offset), or ``None``."""


@dataclass(frozen=True)
class PageRequest[ItemT]:
    """One keyword-major page: the keywords that may hold items, where it starts, its size and how a keyword is read.

    ``keywords_total`` is the length of the list's keyword order (the
    cursor's bound). ``budgeted=False`` when ``read`` only looks up lists
    already in memory (the live path): the time budget is then not
    consulted between keywords.
    """

    slots: Sequence[Slot]
    start: KeywordCursor
    limit: int
    read: Callable[[int], Sequence[ItemT]]
    keywords_total: int
    budgeted: bool = True


def collect_page[ItemT](request: PageRequest[ItemT]) -> PageRead[ItemT]:
    """At most ``request.limit`` items from ``request.start`` on, reading only the keywords the page needs."""
    deadline = current_deadline()
    start, limit = request.start, request.limit
    page: PageRead[ItemT] = PageRead()
    for slot in request.slots:
        if slot.index < start.keyword_index or slot.count <= 0:
            continue
        if len(page.items) >= limit:
            break
        offset = start.row_offset if slot.index == start.keyword_index else 0
        if request.budgeted and deadline.stop_reading('a keyword-major page'):
            page.stopped = (slot.index, offset)
            break
        items = request.read(slot.index)
        page.lengths[slot.index] = len(items)
        wanted = items[offset:offset + limit - len(page.items)]
        page.items.extend(Placed(slot.index, offset + position, item) for position, item in enumerate(wanted))
    return page


def _after(slots: Sequence[Slot], index: int) -> tuple[int, int] | None:
    """The first slot with items after keyword ``index``."""
    return next(((slot.index, 0) for slot in slots if slot.index > index and slot.count > 0), None)


def next_position[ItemT](page: PageRead[ItemT], kept: int, slots: Sequence[Slot]) -> tuple[int, int] | None:
    """Where the page after the first ``kept`` items of ``page`` starts, or ``None`` at the end of the list."""
    if kept < len(page.items):
        placed = page.items[kept]
        return placed.index, placed.offset
    if page.stopped is not None:
        return page.stopped
    if not page.items:
        return None
    last = page.items[kept - 1]
    if last.offset + 1 < page.lengths.get(last.index, 0):
        return last.index, last.offset + 1
    return _after(slots, last.index)


def page_token(position: tuple[int, int] | None, fingerprint: str, keywords_total: int) -> str | None:
    """The ``next_token`` of ``position`` in a list over ``keywords_total`` keywords (``None`` past the end)."""
    if position is None:
        return None
    return encode_keyword_cursor(KeywordCursor(keyword_index=position[0], row_offset=position[1], fingerprint=fingerprint), keywords_total)


def keyword_major_page[ItemT, OutT](request: PageRequest[ItemT], finish: Callable[[list[ItemT]], list[OutT]]) -> tuple[list[OutT], str | None]:
    """The page ``request`` asks for, as ``finish`` keeps it (a prefix: the byte budget may keep fewer), and its ``next_token``."""
    page = collect_page(request)
    kept = finish([placed.item for placed in page.items])
    position = next_position(page, len(kept), request.slots)
    return kept, page_token(position, request.start.fingerprint, request.keywords_total)


def snapshot_page_fields(token: str | None) -> dict[str, Any]:
    """The paging fields of a page served from a build: its ``next_token``, no keyword left out, and whether the budget cut it."""
    return {'next_token': token, 'keywords_truncated': False, 'truncated': current_deadline().cut}


def list_fingerprint(*parts: object) -> str:
    """A short, stable fingerprint of what a keyword-major list was read from (a cursor of another list expires)."""
    raw = json.dumps(parts, sort_keys=True, separators=(',', ':'), default=str)
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()[:16]


__all__ = [
    'PageRead',
    'PageRequest',
    'Placed',
    'Slot',
    'collect_page',
    'keyword_major_page',
    'list_fingerprint',
    'next_position',
    'page_token',
    'snapshot_page_fields',
]
