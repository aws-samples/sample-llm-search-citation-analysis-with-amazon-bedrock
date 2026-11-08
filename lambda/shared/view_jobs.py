"""
View jobs (design 2.45.0 §2.4): a scoped view the snapshot does not hold, computed once in the background.

A job is one ``(route, params, scope, build)``: its id is a digest of the
four, so every caller asking the same question shares it, and a new build
or a scope change asks a new question. Under ``shared.scope_snapshot.JOBS_PREFIX``
(expired by an S3 lifecycle rule)::

    jobs/<job_id>.status.json   {status: computing | failed, started_at, route, params, scope, message?}
    jobs/<job_id>.json.gz       the result, written when the job succeeds

- ``start_job`` writes the status with ``If-None-Match: *`` (only the first
  caller starts the job) and invokes the GenerateSummary Lambda
  asynchronously with ``{"action": "view_job", "job_id": ...}``.
- ``run_view_job`` (that invocation) computes the result with the
  ``JobCompute`` registered for the job's route (``shared.view_job_routes``)
  and stores it. A result is either a body (sent as it is, or finished by the
  route) or, from ``artifacts_job``, the artifacts of a fresh in-memory build
  of the scope (``artifacts_result``), which the route's builder serves and
  pages exactly like a published build (cursors name ``job_build_id``). A
  route without a job, params it cannot answer, or a failure mark the job
  ``failed``; the next GET starts it again. Once the outcome is stored, the
  job calls ``notify`` (GenerateSummary publishes ``view-job.finished``,
  ``shared.view_job_events``), so an export waiting on it resumes.
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Final

from botocore.exceptions import BotoCoreError, ClientError

from shared.keyword_latest import KeywordLatestDoc, canonical_value, read_keyword_latest
from shared.request_deadline import current_deadline
from shared.scope_params import ReportScope
from shared.scope_snapshot import VIEW_JOB_ACTION, job_result_key, job_status_key
from shared.snapshot_artifacts import ArtifactBuilder, MemoryArtifacts, SnapshotScope
from shared.snapshot_store import (
    SnapshotBuildIncomplete,
    bounded_map,
    encode_json,
    get_json,
    is_precondition_failed,
    keyword_fingerprint,
    utc_iso,
)
from shared.view_job_events import STATUS_DONE, FinishedStatus

logger = logging.getLogger(__name__)

#: A ``computing`` status older than this belongs to a job that died: the next GET starts it again.
JOB_STALE_SECONDS = 900
READ_WORKERS = 64
STATUS_COMPUTING = 'computing'
STATUS_FAILED: Final = 'failed'

#: The key of a stored result that holds artifacts (``artifacts_result``) rather than a body.
ARTIFACTS_RESULT = 'artifacts'
#: The prefix of the build id a job's artifacts carry.
JOB_BUILD_PREFIX = 'job-'

#: What a builder may raise in a job; the job is marked failed with the error's name.
_JOB_ERRORS = (NotImplementedError, KeyError, TypeError, ValueError, AttributeError, IndexError, ArithmeticError, SnapshotBuildIncomplete)


def scope_document(report_scope: ReportScope) -> dict[str, Any]:
    """``report_scope`` as a job's status stores it."""
    return {
        'kind': report_scope.kind, 'keywords': list(report_scope.keywords), 'scope': report_scope.scope,
        'label': report_scope.label, 'market_id': report_scope.market_id,
    }


def scope_from_document(document: Mapping[str, Any]) -> ReportScope:
    return ReportScope(
        kind=str(document['kind']), keywords=tuple(document['keywords']), scope=dict(document['scope']),
        label=str(document['label']), market_id=document.get('market_id'),
    )


def job_id(route: str, params: Mapping[str, Any], report_scope: ReportScope, build_id: str | None) -> str:
    """The id every caller asking ``route`` / ``params`` of this scope against build ``build_id`` shares."""
    question = {
        'route': route, 'params': canonical_value(params), 'build': build_id or '', 'market': report_scope.market_id,
        'scope': canonical_value(report_scope.scope), 'kind': report_scope.kind, 'keywords': keyword_fingerprint(report_scope.keywords),
    }
    return hashlib.sha256(json.dumps(question, sort_keys=True, default=str).encode('utf-8')).hexdigest()[:32]


def read_status(s3: Any, bucket: str, job: str) -> dict[str, Any] | None:
    status = get_json(s3, bucket, job_status_key(job), gzipped=False)
    return status if isinstance(status, dict) else None


def read_result(s3: Any, bucket: str, job: str) -> dict[str, Any] | None:
    result = get_json(s3, bucket, job_result_key(job))
    return result if isinstance(result, dict) else None


def _put_status(s3: Any, bucket: str, job: str, status: Mapping[str, Any], **condition: str) -> None:
    s3.put_object(
        Bucket=bucket, Key=job_status_key(job), Body=json.dumps(status, default=str).encode('utf-8'),
        ContentType='application/json', **condition,
    )


def is_dead(status: Mapping[str, Any], now: datetime) -> bool:
    """Whether a ``computing`` status is too old to belong to a running job."""
    try:
        started = datetime.fromisoformat(str(status.get('started_at')))
    except ValueError:
        return True
    return (now - started).total_seconds() >= JOB_STALE_SECONDS


@dataclass(frozen=True)
class JobRequest:
    """What a job computes."""

    route: str
    params: Mapping[str, Any]
    report_scope: ReportScope


def start_job(s3: Any, bucket: str, lambda_client: Any, function_name: str, job: str, request: JobRequest, now: datetime) -> dict[str, Any]:
    """Start job ``job`` unless another caller just did; the status now stored (``computing``)."""
    status = {
        'status': STATUS_COMPUTING, 'started_at': utc_iso(now), 'route': request.route,
        'params': canonical_value(request.params), 'scope': scope_document(request.report_scope),
    }
    try:
        _put_status(s3, bucket, job, status, IfNoneMatch='*')
    except ClientError as error:
        if not is_precondition_failed(error):
            raise
        return read_status(s3, bucket, job) or status
    lambda_client.invoke(
        FunctionName=function_name, InvocationType='Event',
        Payload=json.dumps({'action': VIEW_JOB_ACTION, 'job_id': job}).encode('utf-8'),
    )
    return status


def clear_status(s3: Any, bucket: str, job: str) -> None:
    """Forget a failed or dead job, so the next GET starts it again."""
    s3.delete_object(Bucket=bucket, Key=job_status_key(job))


# ---------------------------------------------------------------------------
# The job itself
# ---------------------------------------------------------------------------

def job_scope(report_scope: ReportScope) -> SnapshotScope:
    """The ``SnapshotScope`` a job folds for ``report_scope``."""
    group_ids = report_scope.scope.get('group_ids') or []
    if report_scope.kind == 'group':
        return SnapshotScope(f'job-{report_scope.label}', 'group', str(group_ids[0]) if len(group_ids) == 1 else None, report_scope.market_id, len(report_scope.keywords))
    kind = 'all' if report_scope.market_id is None else 'market'
    return SnapshotScope(f'job-{report_scope.label}', kind, None, report_scope.market_id, len(report_scope.keywords))


@dataclass(frozen=True)
class JobContext:
    """Where a job runs: the bucket its KeywordLatest objects and its result live in, its id and when it computes."""

    s3: Any
    bucket: str
    job: str
    built_at: str

    @property
    def build_id(self) -> str:
        """The build id the job's artifacts carry (snapshot cursors over a job result name it)."""
        return job_build_id(self.job)

    def latests(self, keywords: tuple[str, ...]) -> Iterator[KeywordLatestDoc]:
        """The KeywordLatest objects of ``keywords`` (a keyword without one is left out), read in parallel under the job's deadline."""
        def read(keyword: str) -> KeywordLatestDoc | None:
            return read_keyword_latest(self.s3, self.bucket, keyword)[0]

        for _, doc in bounded_map(read, keywords, READ_WORKERS):
            if current_deadline().stop_reading('a view job fold'):
                raise SnapshotBuildIncomplete('Time budget spent before the view job read every keyword')
            if doc is not None:
                yield doc


JobCompute = Callable[[JobRequest, JobContext], dict[str, Any] | None]
"""What a job computes for its route: the result to store (``None``: these params cannot be answered, the job fails)."""


def job_build_id(job: str) -> str:
    return f'{JOB_BUILD_PREFIX}{job}'


def is_job_build(build_id: str) -> bool:
    """Whether ``build_id`` names a view job's artifacts rather than a published build."""
    return build_id.startswith(JOB_BUILD_PREFIX)


def artifacts_result(artifacts: Mapping[str, Any], context: JobContext, keywords_total: int) -> dict[str, Any]:
    """The stored result of a job that computes artifacts: the route's builder serves (and pages) it like a build."""
    return {ARTIFACTS_RESULT: dict(artifacts), 'build_id': context.build_id, 'built_at': context.built_at, 'keywords_total': keywords_total}


def result_artifacts(result: Mapping[str, Any]) -> MemoryArtifacts | None:
    """The artifacts an ``artifacts_result`` holds, or ``None`` when ``result`` is a body."""
    artifacts = result.get(ARTIFACTS_RESULT)
    if not isinstance(artifacts, Mapping):
        return None
    return MemoryArtifacts(artifacts, str(result.get('build_id')), str(result.get('built_at')), int(result.get('keywords_total') or 0))


def fold_job(builder: ArtifactBuilder[Any], request: JobRequest, context: JobContext) -> dict[str, Any]:
    """``builder``'s artifacts of the request's scope, folded from its KeywordLatest objects now."""
    # Imported here: the registry loads every builder and partial, which a router serving live never needs (cold start).
    from shared.artifact_registry import fold_scope

    return fold_scope([builder], context.latests(request.report_scope.keywords), job_scope(request.report_scope))


def artifacts_job(builder: ArtifactBuilder[Any], configure: Callable[[ArtifactBuilder[Any], JobRequest], ArtifactBuilder[Any]] | None = None) -> JobCompute:
    """A job that stores ``builder``'s fresh artifacts of the scope (``configure`` adapts the builder to the request first)."""
    def compute(request: JobRequest, context: JobContext) -> dict[str, Any]:
        chosen = builder if configure is None else configure(builder, request)
        return artifacts_result(fold_job(chosen, request, context), context, len(request.report_scope.keywords))

    return compute


def body_job(builder: ArtifactBuilder[Any]) -> JobCompute:
    """A job that stores the body ``builder`` serves for the params from a fresh in-memory build (sent as the 200 as it is)."""
    def compute(request: JobRequest, context: JobContext) -> dict[str, Any] | None:
        built = MemoryArtifacts(fold_job(builder, request, context), context.build_id, context.built_at, len(request.report_scope.keywords))
        return builder.serve(built, request.params)

    return compute


def builder_jobs(builders: Mapping[str, ArtifactBuilder[Any]]) -> dict[str, JobCompute]:
    """A ``body_job`` per builder, by its name."""
    return {name: body_job(builder) for name, builder in builders.items()}


JobNotify = Callable[[str, str, FinishedStatus], object]
"""Told ``(job id, the run's started_at, done | failed)`` once a job's outcome is stored."""


def _no_notify(_job: str, _started_at: str, _status: FinishedStatus) -> None:
    return None


def run_view_job(
    s3: Any, bucket: str, job: str, *, computers: Mapping[str, JobCompute],
    now: Callable[[], datetime] = lambda: datetime.now(UTC), notify: JobNotify = _no_notify,
) -> dict[str, Any]:
    """
    Compute job ``job`` (its status names the question) with the ``computers`` entry of its route; the job's summary.

    ``notify`` hears the outcome after it is stored: ``done`` after the
    result, ``failed`` after the failed status, and ``failed`` when the result
    could not be stored (the status is cleared, so the next GET starts the job again).
    """
    status = read_status(s3, bucket, job)
    if status is None or status.get('status') != STATUS_COMPUTING:
        return {'job_id': job, 'status': 'skipped'}
    started_at = str(status.get('started_at'))
    request = JobRequest(str(status['route']), dict(status.get('params') or {}), scope_from_document(status['scope']))
    compute = computers.get(request.route)
    try:
        if compute is None:
            raise KeyError(f'no view job for the route {request.route!r}')
        body = compute(request, JobContext(s3, bucket, job, utc_iso(now())))
        if body is None:
            raise ValueError(f'{request.route} cannot answer these parameters')
        payload = encode_json(body)
    except _JOB_ERRORS as error:
        logger.warning('View job %s (%s) failed: %s', job, request.route, error)
        _put_status(s3, bucket, job, {**status, 'status': STATUS_FAILED, 'message': f'The view could not be computed ({type(error).__name__})'})
        notify(job, started_at, STATUS_FAILED)
        return {'job_id': job, 'status': STATUS_FAILED, 'error': type(error).__name__}
    try:
        s3.put_object(Bucket=bucket, Key=job_result_key(job), Body=payload, ContentType='application/gzip')
    except (ClientError, BotoCoreError):
        logger.exception('View job %s: result not stored', job)
        clear_status(s3, bucket, job)
        notify(job, started_at, STATUS_FAILED)
        raise
    notify(job, started_at, STATUS_DONE)
    return {'job_id': job, 'status': 'done', 'route': request.route, 'keywords': len(request.report_scope.keywords)}


__all__ = [
    'ARTIFACTS_RESULT',
    'JOB_STALE_SECONDS',
    'STATUS_COMPUTING',
    'STATUS_FAILED',
    'JobCompute',
    'JobContext',
    'JobNotify',
    'JobRequest',
    'MemoryArtifacts',
    'artifacts_job',
    'artifacts_result',
    'body_job',
    'builder_jobs',
    'clear_status',
    'fold_job',
    'is_dead',
    'is_job_build',
    'job_build_id',
    'job_id',
    'job_scope',
    'read_result',
    'read_status',
    'result_artifacts',
    'run_view_job',
    'scope_document',
    'scope_from_document',
    'start_job',
]
