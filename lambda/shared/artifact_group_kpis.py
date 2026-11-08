"""Artifacts ``group-kpis/<days>`` (track S2): the summary and drivers of ``/reports/group-kpis`` per days preset.

One artifact per ``shared.artifact_trends.PRESET_DAYS``: every group run of
the ``days`` before the build (``since``) with its KPIs (``summary_run``), each keyword's
``keyword_summary`` in scope order, and the drivers of every compared group
run (``run_drivers``), all from ``shared.group_kpi_history`` over each
keyword's run tallies (``shared.artifact_trends.WindowAcc``: no brand is
needed, so the ``recent`` base tallies serve the presets they cover, and a
``history`` block every preset). A preset whose window is not covered is not
written and the route answers with a view job.

Serving: the newest runs that fit the page budget, one page of keyword rows
(``SUMMARY_KEYWORDS_PAGE``) with its snapshot cursor, and for the drivers
view the ``from_run`` .. ``to_run`` slice that fits the budget
(``drivers_page``), exactly as the live path builds them.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from shared.artifact_latest import keyword_rows_page
from shared.artifact_trends import WindowAcc, add_keyword_runs_without_brands, build_now
from shared.cursors import encode_cursor
from shared.group_kpi_history import group_kpi_summary_from_runs
from shared.kpi_tally import RunTally
from shared.response_budget import PAGE_BUDGET_BYTES, json_bytes, take_within_budget
from shared.snapshot_artifacts import ArtifactBuilder, SnapshotArtifacts
from shared.view_builder import ViewBuilder, params_of

NAME = 'group-kpis'

#: Summary keyword rows a body or a summary ``view=keywords`` page holds.
SUMMARY_KEYWORDS_PAGE = 100


def group_kpis_key(days: int) -> str:
    return f'group-kpis/{days}'


def newest_within_budget(runs: list[dict[str, Any]], max_bytes: int = PAGE_BUDGET_BYTES) -> tuple[list[dict[str, Any]], bool]:
    """The newest of ``runs`` (oldest first) that fit ``max_bytes``, still oldest first, and whether older ones were left out."""
    kept, truncated = take_within_budget(runs[::-1], max_bytes)
    return kept[::-1], truncated


def summary_fields(runs: list[dict[str, Any]], keywords: list[dict[str, Any]]) -> dict[str, Any]:
    """The summary's ``runs`` (the newest within what the ``keywords`` rows leave of the page budget), ``runs_total`` and ``keywords``.

    ``view=runs`` pages every run of the window oldest first (``runs_page``).
    """
    budget = max(PAGE_BUDGET_BYTES // 2, PAGE_BUDGET_BYTES - json_bytes(keywords))
    kept, truncated = newest_within_budget(runs, budget)
    return {'runs': kept, 'runs_truncated': truncated, 'runs_total': len(runs), 'keywords': keywords}


#: The bytes a ``view=runs`` page holds at most.
RUNS_PAGE_BYTES = PAGE_BUDGET_BYTES


def runs_page(runs: list[dict[str, Any]], after: str | None) -> dict[str, Any]:
    """A ``view=runs`` page: the runs (oldest first) after the run ``after`` that fit ``RUNS_PAGE_BYTES``, ``runs_total`` and the ``next_token``."""
    following = [run for run in runs if after is None or run['timestamp'] > after]
    page, truncated = take_within_budget(following, RUNS_PAGE_BYTES)
    return {
        'runs': page,
        'runs_total': len(runs),
        'next_token': encode_cursor({'after': page[-1]['timestamp']}) if truncated and page else None,
    }


def window_summary(keywords: list[str], runs_by_keyword: Mapping[str, Iterable[RunTally]], owned_domains: list[str]) -> dict[str, Any]:
    """Every group run (``summary_run``), each keyword's summary and every run's drivers over the runs given (``group_kpi_summary_from_runs``)."""
    return group_kpi_summary_from_runs(keywords, runs_by_keyword, owned_domains)


def drivers_page(drivers: Iterable[dict[str, Any]], from_run: str | None, to_run: str | None) -> dict[str, Any]:
    """The drivers of the group runs after ``from_run`` through ``to_run`` within the page budget, and the cursor of the rest."""
    changes = [change for change in drivers if (from_run is None or change['timestamp'] > from_run) and (to_run is None or change['timestamp'] <= to_run)]
    page, truncated = take_within_budget(changes)
    return {
        'from_run': from_run,
        'to_run': to_run,
        'changes': page,
        'next_token': encode_cursor({'from_run': page[-1]['timestamp'], 'to_run': to_run}) if truncated and page else None,
    }


def group_kpis_artifacts(acc: WindowAcc | None, now: datetime | None = None) -> dict[str, Any]:
    """Every preset whose window the objects cover, as of ``now`` (the build)."""
    if acc is None:
        return {}
    keywords, owned = list(acc.runs), acc.owned_domains

    def preset(days: int, since: str, tallies: dict[str, list[RunTally]]) -> dict[str, Any]:
        return {group_kpis_key(days): {'since': since, **window_summary(keywords, tallies, owned)}}

    return acc.presets(now or build_now(), preset, brands=False)


@dataclass(frozen=True)
class GroupKpisParams:
    """What a group-kpis request asks of a build: the preset, the view, its page and the drivers' slice."""

    days: int = 90
    view: str = 'summary'
    offset: int = 0
    from_run: str | None = None
    to_run: str | None = None
    after: str | None = None
    """Where a ``view=runs`` page starts: after this run (``None``: the window's first)."""


def serve_group_kpis(artifacts: SnapshotArtifacts, request: GroupKpisParams) -> dict[str, Any] | None:
    """The fields of ``request``'s view from its preset; ``None`` when the build does not hold the preset."""
    stored = artifacts.load(group_kpis_key(request.days))
    if stored is None:
        return None
    if request.view == 'drivers':
        return {'since': stored['since'], **drivers_page(stored['drivers'], request.from_run, request.to_run), 'truncated_before': None}
    if request.view == 'runs':
        return {'since': stored['since'], **runs_page(stored['runs'], request.after), 'truncated_before': None}
    rows: list[dict[str, Any]] = stored['keywords']
    listing = keyword_rows_page(rows, request.offset, SUMMARY_KEYWORDS_PAGE, artifacts.build_id)
    if request.view == 'keywords':
        return listing
    return {
        'since': stored['since'],
        **summary_fields(stored['runs'], listing['keywords']),
        'truncated_before': None,
        'keywords_total': len(rows),
        'keywords_next_token': listing['next_token'],
    }


#: The ``group-kpis`` presets of a scope (see the module docstring).
GROUP_KPIS_BUILDER: ViewBuilder[WindowAcc] = ViewBuilder(
    NAME, add_keyword_runs_without_brands, group_kpis_artifacts, lambda artifacts, params: serve_group_kpis(artifacts, params_of(GroupKpisParams, params)),
)

#: This module's ``shared.snapshot_artifacts.ArtifactBuilder`` instances (``shared.artifact_registry`` collects them).
BUILDERS: tuple[ArtifactBuilder[Any], ...] = (GROUP_KPIS_BUILDER,)

__all__ = [
    'BUILDERS',
    'GROUP_KPIS_BUILDER',
    'NAME',
    'RUNS_PAGE_BYTES',
    'SUMMARY_KEYWORDS_PAGE',
    'GroupKpisParams',
    'drivers_page',
    'group_kpis_artifacts',
    'group_kpis_key',
    'newest_within_budget',
    'runs_page',
    'serve_group_kpis',
    'summary_fields',
    'window_summary',
]
