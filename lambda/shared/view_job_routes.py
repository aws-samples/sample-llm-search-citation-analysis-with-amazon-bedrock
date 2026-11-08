"""
What a view job computes for each route (design 2.45.0 §2.4): the ``computers`` of ``shared.view_jobs.run_view_job``.

A handler that cannot answer a large scope from its build calls
``shared.scope_snapshot_serve`` with the route's name; the job the GenerateSummary
Lambda then runs looks the route up here:

- **window routes** (``trends``, ``reports-overview``, ``group-kpis``): each
  keyword's stored per-run tallies (KeywordRunKpis with every brand from
  KeywordRunBrands, ``shared.scope_series_store.stored_history``) of the
  ``days`` asked, whatever they are, folded into the one artifact the route's
  builder serves (``trends/<period>-<days>``, ``group-kpis/<days>``). The
  KeywordLatest objects hold only two months of base tallies, so a window job
  never folds them.
- **latest-run routes** (``visibility`` and the action and insight lists):
  the route's builder folds the scope's KeywordLatest objects now, as a build
  would (``/reports/insights`` also stores the stability window asked).
- **mention routes** (``shared.mention_view_jobs.MENTION_JOB_ROUTES``):
  ``compute_mention_view`` over each keyword's selected run, read
  raw (``shared.mention_row_reads.job_readers``).

The window and latest-run jobs store artifacts (``shared.view_jobs.artifacts_result``):
the handler's own builder serves and pages them like a published build.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any

from shared.answer_queries import history_since
from shared.artifact_group_kpis import group_kpis_key, window_summary
from shared.artifact_insights import STABILITY_PRESETS, InsightsBuilder
from shared.artifact_registry import artifact_builders
from shared.artifact_trends import preset_artifacts, trend_body
from shared.kpi_tally import RunTally
from shared.mention_view_jobs import MENTION_JOB_ROUTES, JobReaders, compute_mention_view
from shared.request_deadline import current_deadline
from shared.scope_series_store import HISTORY_WORKERS, HistoryReader
from shared.snapshot_artifacts import ArtifactBuilder
from shared.snapshot_store import SnapshotBuildIncomplete, bounded_map
from shared.view_jobs import JobCompute, JobContext, JobRequest, artifacts_job, artifacts_result

#: Each latest-run route and the artifact builder its handler serves it with.
LATEST_RUN_ROUTES: Mapping[str, str] = {
    'visibility': 'latest',
    'citation-gaps': 'gaps',
    'prompt-insights': 'prompts',
    'recommendations': 'recommendations',
    'reports-competitor': 'competitor',
    'content-studio-ideas': 'content-ideas',
    'reports-insights': 'insights',
}

#: The window routes whose job folds the trend view, and the one whose job folds the group KPI history.
TREND_ROUTES = ('trends', 'reports-overview')
GROUP_KPIS_ROUTE = 'group-kpis'

#: The ``days`` a window route asks when its params do not say (the routes' defaults).
DEFAULT_DAYS = {'trends': 30, 'reports-overview': 30, GROUP_KPIS_ROUTE: 90}


class JobInputUnavailable(ValueError):
    """This deployment does not give the job what its route reads (a table or a reader is not configured)."""


@dataclass(frozen=True)
class JobResources:
    """What the jobs read besides the KeywordLatest objects: stored history, the owned domains and the raw mention rows."""

    history: HistoryReader | None
    owned_domains: list[str]
    mention_readers: JobReaders | None = None


def _days(request: JobRequest) -> int:
    return int(request.params.get('days') or DEFAULT_DAYS[request.route])


def window_tallies(request: JobRequest, context: JobContext, history: HistoryReader | None) -> tuple[str, dict[str, list[RunTally]]]:
    """``since`` (``days`` before the job) and each keyword's runs with answers from then on, in scope order."""
    if history is None:
        raise JobInputUnavailable('the per-run KPI rollups are not configured for view jobs')
    since = history_since(_days(request), datetime.fromisoformat(context.built_at))
    tallies: dict[str, list[RunTally]] = {}
    for keyword, runs in bounded_map(lambda keyword: history(keyword, since), request.report_scope.keywords, HISTORY_WORKERS):
        if current_deadline().stop_reading('a window view job'):
            raise SnapshotBuildIncomplete('Time budget spent before the view job read every keyword history')
        tallies[keyword] = [run for run in runs if run.answers]
    return since, tallies


def trends_job(resources: JobResources) -> JobCompute:
    """The ``trends/<period>-<days>`` artifact of the days and period asked."""
    def compute(request: JobRequest, context: JobContext) -> dict[str, Any]:
        days, period = _days(request), str(request.params.get('period') or 'day')
        since, tallies = window_tallies(request, context, resources.history)
        keywords = list(request.report_scope.keywords)
        body = trend_body(keywords, tallies, period, days, since, resources.owned_domains, with_brand_series=True)
        return artifacts_result(preset_artifacts(body, period, days), context, len(keywords))

    return compute


def group_kpis_job(resources: JobResources) -> JobCompute:
    """The ``group-kpis/<days>`` artifact (summary, keyword rows, drivers) of the days asked."""
    def compute(request: JobRequest, context: JobContext) -> dict[str, Any]:
        days = _days(request)
        since, tallies = window_tallies(request, context, resources.history)
        keywords = list(request.report_scope.keywords)
        stored = {'since': since, **window_summary(keywords, tallies, resources.owned_domains)}
        return artifacts_result({group_kpis_key(days): stored}, context, len(keywords))

    return compute


def _with_stability_days(builder: ArtifactBuilder[Any], request: JobRequest) -> ArtifactBuilder[Any]:
    """The insights builder that also stores the stability window the request asks (any ``days``, not only a preset)."""
    days = int(request.params.get('days') or 90)
    if not isinstance(builder, InsightsBuilder):
        return builder
    return replace(builder, presets=tuple(sorted({*STABILITY_PRESETS, days})))


def latest_run_jobs() -> dict[str, JobCompute]:
    """The job of each latest-run route: its builder folded over the scope's KeywordLatest objects."""
    builders = artifact_builders()
    return {
        route: artifacts_job(builders[name], _with_stability_days if name == 'insights' else None)
        for route, name in LATEST_RUN_ROUTES.items()
    }


def mention_job(readers: JobReaders | None) -> JobCompute:
    """A mention route's job: ``compute_mention_view`` over each keyword's selected run."""
    def compute(request: JobRequest, context: JobContext) -> dict[str, Any]:
        if readers is None:
            raise JobInputUnavailable('the SearchResults table is not configured for view jobs')
        return compute_mention_view(request.route, request.params, request.report_scope.keywords, readers, built_at=context.built_at)

    return compute


def view_job_computers(resources: JobResources) -> dict[str, JobCompute]:
    """Every route's view job (see the module docstring)."""
    window: dict[str, Callable[[JobResources], JobCompute]] = dict.fromkeys(TREND_ROUTES, trends_job)
    window[GROUP_KPIS_ROUTE] = group_kpis_job
    mentions = mention_job(resources.mention_readers)
    return {
        **latest_run_jobs(),
        **{route: make(resources) for route, make in window.items()},
        **dict.fromkeys(MENTION_JOB_ROUTES, mentions),
    }


__all__ = [
    'DEFAULT_DAYS',
    'GROUP_KPIS_ROUTE',
    'LATEST_RUN_ROUTES',
    'TREND_ROUTES',
    'JobInputUnavailable',
    'JobResources',
    'group_kpis_job',
    'latest_run_jobs',
    'mention_job',
    'trends_job',
    'view_job_computers',
    'window_tallies',
]
