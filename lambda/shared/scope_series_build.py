"""
The series step of a scope snapshot build: every built scope's series brought up to date one family of scopes at a time, resumably.

At the 10x design point (281 built scopes, 365 runs, rows of up to
``COMPACT_BRANDS`` brands) a scope's series is ~100-400 MB as Python objects,
so the build never holds more than one family's: ``all``, one market, or one
group with its group x market scopes (the scopes that share keywords, so a
keyword's history is read once per family). For each family the step loads
the stored series, plans membership deltas or a full rebuild
(``shared.scope_series_store``), reads the history it needs, adds every
member's KeywordLatest runs, writes the series under the build id and drops
it.

A full rebuild of every scope can take longer than one invocation. After
each family the step records the series it wrote in ``series-progress.json``;
a build that runs out of time inside a family first saves that family's
rebuilt series as far as the history read got (``current`` = the members
applied), then raises ``SeriesBuildIncomplete`` (how many scopes it saved),
and the next build starts each scope from the newer of its published series
and its saved one. A saved series is a valid start: its bitmaps and
``current`` members say exactly what it counts, so only what changed since
(here: the members not applied yet) is applied, and a rebuilt scope is not
rebuilt again. So even ``all`` (every keyword's 365 runs) finishes over
several invocations.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from shared.keyword_latest import entry_tally
from shared.kpi_tally import RunTally
from shared.request_deadline import Deadline
from shared.scope_series import ScopeSeries
from shared.scope_series_store import (
    HistoryReader,
    SeriesPlan,
    add_latest,
    apply_history,
    finish_checks,
    load_series,
    plan_series,
    series_document,
)
from shared.scope_snapshot import SNAPSHOT_PREFIX, series_key
from shared.snapshot_store import SnapshotBuildIncomplete, SnapshotStore, build_time, encode_json, get_json, scope_dir

PROGRESS_KEY = f'{SNAPSHOT_PREFIX}series-progress.json'
"""Scope key -> the series id an unpublished build already brought up to date."""


class SeriesBuildIncomplete(SnapshotBuildIncomplete):
    """The series step ran out of time; ``scopes_saved`` scopes were saved for the next build to resume from."""

    def __init__(self, message: str, scopes_saved: int) -> None:
        super().__init__(message)
        self.scopes_saved = scopes_saved


def encode_latest_tallies(entries: Mapping[str, Any]) -> bytes:
    """A KeywordLatest ``tallies`` block, kept compact until the series step decodes it."""
    return json.dumps(entries, separators=(',', ':'), default=str).encode('utf-8')


def decode_latest_tallies(keyword: str, encoded: bytes) -> list[RunTally]:
    """The tallies ``encode_latest_tallies`` kept, oldest first."""
    tallies = (entry_tally(keyword, entry) for _, entry in sorted(json.loads(encoded).items()))
    return [tally for tally in tallies if tally is not None]


def scope_families(keys: Iterable[str]) -> list[list[str]]:
    """The scopes in families that share keywords: ``all``; each market; each group with its group x market scopes."""
    families: dict[str, list[str]] = {}
    for key in sorted(keys):
        families.setdefault(key.split('|', 1)[0], []).append(key)
    return list(families.values())


def _progress_map(name: str, store: SnapshotStore, key: str) -> dict[str, str]:
    doc = get_json(store.s3, store.bucket, key, gzipped=False)
    entries = doc.get(name) if isinstance(doc, dict) else None
    return {str(key): str(value) for key, value in entries.items()} if isinstance(entries, dict) else {}


def read_progress(store: SnapshotStore, key: str = PROGRESS_KEY) -> dict[str, str]:
    """The series an unpublished build saved, by scope key (empty when none); ``key``: a distributed build's batch file."""
    return _progress_map('series', store, key)


def read_complete(store: SnapshotStore, key: str = PROGRESS_KEY) -> dict[str, str]:
    """Scope key -> the series id saved complete (its family finished, not cut): a later step of the same build skips it."""
    return _progress_map('complete', store, key)


def clear_progress(store: SnapshotStore) -> None:
    """Forget the saved series once a build that includes every scope is published."""
    store.s3.delete_object(Bucket=store.bucket, Key=PROGRESS_KEY)


def _save_progress(inputs: SeriesInputs, series: Mapping[str, str], complete: Mapping[str, str]) -> None:
    body = json.dumps({'series': dict(series), 'complete': dict(complete)}).encode('utf-8')
    inputs.store.s3.put_object(Bucket=inputs.store.bucket, Key=inputs.progress_key, Body=body, ContentType='application/json')


def starting_series(previous: Mapping[str, Any] | None, progress: Mapping[str, str]) -> dict[str, str]:
    """Each scope's series to start from: the newer of the published one (``current.json``) and the saved one."""
    published = {key: str(entry['series']) for key, entry in ((previous or {}).get('scopes') or {}).items() if isinstance(entry, dict) and entry.get('series')}
    chosen = dict(published)
    for key, saved in progress.items():
        saved_at, published_at = build_time(saved), build_time(published.get(key, ''))
        if saved_at is not None and (published_at is None or saved_at > published_at):
            chosen[key] = saved
    return chosen


@dataclass(frozen=True)
class SeriesInputs:
    """What the series step reads and where it writes."""

    store: SnapshotStore
    build_id: str
    owned: str
    tracked: tuple[str, ...]
    members: Mapping[str, set[str]]
    """Each built scope's keywords."""
    latest: Mapping[str, bytes]
    """Each keyword's KeywordLatest tallies (``encode_latest_tallies``); a keyword without an object is absent."""
    history: HistoryReader | None
    starting: Mapping[str, str]
    """``starting_series``."""
    progress: Mapping[str, str] = field(default_factory=dict)
    """``read_progress`` at the start of the build."""
    complete: Mapping[str, str] = field(default_factory=dict)
    """``read_complete`` at the start of the step: a family whose every scope is complete under ``build_id`` is not built again."""
    progress_key: str = PROGRESS_KEY
    """Where the progress is saved: one file per build, or one per series batch of a distributed build (batches run at once)."""


@dataclass
class SeriesOutcome:
    """What the step wrote and read."""

    series: dict[str, str] = field(default_factory=dict)
    """Scope key -> the series id written (the build id)."""
    rebuilt: int = 0
    resumed: int = 0
    history_reads: int = 0
    mismatched: list[str] = field(default_factory=list)


def _put_series(inputs: SeriesInputs, key: str, series: ScopeSeries, outcome: SeriesOutcome) -> None:
    body = encode_json(series_document(series, inputs.tracked))
    inputs.store.s3.put_object(Bucket=inputs.store.bucket, Key=series_key(scope_dir(key), inputs.build_id), Body=body, ContentType='application/gzip')
    outcome.series[key] = inputs.build_id


def _save_partial(inputs: SeriesInputs, plan: SeriesPlan, outcome: SeriesOutcome) -> int:
    """After a cut history read: save each scope of the family as far as it got; how many.

    A scope's ``current`` becomes what its rows count: its members, without the joins whose history
    was not read yet and with the leaves not subtracted yet. A partial series is a valid start: the
    next build plans exactly those as joins and leaves and reads only their history, so a family too
    large for one invocation (a rebuild, or the rest of a resumed one) still finishes over several.
    A self-checked scope is not saved (its twin decides).
    """
    pending = plan.keywords_to_read() - plan.applied
    saved = 0
    for key in sorted(set(plan.series) - set(plan.checks)):
        joins = {keyword for keyword in pending if key in plan.joins.get(keyword, ())}
        leaves = {keyword for keyword in pending if key in plan.leaves.get(keyword, ())}
        if not joins and not leaves and key not in plan.rebuilt:
            continue
        series = plan.series[key]
        series.current = (inputs.members[key] - joins) | leaves
        if key in plan.rebuilt:
            series.full_builds_ago = 0
        _put_series(inputs, key, series, outcome)
        saved += 1
    return saved


def _update_family(inputs: SeriesInputs, family: list[str], deadline: Deadline, outcome: SeriesOutcome) -> None:
    previous = {key: load_series(inputs.store, key, scope_dir(key), inputs.starting.get(key), inputs.owned) for key in family}
    plan = plan_series(previous, {key: inputs.members[key] for key in family}, inputs.owned, history=inputs.history is not None)
    always = frozenset(name.lower() for name in inputs.tracked)
    for series in (*plan.series.values(), *plan.checks.values()):
        series.always = always
    if inputs.history is not None:
        try:
            outcome.history_reads += apply_history(plan, inputs.history, deadline)
        except SnapshotBuildIncomplete:
            _save_partial(inputs, plan, outcome)
            raise
    keywords = sorted(set().union(*(inputs.members[key] for key in family)))
    for keyword in keywords:
        encoded = inputs.latest.get(keyword)
        if encoded is not None:
            add_latest(plan, [key for key in family if keyword in inputs.members[key]], keyword, decode_latest_tallies(keyword, encoded))
    outcome.mismatched.extend(finish_checks(plan))
    outcome.rebuilt += len(plan.rebuilt)
    for key in family:
        _put_series(inputs, key, plan.series.pop(key), outcome)
        start = inputs.starting.get(key)
        outcome.resumed += start is not None and start == inputs.progress.get(key)


def update_series(inputs: SeriesInputs, deadline: Deadline) -> SeriesOutcome:
    """Bring every scope of ``inputs.members`` up to date, family by family, saving progress after each (see the module docstring)."""
    outcome = SeriesOutcome()
    saved = dict(inputs.progress)
    complete = dict(inputs.complete)
    for family in scope_families(inputs.members):
        if all(complete.get(key) == inputs.build_id for key in family):
            outcome.series.update(dict.fromkeys(family, inputs.build_id))
            continue
        if deadline.stop_reading('the scope series'):
            raise SeriesBuildIncomplete(f'Time budget spent after {len(outcome.series)} of {len(inputs.members)} scope series', len(outcome.series))
        try:
            _update_family(inputs, family, deadline, outcome)
        except SnapshotBuildIncomplete as error:
            _save_progress(inputs, {**saved, **outcome.series}, complete)
            raise SeriesBuildIncomplete(str(error), len(outcome.series)) from error
        saved.update({key: outcome.series[key] for key in family})
        complete.update(dict.fromkeys(family, inputs.build_id))
        _save_progress(inputs, saved, complete)
    return outcome


__all__ = [
    'PROGRESS_KEY',
    'SeriesBuildIncomplete',
    'SeriesInputs',
    'SeriesOutcome',
    'clear_progress',
    'decode_latest_tallies',
    'encode_latest_tallies',
    'read_complete',
    'read_progress',
    'scope_families',
    'starting_series',
    'update_series',
]
