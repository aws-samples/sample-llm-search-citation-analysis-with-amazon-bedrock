"""
The scope snapshot's layout and configuration (design 2.45.0 §2.2): what the builder, the readers and the view jobs share.

Under ``SNAPSHOT_PREFIX`` of the keywords bucket (``SCOPE_SNAPSHOT_BUCKET``)::

    current.json                                  build_id, built_at, brand_config_updated_at, personas,
                                                  previous_build_id, keywords_behind, per scope key: dir,
                                                  fingerprint, keywords_total, keywords_analyzed,
                                                  keywords_behind, series id
    <build_id>/manifest.json                      the build's own copy of its current.json
    <build_id>/<scope_dir>/<artifact>.json.gz     the artifacts of ``shared.artifact_registry`` builders
    keywords/<hash>.json.gz                       KeywordLatest (``shared.keyword_latest``)
    series/<scope_dir>/<series_id>.json.gz        a scope's per-run series (``shared.scope_series``), immutable
    series-progress.json                          series an unpublished build saved (``shared.scope_series_build``)
    jobs/<job_id>.json.gz | .status.json          view jobs (``shared.view_jobs``), expired by an S3 lifecycle rule
    rebuild-requested.json                        debounce marker of API-triggered rebuilds

Scope keys and directories are ``shared.snapshot_store``'s (``all``,
``market:<id>``, ``group:<id>``, ``group:<id>|market:<id>``); a scope's
directory is the same in every build, so a cursor names only the build.
"""

from __future__ import annotations

import json
import logging
import os
import time
from collections.abc import Callable
from typing import Any

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from shared.analysis_runs import fetch_enabled_query_prompts
from shared.snapshot_artifacts import SnapshotScope
from shared.snapshot_store import ALL_SCOPE, SnapshotStore

logger = logging.getLogger(__name__)

SNAPSHOT_PREFIX = 'scope-snapshots/'
SERIES_PREFIX = f'{SNAPSHOT_PREFIX}series/'
JOBS_PREFIX = f'{SNAPSHOT_PREFIX}jobs/'
FORMAT_VERSION = 1

BUILD_ACTION = 'build_scope_snapshots'
"""The GenerateSummary event ``action`` that builds the scope snapshots."""
VIEW_JOB_ACTION = 'view_job'
"""The GenerateSummary event ``action`` that computes one view job."""

PERSONAS_TTL_SECONDS = 60.0


def snapshot_bucket() -> str | None:
    """The keywords bucket the snapshots live in (``SCOPE_SNAPSHOT_BUCKET``); ``None`` where they are not deployed."""
    return os.environ.get('SCOPE_SNAPSHOT_BUCKET') or None


def snapshot_function_name() -> str | None:
    """The Lambda that builds snapshots and runs view jobs (``SCOPE_SNAPSHOT_FUNCTION_NAME``, the GenerateSummary Lambda)."""
    return os.environ.get('SCOPE_SNAPSHOT_FUNCTION_NAME') or None


def snapshot_s3_client(workers: int) -> Any:
    """An S3 client whose connection pool fits ``workers`` parallel reads or writes."""
    return boto3.client('s3', config=Config(max_pool_connections=workers))


def snapshot_store(s3: Any, bucket: str) -> SnapshotStore:
    return SnapshotStore(s3, bucket, SNAPSHOT_PREFIX, 'scope snapshot')


def artifact_key(build_id: str, scope_dir: str, artifact: str) -> str:
    return f'{SNAPSHOT_PREFIX}{build_id}/{scope_dir}/{artifact}.json.gz'


def manifest_key(build_id: str) -> str:
    """The copy of a build's ``current.json`` kept in the build, so a cursor of an older build reads that build's metadata."""
    return f'{SNAPSHOT_PREFIX}{build_id}/manifest.json'


def series_key(scope_dir: str, series_id: str) -> str:
    return f'{SERIES_PREFIX}{scope_dir}/{series_id}.json.gz'


def job_result_key(job_id: str) -> str:
    return f'{JOBS_PREFIX}{job_id}.json.gz'


def job_status_key(job_id: str) -> str:
    return f'{JOBS_PREFIX}{job_id}.status.json'


def snapshot_scope(key: str, scope_dir: str, keywords_total: int) -> SnapshotScope:
    """The ``SnapshotScope`` a builder folds for scope ``key``."""
    if key == ALL_SCOPE:
        return SnapshotScope(scope_dir, 'all', None, None, keywords_total)
    group_part, _, market_part = key.partition('|')
    if group_part.startswith('market:'):
        return SnapshotScope(scope_dir, 'market', None, group_part.removeprefix('market:'), keywords_total)
    market = market_part.removeprefix('market:') if market_part else None
    return SnapshotScope(scope_dir, 'group', group_part.removeprefix('group:'), market, keywords_total)


def query_prompts_table(resource: Any) -> Any | None:
    """The QueryPrompts table (``DYNAMODB_TABLE_QUERY_PROMPTS``), or ``None`` where personas are not deployed."""
    name = os.environ.get('DYNAMODB_TABLE_QUERY_PROMPTS')
    return None if not name else resource.Table(name)


def start_snapshot_build(lambda_client: Any, reason: str) -> bool:
    """Invoke the snapshot builder asynchronously, without the readers' debounce (a writer knows the build is needed); whether it was started."""
    function_name = snapshot_function_name()
    if not function_name:
        return False
    try:
        lambda_client.invoke(
            FunctionName=function_name, InvocationType='Event',
            Payload=json.dumps({'action': BUILD_ACTION, 'reason': reason}).encode('utf-8'),
        )
    except (ClientError, BotoCoreError):
        logger.exception('Could not start a scope snapshot build (%s)', reason)
        return False
    return True


class PersonaCache:
    """The enabled persona ids (sorted), re-read at most every ``PERSONAS_TTL_SECONDS``; empty without a table."""

    def __init__(self, table: Callable[[], Any | None], clock: Callable[[], float] = time.monotonic) -> None:
        self._table = table
        self._clock = clock
        self._cached: tuple[float, tuple[str, ...]] | None = None

    def ids(self) -> tuple[str, ...]:
        now = self._clock()
        if self._cached is not None and now - self._cached[0] < PERSONAS_TTL_SECONDS:
            return self._cached[1]
        table = self._table()
        ids = () if table is None else tuple(sorted({prompt['id'] for prompt in fetch_enabled_query_prompts(table)}))
        self._cached = (now, ids)
        return ids


__all__ = [
    'BUILD_ACTION',
    'FORMAT_VERSION',
    'JOBS_PREFIX',
    'SERIES_PREFIX',
    'SNAPSHOT_PREFIX',
    'VIEW_JOB_ACTION',
    'PersonaCache',
    'artifact_key',
    'job_result_key',
    'job_status_key',
    'manifest_key',
    'query_prompts_table',
    'series_key',
    'snapshot_bucket',
    'snapshot_function_name',
    'snapshot_s3_client',
    'snapshot_scope',
    'snapshot_store',
    'start_snapshot_build',
]
