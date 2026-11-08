"""Support for the ``kpi`` partial and ``latest`` artifact tests: a scope's rows, served through the snapshot and through the old live view (the oracle)."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from shared.artifact_latest import LATEST_BUILDER
from shared.artifact_registry import fold_scope
from shared.kpi_engine import answers_from_rows
from shared.kpi_scope_serve import live_keyword_latest
from shared.partial_contract import KeywordLatest, Partial, PartialConfig
from shared.snapshot_artifacts import SnapshotScope
from shared.visibility_views import visibility_view
from testing.snapshot_fakes import FakeSnapshotArtifacts

#: The fields ``visibility_view`` answers (the snapshot body adds the keyword paging fields).
VIEW_FIELDS = (
    'timestamp', 'keywords_analyzed', 'keywords_with_data', 'kpis', 'change', 'brands', 'brands_total',
    'engines', 'sources', 'sources_total', 'keywords',
)

ALL_SCOPE = SnapshotScope(scope_dir='all', kind='all', group_id=None, market_id=None, keywords_total=0)


def last_two_runs(rows: Iterable[Mapping[str, Any]]) -> dict[str, tuple[list[dict[str, Any]], list[dict[str, Any]]]]:
    """Each keyword's rows of its newest run and of the run before (any row dates a run, as ``query_last_two_runs_rows`` reads them)."""
    by_run: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    for row in rows:
        by_run[str(row['keyword'])][str(row['timestamp'])].append(dict(row))
    runs = {}
    for keyword, stamped in by_run.items():
        newest = sorted(stamped, reverse=True)
        runs[keyword] = (stamped[newest[0]], stamped[newest[1]] if len(newest) > 1 else [])
    return runs


def scope_latests(keywords: Sequence[str], rows: Iterable[Mapping[str, Any]], owned: Sequence[str]) -> list[KeywordLatest]:
    """The KeywordLatest object of every keyword of the scope (a keyword without rows has no run)."""
    runs = last_two_runs(rows)
    config = PartialConfig(brand_config={'first_party_domains': list(owned)})
    return [live_keyword_latest(keyword, *runs.get(keyword, ([], [])), config) for keyword in keywords]


def kpi_parts(latests: Iterable[KeywordLatest]) -> list[Partial]:
    """The ``kpi`` partial of each keyword's latest run, for the keywords that have one."""
    return [part for latest in latests if latest['latest'] is not None and (part := latest['latest']['parts'].get('kpi')) is not None]


def oracle_visibility(
    keywords: Sequence[str], rows: Iterable[Mapping[str, Any]], owned: Sequence[str], **options: Any,
) -> dict[str, Any]:
    """The pre-2.45.0 live view: ``visibility_view`` over every keyword's answers (no cap)."""
    runs = last_two_runs(rows)
    latest = {keyword: answers_from_rows(runs.get(keyword, ([], []))[0]) for keyword in keywords}
    previous = {keyword: answers_from_rows(runs.get(keyword, ([], []))[1]) for keyword in keywords}
    return visibility_view(list(keywords), latest, owned, previous_by_keyword=previous, **options)


def snapshot_artifacts(latests: Iterable[KeywordLatest], keywords_total: int, build_id: str = 'build-0001') -> FakeSnapshotArtifacts:
    """The ``latest`` artifacts of a scope folded and stored as one build."""
    return FakeSnapshotArtifacts(fold_scope([LATEST_BUILDER], latests, ALL_SCOPE), keywords_total=keywords_total, build_id=build_id)


def served_visibility(artifacts: FakeSnapshotArtifacts, **params: Any) -> dict[str, Any] | None:
    """What the ``latest`` builder serves for ``params``."""
    return LATEST_BUILDER.serve(artifacts, params)


def view_fields(body: Mapping[str, Any]) -> dict[str, Any]:
    """The ``visibility_view`` fields of a body."""
    return {name: body[name] for name in VIEW_FIELDS}
