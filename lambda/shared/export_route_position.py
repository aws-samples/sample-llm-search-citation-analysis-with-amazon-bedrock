"""
Where a route-replay export source stands in its lists (2.45.0): the export cursor of ``shared.export_source_routes``.

The cursor after a row is ``{list, token, skip}``: the list being read, the
route cursor of the page holding the row, and how many rows of that page are
done. A list with a ``resume_key`` adds ``last``, the identity of that row,
so a page starts after it wherever it now is; ``seek`` says the row is still
to be found further down the list (the head of a newest-first list moved on).
``build`` pins the snapshot build (``['snapshot', as_of]``) the export's
first snapshot-served page came from, so every later snapshot-served page
and list must come from the same one.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, TypeGuard

from shared.export_contract import ExportCursor

type RouteToken = str | int | None


class ExportCursorError(Exception):
    """A cursor that is not this source's (``ExportSourceError`` wraps it for the worker)."""


@dataclass(frozen=True)
class RoutePosition:
    """A position in a source's lists (see the module docstring)."""

    list_index: int
    token: RouteToken
    skip: int
    last: tuple[str, ...] | None = None
    seek: bool = False
    build: tuple[str, str] | None = None

    @property
    def seeking(self) -> bool:
        """Whether the last row written is to be found before reading on: resumed on the moving head page, or while seeking."""
        return self.last is not None and (self.token is None or self.seek)

    def cursor(self) -> ExportCursor:
        cursor: ExportCursor = {'list': self.list_index, 'token': self.token, 'skip': self.skip}
        if self.last is not None:
            cursor['last'] = list(self.last)
        if self.seek:
            cursor['seek'] = True
        if self.build is not None:
            cursor['build'] = list(self.build)
        return cursor


def _is_int(value: object) -> TypeGuard[int]:
    return isinstance(value, int) and not isinstance(value, bool)


def _texts(value: object, name: str) -> tuple[str, ...] | None:
    if value is None:
        return None
    if not isinstance(value, list) or not value or not all(isinstance(part, str) for part in value):
        raise ExportCursorError(name)
    return tuple(value)


def _build(value: object) -> tuple[str, str] | None:
    parts = _texts(value, 'build')
    if parts is None:
        return None
    if len(parts) != 2:
        raise ExportCursorError('build')
    return parts[0], parts[1]


def answer_build(body: object) -> tuple[str, str] | None:
    """
    ``('snapshot', as_of)`` of an answer served from a snapshot build; ``None`` for a live answer or a route without one.

    Live answers read the current data and are never pinned (a route may
    serve one view live and another from the snapshot).
    """
    if not isinstance(body, Mapping) or body.get('source') != 'snapshot':
        return None
    as_of = body.get('as_of')
    return 'snapshot', as_of if isinstance(as_of, str) else ''


def parse_position(cursor: ExportCursor | None, chosen: Sequence[int]) -> RoutePosition:
    """
    The position ``cursor`` stands for; the first list's start without one.

    Raises:
        ExportCursorError: The cursor is malformed or names a list that is not chosen.
    """
    if cursor is None:
        return RoutePosition(chosen[0] if chosen else 0, None, 0)
    index, token, skip, seek = cursor.get('list'), cursor.get('token'), cursor.get('skip'), cursor.get('seek', False)
    if (
        not _is_int(index) or index not in chosen or not _is_int(skip) or skip < 0
        or isinstance(token, bool) or not (token is None or isinstance(token, str | int)) or not isinstance(seek, bool)
    ):
        raise ExportCursorError('position')
    return RoutePosition(index, token, skip, _texts(cursor.get('last'), 'last'), seek, _build(cursor.get('build')))


def row_identity(row: Mapping[str, Any], resume_key: Sequence[str]) -> tuple[str, ...] | None:
    """The values of ``resume_key`` in ``row`` as text; ``None`` without a key or when a value is missing."""
    if not resume_key:
        return None
    values = []
    for path in resume_key:
        value: Any = row
        for step in path.split('.'):
            value = value.get(step) if isinstance(value, Mapping) else None
        if value is None or isinstance(value, Mapping | list):
            return None
        values.append(str(value))
    return tuple(values)
