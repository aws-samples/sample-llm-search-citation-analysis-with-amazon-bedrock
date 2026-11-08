"""
Keeping every built scope's series (``shared.scope_series``) up to date across builds (design 2.45.0 §2.2).

A build loads each scope's stored series (``current.json`` names its id),
plans what changed since, and applies it keyword by keyword so a keyword's
history is read once however many scopes it belongs to:

- **membership**: a keyword that left a scope has its stored history
  subtracted, one that joined has it added (``HistoryReader``: KeywordRunKpis
  rows with every brand from KeywordRunBrands);
- **full rebuild**: a scope without a usable series, one marked ``dirty``, one
  built with other owned domains, and every ``SELF_CHECK_EVERY``-th build
  (the self-check: the incremental series is kept beside the rebuilt one and
  compared once the build's runs are added);
- **new runs**: the fold then adds each member's latest and previous tallies
  from its KeywordLatest object; the bitmaps make that a no-op for runs
  already counted, and cover late writes and reruns.

Without a KeywordRunKpis table there is no history to read: a scope that
needs a rebuild starts empty and fills from the KeywordLatest runs.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol

from shared.keyword_run_brands import query_run_brands, with_all_brands
from shared.keyword_run_kpis import query_stored_runs
from shared.kpi_tally import RunTally
from shared.request_deadline import Deadline
from shared.scope_series import SERIES_BRANDS, SERIES_RUNS, ScopeSeries
from shared.scope_snapshot import series_key
from shared.snapshot_store import SnapshotBuildIncomplete, SnapshotStore, bounded_map, get_json

logger = logging.getLogger(__name__)

#: Every this-many builds a scope's series is rebuilt from the stored history and compared with the incremental one.
SELF_CHECK_EVERY = 7
#: Concurrent history reads of a build. A keyword's year of runs with brands is ~20 MB decoded at 10 personas x 4 engines,
#: and ``bounded_map`` holds 2 x workers of them: 32 workers held ~1.3 GB at the 10x point, 4 hold ~160 MB.
HISTORY_WORKERS = 4

class HistoryReader(Protocol):
    """A keyword's stored per-run tallies, oldest first, with every brand.

    ``since`` ``''``: the newest ``SERIES_RUNS`` runs (all a series keeps);
    else every run from ``since`` on (a window).
    """

    def __call__(self, keyword: str, since: str) -> list[RunTally]:
        """The tallies of ``keyword`` (see the class docstring)."""
        raise NotImplementedError


def stored_history(rollups: Any, brands_table: Any | None, deadline: Deadline) -> HistoryReader:
    """The ``HistoryReader`` over KeywordRunKpis (+ KeywordRunBrands); a read the deadline cuts makes the build incomplete.

    Both tables are read newest first and only as far back as the runs kept:
    the brand rows from the oldest kept run on, never the whole history.
    """

    def read(keyword: str, since: str) -> list[RunTally]:
        stored = query_stored_runs(rollups, keyword, since, brands=True, limit=None if since else SERIES_RUNS, deadline=deadline)
        if stored.cut:
            raise SnapshotBuildIncomplete(f'Time budget spent reading the history of {keyword!r}')
        if not stored.runs:
            return []
        brands = {} if brands_table is None else query_run_brands(brands_table, keyword, stored.runs[0].timestamp)
        return [with_all_brands(tally, brands) for tally in stored.runs]

    return read


def load_series(store: SnapshotStore, scope_key: str, scope_dir: str, series_id: str | None, owned: str) -> ScopeSeries:
    """The stored series ``series_id`` of a scope, or an empty one."""
    doc = None if not series_id else get_json(store.s3, store.bucket, series_key(scope_dir, series_id))
    return ScopeSeries(scope_key, doc if isinstance(doc, dict) else None, owned=owned)


@dataclass
class SeriesPlan:
    """Every built scope's series for this build, and what must be read to bring them up to date."""

    series: dict[str, ScopeSeries]
    owned: str
    checks: dict[str, ScopeSeries] = field(default_factory=dict)
    """Self-check builds: the incremental series, compared with the rebuilt one in ``series``."""
    rebuilt: set[str] = field(default_factory=set)
    joins: dict[str, set[str]] = field(default_factory=lambda: defaultdict(set))
    """Keyword -> the scopes it must be added to from its history."""
    leaves: dict[str, set[str]] = field(default_factory=lambda: defaultdict(set))
    """Keyword -> the scopes it must be subtracted from."""
    applied: set[str] = field(default_factory=set)
    """The keywords whose history ``apply_history`` has added or subtracted so far (a cut read leaves the rest)."""

    def keywords_to_read(self) -> set[str]:
        return set(self.joins) | set(self.leaves)


def _needs_rebuild(series: ScopeSeries, owned: str) -> bool:
    return not series.members or series.dirty or series.owned != owned


def plan_series(previous: Mapping[str, ScopeSeries], members: Mapping[str, set[str]], owned: str, *, history: bool) -> SeriesPlan:
    """What each scope's series needs: ``previous`` (as stored) against the scopes' ``members`` now."""
    plan = SeriesPlan({}, owned)
    for key, keywords in members.items():
        stored = previous.get(key) or ScopeSeries(key, owned=owned)
        check = history and bool(stored.members) and stored.full_builds_ago + 1 >= SELF_CHECK_EVERY
        if history and (check or _needs_rebuild(stored, owned)):
            if check and not _needs_rebuild(stored, owned):
                plan.checks[key] = stored
                _plan_membership(plan, key, stored, keywords)
            plan.series[key] = ScopeSeries(key, owned=owned)
            plan.rebuilt.add(key)
            for keyword in keywords:
                plan.joins[keyword].add(key)
        else:
            plan.series[key] = stored if stored.owned == owned else ScopeSeries(key, owned=owned)
            if history:
                _plan_membership(plan, key, plan.series[key], keywords)
            stored.full_builds_ago += 1
        plan.series[key].current = set(keywords)
    return plan


def _plan_membership(plan: SeriesPlan, key: str, stored: ScopeSeries, keywords: set[str]) -> None:
    for keyword in keywords - stored.current:
        plan.joins[keyword].add(f'check:{key}' if key in plan.checks else key)
    for keyword in stored.current - keywords:
        plan.leaves[keyword].add(f'check:{key}' if key in plan.checks else key)


def _target(plan: SeriesPlan, name: str) -> ScopeSeries:
    return plan.checks[name.removeprefix('check:')] if name.startswith('check:') else plan.series[name]


def apply_history(plan: SeriesPlan, history: HistoryReader, deadline: Deadline) -> int:
    """Read every planned keyword's history once (in parallel) and add or subtract it; the keywords read."""
    keywords = sorted(plan.keywords_to_read())
    for keyword, tallies in bounded_map(lambda keyword: history(keyword, ''), keywords, HISTORY_WORKERS):
        if deadline.stop_reading('the scope series history'):
            raise SnapshotBuildIncomplete('Time budget spent reading the scope series history')
        for name in plan.leaves.get(keyword, ()):
            _target(plan, name).remove(keyword, tallies)
        for name in plan.joins.get(keyword, ()):
            target = _target(plan, name)
            for tally in tallies:
                target.add(keyword, tally)
        plan.applied.add(keyword)
    for key in plan.checks:
        plan.checks[key].current = set(plan.series[key].current)
    return len(keywords)


def add_latest(plan: SeriesPlan, scopes: Iterable[str], keyword: str, tallies: Iterable[RunTally]) -> None:
    """Count a member's KeywordLatest runs in each of its ``scopes`` (and their self-check twins)."""
    runs = list(tallies)
    for key in scopes:
        for series in (plan.series[key], plan.checks.get(key)):
            if series is not None:
                for tally in runs:
                    series.add(keyword, tally)


def finish_checks(plan: SeriesPlan) -> list[str]:
    """Compare each self-checked scope's incremental series with its rebuild; the scopes that disagreed (logged)."""
    mismatched = sorted(key for key, incremental in plan.checks.items() if not incremental.agrees_with(plan.series[key]))
    for key in mismatched:
        logger.warning('Scope series self-check: the incremental series of %s differs from its rebuild; the rebuild is kept', key)
    for key in plan.rebuilt:
        plan.series[key].full_builds_ago = 0
    return mismatched


def series_document(series: ScopeSeries, tracked: Iterable[str]) -> dict[str, Any]:
    """The stored form of ``series``: ``SERIES_RUNS`` rows, each keeping the first-party and tracked brands plus ``SERIES_BRANDS`` others."""
    return series.to_json(keep_brands=SERIES_BRANDS, always={name.lower() for name in tracked}, runs=SERIES_RUNS)


__all__ = [
    'HISTORY_WORKERS',
    'SELF_CHECK_EVERY',
    'HistoryReader',
    'SeriesPlan',
    'add_latest',
    'apply_history',
    'finish_checks',
    'load_series',
    'plan_series',
    'series_document',
    'stored_history',
]
