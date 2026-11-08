"""
The ``build_scope_snapshots`` and ``view_job`` actions of the GenerateSummary Lambda (design 2.45.0 §2.2-§2.4).

- ``{"action": "build_scope_snapshots", ...}``: the ``BuildScopeSnapshots``
  workflow state after KpiAlerts, an asynchronous request from a reader that
  found the build stale, or the end of a chained ``latest`` backfill. Builds
  ``shared.scope_snapshot_build.build_snapshots`` under a deadline that ends
  ``BUILD_MARGIN_SECONDS`` before the Lambda's timeout, so a build that cannot
  finish raises before switching ``current.json``. A build heavier than one
  invocation (``shared.scope_snapshot_dist.needs_distribution``) starts the
  distributed build instead when ``SCOPE_SNAPSHOT_BUILD_STATE_MACHINE_ARN`` is
  set (``snapshot_build_steps``).
- ``{"action": "view_job", "job_id": "..."}``: started by a GET the snapshot
  cannot answer (``shared.scope_snapshot_serve.view_job_response``); computes
  and stores that one view (``shared.view_jobs.run_view_job``).

Environment: ``SCOPE_SNAPSHOT_BUCKET`` (else ``SUMMARY_BUCKET``, the same
keywords bucket), ``DYNAMODB_TABLE_KEYWORDS``, ``DYNAMODB_TABLE_BRAND_CONFIG``,
``DYNAMODB_TABLE_QUERY_PROMPTS`` (enabled personas), for the series history
and the window view jobs ``DYNAMODB_TABLE_KEYWORD_RUN_KPIS`` /
``DYNAMODB_TABLE_KEYWORD_RUN_BRANDS`` (either unset: no history read; the
series fills from the KeywordLatest runs, a window job fails), and for the
mention view jobs and the build's check of each keyword's newest run
``DYNAMODB_TABLE_SEARCH_RESULTS``; ``KEYWORD_LATEST_BACKFILL_FUNCTION`` (the
Deduplication Lambda) is where the build asks for the ``latest`` backfill of
keywords whose KeywordLatest object lacks their newest run.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from collections.abc import Mapping
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from shared.keyword_run_brands import keyword_run_brands_table
from shared.keyword_run_kpis import keyword_run_kpis_table
from shared.kpi_engine import owned_domains_from
from shared.mention_row_reads import job_readers
from shared.request_deadline import Deadline, activate_deadline, budget_from_context, clear_request_deadline
from shared.scope_params import keywords_table_name, scoped_dynamodb_resource
from shared.scope_series_build import SeriesBuildIncomplete
from shared.scope_series_store import stored_history
from shared.scope_snapshot import BUILD_ACTION, PersonaCache, query_prompts_table, snapshot_bucket, snapshot_s3_client
from shared.scope_snapshot_build import READ_WORKERS, SnapshotSources, build_snapshots, newest_search_run
from shared.scope_snapshot_dist import needs_distribution
from shared.snapshot_triggers import start_keyword_latest_backfill
from shared.utils import get_brand_config
from shared.view_job_routes import JobResources, view_job_computers
from shared.view_jobs import run_view_job

logger = logging.getLogger(__name__)

#: Seconds kept back from the Lambda's timeout: the build or job stops before them.
BUILD_MARGIN_SECONDS = 30.0
#: How many times a build whose series step ran out of time starts the next one itself.
MAX_SERIES_RESUMES = 8
#: The build reason of the build a finished ``latest`` backfill starts: it asks for no backfill itself (no loop).
BACKFILL_BUILD_REASON = 'keyword_latest_backfill'


class SnapshotConfigurationError(RuntimeError):
    """The Lambda has no bucket to build the scope snapshots in."""


def _bucket() -> str:
    bucket = snapshot_bucket() or os.environ.get('SUMMARY_BUCKET')
    if not bucket:
        raise SnapshotConfigurationError('Set SCOPE_SNAPSHOT_BUCKET or SUMMARY_BUCKET to build the scope snapshots')
    return bucket


def _s3() -> Any:
    return snapshot_s3_client(READ_WORKERS)


def _backfill_behind(keywords: list[str]) -> bool:
    return start_keyword_latest_backfill('scope snapshot: keywords behind their runs', keywords=keywords)


def snapshot_sources(deadline: Deadline, event: Mapping[str, Any] | None = None) -> SnapshotSources:
    """The tables, bucket, brand config and personas from the environment.

    With ``DYNAMODB_TABLE_SEARCH_RESULTS`` set the build checks each keyword's
    newest run against its KeywordLatest object, and asks for the ``latest``
    backfill of those left behind unless the build was started by that backfill.
    """
    dynamodb = scoped_dynamodb_resource()
    rollups = keyword_run_kpis_table(dynamodb)
    history = None if rollups is None else stored_history(rollups, keyword_run_brands_table(dynamodb), deadline)
    search_results = os.environ.get('DYNAMODB_TABLE_SEARCH_RESULTS')
    citations = os.environ.get('DYNAMODB_TABLE_CITATIONS')
    from_backfill = (event or {}).get('reason') == BACKFILL_BUILD_REASON
    return SnapshotSources(
        keywords_table=dynamodb.Table(keywords_table_name()),
        s3=_s3(),
        bucket=_bucket(),
        brand_config=get_brand_config(os.environ.get('DYNAMODB_TABLE_BRAND_CONFIG')),
        personas=PersonaCache(lambda: query_prompts_table(dynamodb)).ids(),
        history=history,
        newest_run=newest_search_run(dynamodb.Table(search_results)) if search_results else None,
        request_backfill=None if from_backfill else _backfill_behind,
        citations_table=dynamodb.Table(citations) if citations else None,
        rollup_bucket=os.environ.get('CITATION_ROLLUP_BUCKET') or None,
    )


def _resume(event: Mapping[str, Any], context: Any, error: SeriesBuildIncomplete) -> bool:
    """Start the next build to resume the series ``error`` saved; whether it was started (never raises)."""
    resumes = int(event.get('series_resumes') or 0)
    function_name = getattr(context, 'invoked_function_arn', None)
    if error.scopes_saved <= 0 or resumes >= MAX_SERIES_RESUMES or not function_name:
        return False
    payload = {'action': BUILD_ACTION, 'reason': 'resume the scope series', 'series_resumes': resumes + 1}
    try:
        boto3.client('lambda').invoke(FunctionName=function_name, InvocationType='Event', Payload=json.dumps(payload).encode('utf-8'))
    except (ClientError, BotoCoreError):
        logger.exception('Could not start the build that resumes the scope series')
        return False
    return True


def _execution_name(event: Mapping[str, Any]) -> str | None:
    """A name every request of one workflow run shares (its snapshot and rollup actions start ONE build); ``None`` for other requests."""
    execution = event.get('execution_id')
    return f'run-{hashlib.sha256(str(execution).encode("utf-8")).hexdigest()[:32]}' if execution else None


def build_state_machine_arn() -> str:
    """The distributed build's state machine (``CitationAnalysis-ScopeSnapshotBuild``); ``''``: every build runs in process."""
    return os.environ.get('SCOPE_SNAPSHOT_BUILD_STATE_MACHINE_ARN', '')


def start_distributed_build(sources: SnapshotSources, event: Mapping[str, Any]) -> dict[str, Any] | None:
    """Start the distributed build (snapshots and citation rollup) when it is deployed and the tenant needs it; ``None``: build in process.

    One distributed build runs at a time: while one runs, the request is answered ``running`` (the next
    stale read asks again). The snapshot and rollup actions of one workflow run start it under one
    execution name, so the second is answered ``running`` even when both checked before either started.
    """
    state_machine = build_state_machine_arn()
    if not state_machine or not needs_distribution(sources):
        return None
    client = boto3.client('stepfunctions')
    running = client.list_executions(stateMachineArn=state_machine, statusFilter='RUNNING', maxResults=1).get('executions') or []
    if running:
        return {'status': 'running', 'execution': running[0]['executionArn']}
    name = _execution_name(event)
    reason = f'run {event["execution_id"]}' if name else str(event.get('reason') or 'build')
    params: dict[str, Any] = {'stateMachineArn': state_machine, 'input': json.dumps({'reason': reason})}
    if name:
        params['name'] = name
    try:
        started = client.start_execution(**params)
    except ClientError as error:
        if error.response.get('Error', {}).get('Code') != 'ExecutionAlreadyExists':
            raise
        return {'status': 'running', 'execution': name}
    logger.info('Distributed build started (%s)', started['executionArn'])
    return {'status': 'started', 'execution': started['executionArn']}


def build_scope_snapshots(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Build and publish the scope snapshots; the build summary (``status``, ``build_id``, counts, ``seconds``).

    A build whose series step runs out of time after saving some scopes
    answers ``status: incomplete`` and starts the next build itself (at most
    ``MAX_SERIES_RESUMES`` in a row), which resumes from the saved series.
    """
    logger.info('Building the scope snapshots (%s)', event.get('reason') or event.get('execution_id') or 'direct')
    deadline = Deadline(budget_from_context(context, BUILD_MARGIN_SECONDS))
    activate_deadline(deadline)
    try:
        sources = snapshot_sources(deadline, event)
        summary = start_distributed_build(sources, event) or build_snapshots(sources)
    except SeriesBuildIncomplete as error:
        if error.scopes_saved <= 0:
            raise
        summary = {'status': 'incomplete', 'reason': str(error), 'series_saved': error.scopes_saved, 'resumed': _resume(event, context, error)}
    finally:
        clear_request_deadline()
    logger.info('Scope snapshots: %s', summary)
    return summary


def job_resources(deadline: Deadline) -> JobResources:
    """What the view jobs read besides the KeywordLatest objects, from the environment (a table not set: the routes that need it fail their job)."""
    dynamodb = scoped_dynamodb_resource()
    rollups = keyword_run_kpis_table(dynamodb)
    search_results = os.environ.get('DYNAMODB_TABLE_SEARCH_RESULTS')
    return JobResources(
        history=None if rollups is None else stored_history(rollups, keyword_run_brands_table(dynamodb), deadline),
        owned_domains=owned_domains_from(get_brand_config(os.environ.get('DYNAMODB_TABLE_BRAND_CONFIG'))),
        mention_readers=job_readers(dynamodb, search_results) if search_results else None,
    )


def view_job(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Compute the view job ``event['job_id']`` with its route's computation (``shared.view_job_routes``); the job's summary."""
    job = str(event.get('job_id') or '')
    if not job:
        return {'status': 'skipped', 'reason': 'no job_id'}
    deadline = Deadline(budget_from_context(context, BUILD_MARGIN_SECONDS))
    activate_deadline(deadline)
    try:
        summary = run_view_job(_s3(), _bucket(), job, computers=view_job_computers(job_resources(deadline)))
    finally:
        clear_request_deadline()
    logger.info('View job: %s', summary)
    return summary
