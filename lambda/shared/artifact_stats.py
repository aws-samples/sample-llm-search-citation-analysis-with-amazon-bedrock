"""Artifact ``stats`` (track S2): a market's keyword and answer totals and its last execution for ``/stats?market_id``.

Folded from each keyword's KeywordLatest object of the market scope:

- ``keywords``: the keywords folded;
- ``total_searches``, ``total_citations``, ``total_crawled``: the sums of each
  object's ``counts`` block (``{searches, citations, crawled}``: the keyword's
  SearchResults, Citations and CrawledContent rows), as of the build; the
  crawled count is recounted only every ``CRAWLED_RECOUNT_DAYS``
  (``shared.keyword_counts``), so it may lag the pages crawled since;
- ``last_execution``: the newest ``latest.timestamp`` (every provider of a run shares it).

The artifact is written only when every object holds its ``counts``: a build
of objects without them writes nothing, and ``/stats`` reads the totals live
as before (labelled ``counts_approximate`` when its budget cut them).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from shared.partial_contract import KeywordLatest
from shared.snapshot_artifacts import ArtifactBuilder, SnapshotArtifacts
from shared.view_builder import ViewBuilder

NAME = 'stats'
STATS_KEY = 'stats'

#: The ``counts`` block fields and the totals they add to.
COUNT_TOTALS = {'searches': 'total_searches', 'citations': 'total_citations', 'crawled': 'total_crawled'}


@dataclass
class StatsAcc:
    """The market's sums so far, and whether every object folded held its counts."""

    keywords: int = 0
    totals: dict[str, int] = field(default_factory=lambda: dict.fromkeys(COUNT_TOTALS.values(), 0))
    complete: bool = True
    last_execution: str | None = None


def _counts(latest: KeywordLatest) -> dict[str, int] | None:
    doc: Mapping[str, object] = latest
    block = doc.get('counts')
    if not isinstance(block, Mapping):
        return None
    values = {name: block.get(name) for name in COUNT_TOTALS}
    if not all(isinstance(value, int) and not isinstance(value, bool) and value >= 0 for value in values.values()):
        return None
    return {COUNT_TOTALS[name]: int(value) for name, value in values.items() if isinstance(value, int)}


def add_stats(acc: StatsAcc | None, latest: KeywordLatest) -> StatsAcc:
    folded = acc or StatsAcc()
    folded.keywords += 1
    counts = _counts(latest)
    if counts is None:
        folded.complete = False
    else:
        for total, value in counts.items():
            folded.totals[total] += value
    run = latest['latest']
    stamp = run['timestamp'] if run is not None else None
    if stamp and (folded.last_execution is None or stamp > folded.last_execution):
        folded.last_execution = stamp
    return folded


def stats_artifacts(acc: StatsAcc | None) -> dict[str, Any]:
    """``{'stats': totals}`` when every object held its counts; nothing otherwise."""
    if acc is None or not acc.complete:
        return {}
    return {STATS_KEY: {'unique_keywords': acc.keywords, **acc.totals, 'last_execution': acc.last_execution}}


def serve_stats(artifacts: SnapshotArtifacts, params: Mapping[str, Any]) -> dict[str, Any] | None:
    """The stored totals; ``None`` when the build has none."""
    del params
    stored = artifacts.load(STATS_KEY)
    return dict(stored) if isinstance(stored, Mapping) else None


#: The ``stats`` artifact of a market scope (see the module docstring).
STATS_BUILDER: ViewBuilder[StatsAcc] = ViewBuilder(NAME, add_stats, stats_artifacts, serve_stats)

#: This module's ``shared.snapshot_artifacts.ArtifactBuilder`` instances (``shared.artifact_registry`` collects them).
BUILDERS: tuple[ArtifactBuilder[Any], ...] = (STATS_BUILDER,)

__all__ = ['BUILDERS', 'COUNT_TOTALS', 'NAME', 'STATS_BUILDER', 'STATS_KEY', 'StatsAcc', 'add_stats', 'serve_stats', 'stats_artifacts']
