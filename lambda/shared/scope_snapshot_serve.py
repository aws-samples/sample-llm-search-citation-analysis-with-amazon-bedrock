"""
Serving scoped views from the scope snapshot (design 2.45.0 §2.2-§2.5).

The handlers of tracks S2-S4 call, after ``shared.scope_source.route_scope``
answered ``'snapshot'``::

    artifacts = open_snapshot(report_scope, brand_config_updated_at)
    body = None if artifacts is None else BUILDER.serve(artifacts, params)
    if body is None:
        return view_job_response(ROUTE, params, report_scope, event)
    return success_response(body, event)

``open_snapshot`` reads ``current.json`` (cached ``POINTER_TTL_SECONDS``) and
answers the build of the scope (``shared.snapshot_store.named_scope_key``):

- **fresh** when the scope's keyword fingerprint, the brand config's
  ``updated_at`` and the enabled personas all match the build and every
  KeywordLatest object it folded was built for the current configuration;
- **stale** otherwise (``stale: true``; ``refreshing: true`` where a rebuild
  can run). A keyword, brand-config or persona change also requests a rebuild,
  debounced to one per ``REBUILD_DEBOUNCE_SECONDS`` across containers;
- ``None`` when no build holds the scope (none yet, or the scope grew past the
  live budget since the last build): a rebuild is requested and the caller
  answers with a view job.

List pages over a build use ``snapshot_page``: a cursor of a build the store
still keeps (current or previous) reads that build, any other is ``cursor_expired``.

Environment: ``SCOPE_SNAPSHOT_BUCKET``, ``SCOPE_SNAPSHOT_FUNCTION_NAME`` (the
GenerateSummary Lambda: rebuilds and view jobs), ``DYNAMODB_TABLE_QUERY_PROMPTS``.
"""

from __future__ import annotations

import functools
import logging
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any

import boto3

from shared.api_response import api_response, success_response
from shared.keyword_latest import personas_fingerprint
from shared.scope_params import ReportScope
from shared.scope_snapshot import (
    BUILD_ACTION,
    PersonaCache,
    artifact_key,
    manifest_key,
    query_prompts_table,
    series_key,
    snapshot_bucket,
    snapshot_function_name,
    snapshot_store,
)
from shared.snapshot_artifacts import (
    SnapshotArtifacts,
    SnapshotCursor,
    computing_response,
    cursor_expired_response,
    decode_snapshot_cursor,
    failed_job_body,
    snapshot_page_start,
)
from shared.snapshot_cache import OBJECT_CACHE
from shared.snapshot_store import (
    STORE_READ_ERRORS,
    PointerCache,
    RebuildRequester,
    RebuildTarget,
    SnapshotStore,
    get_json,
    keyword_fingerprint,
    named_scope_key,
)
from shared.view_jobs import (
    JobRequest,
    clear_status,
    is_dead,
    is_job_build,
    job_id,
    read_result,
    read_status,
    result_artifacts,
    start_job,
)

logger = logging.getLogger(__name__)

NOT_DEPLOYED_MESSAGE = 'Precomputed views are not available in this deployment'
START_FAILED_MESSAGE = 'The view could not be started; try again'
UNANSWERED_MESSAGE = 'The view could not be computed for these parameters'
SERIES_ARTIFACT = 'series'
"""The ``load`` key of the scope's per-run series (``shared.scope_series`` document), stored outside the build."""
#: Stale reasons a rebuild does not fix: the KeywordLatest backfill does, and it starts the build once done.
_BACKFILL_REASONS = frozenset({'keyword_latest_config', 'keywords_behind'})


@dataclass
class StoredArtifacts:
    """One scope of a published build (``shared.snapshot_artifacts.SnapshotArtifacts``).

    Each artifact is read at most once per request, and decoded objects are
    shared across the container's requests (``shared.snapshot_cache``): read-only.
    """

    store: SnapshotStore
    build_id: str
    built_at: str
    scope_dir: str
    keywords_total: int
    series_id: str | None
    kept_builds: frozenset[str]
    stale: bool = False
    refreshing: bool = False
    keywords_analyzed: int = 0
    keywords_behind: int = 0
    """Member keywords whose newest run the build lacks (a KeywordLatest write failed); the coverage leaves them out."""
    _loaded: dict[str, Any] = field(default_factory=dict, repr=False)

    def load(self, key: str) -> Any | None:
        if key not in self._loaded:
            self._loaded[key] = self._read(key)
        return self._loaded[key]

    def _read(self, key: str) -> Any | None:
        if key == SERIES_ARTIFACT:
            object_key = None if not self.series_id else series_key(self.scope_dir, self.series_id)
        else:
            object_key = artifact_key(self.build_id, self.scope_dir, key)
        if object_key is None:
            return None
        try:
            return OBJECT_CACHE.get(self.store.s3, self.store.bucket, object_key)
        except STORE_READ_ERRORS:
            logger.exception('Scope snapshot: artifact %s of build %s not readable', key, self.build_id)
            return None

    def at_build(self, build_id: str) -> StoredArtifacts:
        """The same scope in another build the store keeps (a cursor's build): that build's own metadata, nothing loaded yet.

        The metadata (keyword counts, series, ``as_of``) comes from the build's
        ``manifest.json``; an older build is ``stale`` (a newer one is published).
        A build written before manifests existed keeps the current metadata.
        """
        if build_id == self.build_id:
            return self
        try:
            manifest = get_json(self.store.s3, self.store.bucket, manifest_key(build_id), gzipped=False)
        except STORE_READ_ERRORS:
            logger.exception('Scope snapshot: the manifest of build %s is not readable', build_id)
            manifest = None
        entry = _scope_entry(manifest, self.scope_dir)
        if entry is None or not isinstance(manifest, dict):
            return replace(self, build_id=build_id, stale=True, _loaded={})
        return replace(
            self, build_id=build_id, built_at=str(manifest.get('built_at') or self.built_at), keywords_total=int(entry['keywords_total']),
            series_id=entry.get('series'), keywords_analyzed=int(entry.get('keywords_analyzed') or 0),
            keywords_behind=int(entry.get('keywords_behind') or 0), stale=True, _loaded={},
        )


def _scope_entry(current: Any, directory: str) -> Mapping[str, Any] | None:
    """The ``scopes`` entry of ``current`` whose ``dir`` is ``directory``."""
    scopes = current.get('scopes') if isinstance(current, dict) else None
    if not isinstance(scopes, dict):
        return None
    return next((entry for entry in scopes.values() if isinstance(entry, dict) and entry.get('dir') == directory), None)


def stale_reasons(
    current: Mapping[str, Any], entry: Mapping[str, Any], report_scope: ReportScope,
    brand_config_updated_at: str | None, personas: str,
) -> list[str]:
    """Why a build no longer matches the scope, the brand config or the personas (empty: fresh)."""
    reasons = []
    if entry.get('fingerprint') != keyword_fingerprint(report_scope.keywords):
        reasons.append('keywords')
    if brand_config_updated_at is not None and current.get('brand_config_updated_at') != brand_config_updated_at:
        reasons.append('brand_config')
    if current.get('personas') != personas:
        reasons.append('personas')
    if int(current.get('keywords_stale_config') or 0) > 0:
        reasons.append('keyword_latest_config')
    if int(entry.get('keywords_behind') or 0) > 0:
        reasons.append('keywords_behind')
    return reasons


def _kept(current: Mapping[str, Any]) -> frozenset[str]:
    return frozenset(str(build) for build in (current.get('build_id'), current.get('previous_build_id')) if build)


class SnapshotReader:
    """What one container reads the snapshot with: the store, the cached pointer, the rebuild debounce and the personas."""

    def __init__(
        self, s3: Any, bucket: str, lambda_client: Any, function_name: str | None, personas: Callable[[], tuple[str, ...]], *,
        clock: Callable[[], float] = time.monotonic, wall_clock: Callable[[], float] = time.time,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self.store = snapshot_store(s3, bucket)
        self.pointer = PointerCache(self.store, clock)
        self.rebuild = RebuildRequester(self.store, RebuildTarget(lambda_client, function_name, BUILD_ACTION), clock=clock, wall_clock=wall_clock)
        self.lambda_client = lambda_client
        self.function_name = function_name
        self.personas = personas
        self.now = now

    def _current(self) -> dict[str, Any] | None:
        try:
            return self.pointer.current()
        except STORE_READ_ERRORS:
            logger.exception('Scope snapshot: current.json not readable')
            return None

    def open(self, report_scope: ReportScope, brand_config_updated_at: str | None) -> StoredArtifacts | None:
        key = named_scope_key(report_scope)
        if key is None:
            return None
        current = self._current()
        entry = None if current is None else (current.get('scopes') or {}).get(key)
        if current is None or not isinstance(entry, dict):
            self.rebuild.request(f'no build of {key}')
            return None
        reasons = stale_reasons(current, entry, report_scope, brand_config_updated_at, personas_fingerprint(self.personas()))
        if set(reasons) - _BACKFILL_REASONS:
            self.rebuild.request(f'{key} stale: {", ".join(reasons)}')
        return StoredArtifacts(
            self.store, str(current['build_id']), str(current['built_at']), str(entry['dir']), int(entry['keywords_total']),
            entry.get('series'), _kept(current), stale=bool(reasons), refreshing=bool(reasons) and self.rebuild.enabled,
            keywords_analyzed=int(entry.get('keywords_analyzed') or 0), keywords_behind=int(entry.get('keywords_behind') or 0),
        )

    def job_result(self, route: str, params: Mapping[str, Any], report_scope: ReportScope, event: dict[str, Any] | None) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        """The stored result of the view job for ``route`` / ``params`` (``(result, None)``), or ``(None, response)``: 202 computing (starting the job) or 200 failed once."""
        if not self.function_name:
            return None, success_response(failed_job_body(NOT_DEPLOYED_MESSAGE), event)
        current = self._current()
        job = job_id(route, params, report_scope, None if current is None else str(current.get('build_id')))
        s3, bucket = self.store.s3, self.store.bucket
        try:
            result = read_result(s3, bucket, job)
            if result is not None:
                return result, None
            status = read_status(s3, bucket, job)
            if status is not None and status.get('status') == 'failed':
                clear_status(s3, bucket, job)
                return None, success_response(failed_job_body(str(status.get('message') or 'The view could not be computed')), event)
            if status is not None and not is_dead(status, self.now()):
                return None, computing_response(job, str(status['started_at']), event)
            if status is not None:
                clear_status(s3, bucket, job)
            started = start_job(s3, bucket, self.lambda_client, self.function_name, job, JobRequest(route, params, report_scope), self.now())
        except STORE_READ_ERRORS:
            logger.exception('View job %s (%s) could not be read or started', job, route)
            return None, success_response(failed_job_body(START_FAILED_MESSAGE), event)
        return None, computing_response(job, str(started['started_at']), event)

    def view_job(self, route: str, params: Mapping[str, Any], report_scope: ReportScope, event: dict[str, Any] | None) -> dict[str, Any]:
        result, response = self.job_result(route, params, report_scope, event)
        if result is not None:
            return success_response(result, event)
        return response or success_response(failed_job_body(START_FAILED_MESSAGE), event)


@functools.cache
def _reader(bucket: str, function_name: str | None) -> SnapshotReader:
    dynamodb = boto3.resource('dynamodb')
    personas = PersonaCache(lambda: query_prompts_table(dynamodb))
    return SnapshotReader(boto3.client('s3'), bucket, boto3.client('lambda'), function_name, personas.ids)


def reader() -> SnapshotReader | None:
    """This container's ``SnapshotReader``, or ``None`` where the snapshot is not deployed (``SCOPE_SNAPSHOT_BUCKET`` unset)."""
    bucket = snapshot_bucket()
    return None if bucket is None else _reader(bucket, snapshot_function_name())


def open_snapshot(report_scope: ReportScope, brand_config_updated_at: str | None) -> SnapshotArtifacts | None:
    """The current build of ``report_scope`` (``stale`` set and a rebuild requested when it no longer matches), or ``None`` when no build holds it."""
    current_reader = reader()
    return None if current_reader is None else current_reader.open(report_scope, brand_config_updated_at)


def view_job_response(route: str, params: Mapping[str, Any], report_scope: ReportScope, event: dict[str, Any] | None) -> dict[str, Any]:
    """The view job's answer for ``route`` / ``params``: 200 with the stored result, 200 ``failed`` once, or 202 ``computing`` (starting the job).

    ``route`` is the name of the artifact builder that computes the view.
    """
    current_reader = reader()
    if current_reader is None:
        return api_response(200, failed_job_body(NOT_DEPLOYED_MESSAGE), event)
    return current_reader.view_job(route, params, report_scope, event)


def view_job_artifacts(
    route: str, params: Mapping[str, Any], report_scope: ReportScope, event: dict[str, Any] | None,
) -> tuple[SnapshotArtifacts | None, dict[str, Any] | None]:
    """The artifacts the view job for ``route`` / ``params`` computed (``(artifacts, None)``), or ``(None, response)`` while it is not ready.

    The route's builder serves (and pages) them like a published build; their
    ``build_id`` is the job's (``shared.view_jobs.job_build_id``). A job whose
    result is a body, not artifacts, answers ``(None, its 200)``.
    """
    current_reader = reader()
    if current_reader is None:
        return None, api_response(200, failed_job_body(NOT_DEPLOYED_MESSAGE), event)
    result, response = current_reader.job_result(route, params, report_scope, event)
    if result is None:
        return None, response
    artifacts = result_artifacts(result)
    return (artifacts, None) if artifacts is not None else (None, success_response(result, event))


def job_cursor(token: str | None) -> SnapshotCursor | None:
    """The snapshot cursor ``token`` decodes to when it pages a view job's artifacts (``None`` otherwise)."""
    cursor = None if token is None else decode_snapshot_cursor(token)
    return cursor if cursor is not None and is_job_build(cursor.build_id) else None


JobServe = Callable[[SnapshotArtifacts, int], dict[str, Any] | None]
"""The route's builder serving the page at an offset of a job's artifacts."""


def serve_view_job(
    route: str, params: Mapping[str, Any], report_scope: ReportScope, event: dict[str, Any] | None,
    serve: JobServe, cursor: SnapshotCursor | None = None,
) -> tuple[dict[str, Any], SnapshotArtifacts] | dict[str, Any]:
    """The body ``serve`` gives over the view job's artifacts (at ``cursor``'s offset) and those artifacts, or the response to send instead.

    That response is the job's 202 / failed answer while it is not ready, a
    ``cursor_expired`` 400 when ``cursor`` names another job's artifacts (the
    scope or the build moved on), the job's own 200 when its result is a body,
    or a failed answer when the artifacts cannot answer the params.
    """
    artifacts, response = view_job_artifacts(route, params, report_scope, event)
    if artifacts is None:
        return response or api_response(200, failed_job_body(START_FAILED_MESSAGE), event)
    if cursor is not None and cursor.build_id != artifacts.build_id:
        return cursor_expired_response(event)
    body = serve(artifacts, 0 if cursor is None else cursor.offset)
    if body is None:
        return success_response(failed_job_body(UNANSWERED_MESSAGE), event)
    return body, artifacts


@dataclass(frozen=True)
class Answer:
    """What a scoped request answers: a 200 ``body``, or a whole API ``response`` (202 view job, 400 cursor)."""

    body: dict[str, Any] | None = None
    response: dict[str, Any] | None = None


@dataclass(frozen=True)
class SnapshotRequest:
    """One snapshot-served request: the route (its view-job name), the builder, its params and the page asked for."""

    route: str
    builder: str
    params: Mapping[str, Any]
    report_scope: ReportScope
    brand_config_updated_at: str | None
    event: dict[str, Any] | None
    next_token: str | None = None
    job_params: Mapping[str, Any] | None = None
    """The params the view job computes from (default ``params``): leave out what only picks the page or list served
    (``view``, ``page_size``) so every list of one job's artifacts pages with that job's tokens."""


def serve_snapshot_request(request: SnapshotRequest) -> tuple[dict[str, Any], SnapshotArtifacts] | dict[str, Any]:
    """The body ``request.builder`` serves for the page ``request.next_token`` asks and the artifacts it came from, or the response to send instead.

    The current build of the scope answers. When no build holds the scope,
    or the builder cannot answer from it, a view job computes the artifacts
    and the same builder pages them (a ``next_token`` of a job's artifacts
    reads them again); while it runs the response is its 202 / failed
    answer. A malformed cursor, or one of a build the store no longer keeps,
    is a 400.
    """
    def serve(artifacts: SnapshotArtifacts, offset: int) -> dict[str, Any] | None:
        # Imported here: the registry loads every builder and partial, which a request served live never needs (cold start).
        from shared import artifact_registry

        return artifact_registry.serve_view(request.builder, artifacts, {**request.params, 'offset': offset})

    def from_job(cursor: SnapshotCursor | None = None) -> tuple[dict[str, Any], SnapshotArtifacts] | dict[str, Any]:
        job_params = request.params if request.job_params is None else request.job_params
        return serve_view_job(request.route, job_params, request.report_scope, request.event, serve, cursor)

    paging_job = job_cursor(request.next_token)
    if paging_job is not None:
        return from_job(paging_job)
    artifacts = open_snapshot(request.report_scope, request.brand_config_updated_at)
    if artifacts is None:
        return from_job()
    cursor, rejected = snapshot_page_start(request.next_token, artifacts.build_id, (), request.event)
    if rejected is not None or cursor is None:
        return rejected or {}
    body = serve(artifacts, cursor.offset)
    return from_job() if body is None else (body, artifacts)


def request_snapshot_rebuild(reason: str) -> bool:
    """For a writer that just changed keywords, groups, markets or personas: ask for a rebuild now (debounced); whether one was started."""
    current_reader = reader()
    return False if current_reader is None else current_reader.rebuild.request(reason)


def snapshot_page(
    token: str | None, artifacts: SnapshotArtifacts, event: dict[str, Any] | None = None,
) -> tuple[SnapshotCursor | None, SnapshotArtifacts, dict[str, Any] | None]:
    """Where a list page over ``artifacts`` starts and which build it reads: ``(cursor, artifacts of the cursor's build, None)`` or ``(None, artifacts, 400)``."""
    kept = artifacts.kept_builds if isinstance(artifacts, StoredArtifacts) else frozenset()
    cursor, error = snapshot_page_start(token, artifacts.build_id, kept, event)
    if cursor is None or cursor.build_id == artifacts.build_id or not isinstance(artifacts, StoredArtifacts):
        return cursor, artifacts, error
    return cursor, artifacts.at_build(cursor.build_id), None


__all__ = [
    'NOT_DEPLOYED_MESSAGE',
    'SERIES_ARTIFACT',
    'Answer',
    'JobServe',
    'SnapshotReader',
    'SnapshotRequest',
    'StoredArtifacts',
    'job_cursor',
    'open_snapshot',
    'reader',
    'request_snapshot_rebuild',
    'serve_snapshot_request',
    'serve_view_job',
    'snapshot_page',
    'stale_reasons',
    'view_job_artifacts',
    'view_job_response',
]
