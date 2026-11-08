"""
What the artifact builders of track S4 share (``shared.artifact_{gaps,prompts,recommendations,competitor,insights}``).

- ``fold_entries``: the accumulator of a builder that keeps one entry per
  keyword (``{'folded': n, 'entries': {keyword: entry}}``), picked from the
  keyword's ``actions`` partial; folding is order-free because the entries are
  sorted when finalized.
- ``list_page``: one page of a stored list and the ``{o, b}`` token of the next.
- ``served``: a body with the common scoped-response fields of a stored build.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from typing import Any, TypedDict

from shared.partial_contract import KeywordLatest, Partial
from shared.snapshot_artifacts import (
    SnapshotArtifacts,
    artifacts_coverage,
    artifacts_envelope,
    encode_snapshot_cursor,
    with_scope_contract,
)


class KeywordEntries(TypedDict):
    folded: int
    """KeywordLatest objects folded: the keywords whose latest run was read."""
    entries: dict[str, Any]
    """Each keyword's entry (keywords with nothing to say have none)."""


def latest_part(latest: KeywordLatest, name: str) -> Partial | None:
    """The ``name`` partial of the keyword's latest run, ``None`` when it has no run or nothing to say."""
    run = latest.get('latest')
    return None if run is None else run['parts'].get(name)


def fold_entries(acc: KeywordEntries | None, latest: KeywordLatest, pick: Callable[[Partial], Any]) -> KeywordEntries:
    """``acc`` with the keyword's entry ``pick(actions partial)`` added (no entry when the run or the pick is empty)."""
    folded: KeywordEntries = acc if acc is not None else {'folded': 0, 'entries': {}}
    folded['folded'] += 1
    part = latest_part(latest, 'actions')
    entry = None if part is None else pick(part)
    if entry is not None:
        folded['entries'][latest['keyword']] = entry
    return folded


def entries_of(acc: KeywordEntries | None) -> tuple[int, list[Any]]:
    """The folded count and the entries of ``acc`` (none before the first keyword)."""
    if acc is None:
        return 0, []
    return acc['folded'], list(acc['entries'].values())


def offset_of(params: Mapping[str, Any]) -> int:
    return int(params.get('offset') or 0)


def list_page(items: Sequence[Any], params: Mapping[str, Any], build_id: str) -> tuple[list[Any], str | None]:
    """The page of ``items`` at ``params['offset']`` of ``params['limit']`` items, and the token of the next page (``None`` at the end)."""
    offset, limit = offset_of(params), int(params['limit'])
    return list(items[offset:offset + limit]), encode_snapshot_cursor(offset + limit, len(items), build_id)


def served(body: Mapping[str, Any], artifacts: SnapshotArtifacts) -> dict[str, Any]:
    """``body`` with the coverage and source fields of a stored build (keywords the build left behind are not covered)."""
    return with_scope_contract(body, artifacts_coverage(artifacts), artifacts_envelope(artifacts))


__all__ = ['KeywordEntries', 'entries_of', 'fold_entries', 'latest_part', 'list_page', 'offset_of', 'served']
