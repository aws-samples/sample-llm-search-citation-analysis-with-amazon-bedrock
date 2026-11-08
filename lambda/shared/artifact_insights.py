"""Artifact ``insights`` (track S4): facts, derived insights and stability per days preset for ``/reports/insights``.

Folded from each keyword's ``insights`` partial of its latest run
(``insights_engine.merge_partials``) and, for a keyword group, from the
compact per-run series its KeywordLatest object carries (``series``: rows of
``[timestamp, *kpis]`` named by ``k``). Finalized as the facts without
stability (``facts_from_partials``), the scope's KPIs (``scope_kpis``, for the
GenerateInsights narrative) and, for a group, the stability facts of every
``STABILITY_PRESETS`` window ending at the build. Served with the insights
derived from the facts (``insights_from_facts``); a group asked for a window
that is not a preset answers ``None`` (the caller starts a view job).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any, TypedDict, cast

from shared.action_artifacts import latest_part, offset_of, served
from shared.answer_queries import history_since
from shared.group_kpi_history import mention_change
from shared.insights_engine import facts_from_partials, insights_from_facts, merge_partials, scope_kpis, stability_facts
from shared.insights_pages import PAGED_FACTS, facts_page, with_page_tokens
from shared.partial_contract import KeywordLatest
from shared.snapshot_artifacts import ArtifactBuilder, SnapshotArtifacts, SnapshotScope
from shared.utils import utc_now

ARTIFACT_KEY = 'insights'

#: The ``days`` windows a group's stability facts are stored for (the history presets of the reports).
STABILITY_PRESETS = (7, 30, 90, 180, 365)

#: The series KPIs the stability facts read.
_SERIES_FIELDS = ('mentions', 'average_position')


class InsightsAcc(TypedDict):
    folded: int
    merged: dict[str, Any] | None
    group: bool
    series: dict[str, list[list[Any]]]
    """Per keyword ``[timestamp, mentions, average_position]`` of every stored run (groups only)."""


def coverage_fields(keywords_analyzed: int, merged: Mapping[str, Any] | None) -> dict[str, Any]:
    """The latest-run coverage of the facts, as ``GET /api/visibility`` words it."""
    return {
        'timestamp': (merged['timestamp'] or None) if merged else None,
        'keywords_analyzed': keywords_analyzed,
        'keywords_with_data': merged['keywords'] if merged else 0,
    }


def _series_rows(latest: KeywordLatest) -> list[list[Any]]:
    """The keyword's ``[timestamp, mentions, average_position]`` per stored run (none without a series)."""
    series = cast(Mapping[str, Any], latest).get('series') or {}
    names = list(series.get('k') or [])
    if not all(name in names for name in _SERIES_FIELDS):
        return []
    picks = [names.index(name) + 1 for name in _SERIES_FIELDS]
    return [[str(row[0]), *(row[index] for index in picks)] for row in series.get('r') or []]


def history_entries(series: Mapping[str, list[list[Any]]], since: str) -> list[dict[str, Any]]:
    """The ``keywords`` of a group history (``stability_facts``' input) from the series rows of the runs since ``since``."""
    entries = []
    for keyword in sorted(series, key=lambda name: (name.casefold(), name)):
        runs: list[dict[str, Any]] = []
        for timestamp, mentions, position in sorted(row for row in series[keyword] if str(row[0]) >= since):
            kpis = {'mentions': mentions, 'average_position': position}
            change = None if not runs else {'mention': mention_change(kpis, runs[-1]['kpis'])}
            runs.append({'timestamp': timestamp, 'kpis': kpis, 'change': change})
        entries.append({'keyword': keyword, 'runs': runs})
    return entries


def stability_presets(series: Mapping[str, list[list[Any]]], now: datetime, presets: Iterable[int] = STABILITY_PRESETS) -> dict[str, list[dict[str, Any]]]:
    """The stability facts of each ``days`` preset window ending at ``now``, keyed by the days as text."""
    return {str(days): stability_facts(history_entries(series, history_since(days, now))) for days in presets}


def insights_body(stored: Mapping[str, Any], days: int, params: Mapping[str, Any]) -> dict[str, Any] | None:
    """The ``/reports/insights`` body of a stored build, with ``days``' stability; ``None`` when a group's window is not stored.

    A build that counted no answer has no configuration of its own: its
    (empty) facts are shaped with the request's ``owned_domains`` and
    ``competitor_domains``, as the live path shapes them.
    """
    stability: list[dict[str, Any]] = []
    if stored['group']:
        preset = stored['stability'].get(str(days))
        if preset is None:
            return None
        stability = list(preset)
    facts = stored['facts']
    if not stored['coverage']['keywords_with_data']:
        facts = facts_from_partials(None, params.get('owned_domains') or (), None, params.get('competitor_domains'))
    return {**stored['coverage'], **insights_from_facts({**facts, 'stability': stability}), 'keywords_truncated': False, 'history_truncated_before': None}


@dataclass(frozen=True)
class InsightsBuilder:
    """The insights facts of a scope."""

    name: str = 'insights'
    presets: tuple[int, ...] = STABILITY_PRESETS
    """The ``days`` windows a group's stability is stored for (a view job adds the one it was asked)."""

    def fold(self, acc: InsightsAcc | None, latest: KeywordLatest, scope: SnapshotScope) -> InsightsAcc:
        folded: InsightsAcc = acc if acc is not None else {'folded': 0, 'merged': None, 'group': scope.kind == 'group', 'series': {}}
        folded['folded'] += 1
        part = latest_part(latest, 'insights')
        if part is not None:
            folded['merged'] = merge_partials(folded['merged'], part)
        if folded['group']:
            folded['series'][latest['keyword']] = _series_rows(latest)
        return folded

    def finalize(self, acc: InsightsAcc | None) -> dict[str, Any]:
        merged = acc['merged'] if acc else None
        owned = list(merged['owned']) if merged else []
        competitors = dict(merged['competitor_domains']) if merged else {}
        group = bool(acc and acc['group'])
        return {ARTIFACT_KEY: {
            'group': group,
            'coverage': coverage_fields(acc['folded'] if acc else 0, merged),
            'facts': facts_from_partials(merged, owned, None, competitors),
            'kpis': scope_kpis(merged, owned),
            'stability': stability_presets(acc['series'], utc_now(), self.presets) if acc and group else {},
        }}

    def serve(self, artifacts: SnapshotArtifacts, params: Mapping[str, Any]) -> dict[str, Any] | None:
        """``params`` carries ``days`` (only a group's stability looks back over it), ``owned_domains``, ``competitor_domains``,
        and ``view`` / ``offset`` (``view=owned_pages|prompt_engine`` answers one page of that whole list, ``shared.insights_pages``)."""
        stored = artifacts.load(ARTIFACT_KEY)
        if stored is None:
            return None
        view = str(params.get('view') or 'summary')
        if view in PAGED_FACTS and PAGED_FACTS[view][0] not in stored['facts']:
            # A build older than the fact (``caveat_reasons``, 2.45.0 wave 5): a view job answers.
            return None
        if view in PAGED_FACTS:
            return served({'keywords_truncated': False, **facts_page(stored['facts'], view, offset_of(params), artifacts.build_id)}, artifacts)
        body = insights_body(stored, int(params.get('days') or 90), params)
        return None if body is None else served(with_page_tokens(body, artifacts.build_id), artifacts)


#: This module's ``shared.snapshot_artifacts.ArtifactBuilder`` instances (``shared.artifact_registry`` collects them).
BUILDERS: tuple[ArtifactBuilder[Any], ...] = (InsightsBuilder(),)
