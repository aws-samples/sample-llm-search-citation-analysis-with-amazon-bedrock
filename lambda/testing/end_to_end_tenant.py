"""One generated tenant run through the real 2.45.0 pipeline, for the end-to-end scope snapshot tests.

``EndToEndTenant`` holds an in-memory DynamoDB (``testing.memory_dynamodb``), the
snapshot bucket (``ConditionalS3``) and a recording Lambda client. ``run_all``
writes every run of a ``ScaleSpec`` tenant the way the workflow does: the
SearchResults rows (shifted to the last ``spec.runs`` days so the history
windows hold them), its Citations and CrawledContent rows, then the real
Deduplication writer (``run_kpis_action.record_run_kpis``: KeywordRunKpis,
KeywordRunBrands, KeywordLatest). ``build`` runs the real
``build_snapshots``. ``call`` invokes a real route handler (loaded once, with
boto3 pointed at the fakes) and answers ``(status, body)``.

Routing: ``LIVE_ROWS_BUDGET`` is ``SNAPSHOT_BUDGET`` while serving, so the
tenant's large group, its markets and ``scope=all`` are served from the
snapshot; ``live`` raises it so the same request is computed live over every
keyword (the uncapped oracle). ``run_jobs`` runs the view jobs the requests
started with the real job computations.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Generator, Mapping
from contextlib import ExitStack, contextmanager, nullcontext
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from types import ModuleType
from typing import Any
from unittest.mock import MagicMock, patch

from shared import scope_snapshot_serve, scope_source
from shared.citation_rollup_build import RollupSources, build_rollup
from shared.mention_row_reads import job_readers
from shared.request_deadline import Deadline, activate_deadline, clear_request_deadline
from shared.scope_series_store import stored_history
from shared.scope_snapshot_build import SnapshotSources, build_snapshots
from shared.view_job_routes import JobResources, view_job_computers
from shared.view_jobs import run_view_job
from testing.citation_rollup_fixtures import lambda_context
from testing.events import api_gateway_event, parse_response
from testing.memory_dynamodb import MemoryDynamo
from testing.module_loader import load_handler_module
from testing.scale_data import (
    BRAND_CONFIG,
    OWNED_DOMAIN,
    ScaleSpec,
    keyword_items,
    keyword_text,
    persona_ids,
    search_result_rows,
)
from testing.scope_snapshot_fixtures import SNAPSHOT_BUCKET, RecordingLambda, SnapshotBucket

#: The live budget while serving: the tenant's large scopes go to the snapshot.
SNAPSHOT_BUDGET = 100
#: The live budget of the oracle: every scope is read live, whole.
ORACLE_BUDGET = 10**9

FUNCTION_NAME = 'CitationAnalysis-GenerateSummary'

TABLES: Mapping[str, tuple[tuple[str, ...], Mapping[str, tuple[str, ...]]]] = {
    'e2e-search-results': (('keyword', 'timestamp_provider'), {'ProviderIndex': ('provider', 'timestamp')}),
    'e2e-keywords': (('id',), {'StatusIndex': ('status', 'keyword')}),
    'e2e-keyword-groups': (('id',), {}),
    'e2e-citations': (('keyword', 'normalized_url'), {'UrlIndex': ('normalized_url', 'keyword'), 'CitationCountIndex': ('keyword', 'citation_count')}),
    'e2e-crawled': (('normalized_url', 'crawled_at'), {'KeywordIndex': ('keyword', 'crawled_at')}),
    'e2e-keyword-run-kpis': (('keyword', 'run_timestamp'), {}),
    'e2e-keyword-run-brands': (('keyword', 'run_timestamp'), {}),
    'e2e-query-prompts': (('id',), {'EnabledIndex': ('enabled', 'id')}),
    'e2e-brand-config': (('config_id',), {}),
    'e2e-recommendation-status': (('recommendation_id',), {}),
    'e2e-content-studio': (('id',), {'StatusCreatedIndex': ('status', 'created_at')}),
    'e2e-report-insights': (('scope_key', 'run_timestamp'), {}),
}

ENV: Mapping[str, str] = {
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'e2e-search-results',
    'DYNAMODB_TABLE_KEYWORDS': 'e2e-keywords',
    'DYNAMODB_TABLE_KEYWORD_GROUPS': 'e2e-keyword-groups',
    'DYNAMODB_TABLE_CITATIONS': 'e2e-citations',
    'DYNAMODB_TABLE_CRAWLED_CONTENT': 'e2e-crawled',
    'DYNAMODB_TABLE_KEYWORD_RUN_KPIS': 'e2e-keyword-run-kpis',
    'DYNAMODB_TABLE_KEYWORD_RUN_BRANDS': 'e2e-keyword-run-brands',
    'DYNAMODB_TABLE_QUERY_PROMPTS': 'e2e-query-prompts',
    'DYNAMODB_TABLE_BRAND_CONFIG': 'e2e-brand-config',
    'DYNAMODB_TABLE_RECOMMENDATION_STATUS': 'e2e-recommendation-status',
    'DYNAMODB_TABLE_CONTENT_STUDIO': 'e2e-content-studio',
    'DYNAMODB_TABLE_CONTENT_BRIEF_BATCHES': 'e2e-content-brief-batches',
    'DYNAMODB_TABLE_CONTENT_BRIEF_TEMPLATES': 'e2e-content-brief-templates',
    'CONTENT_STUDIO_WORKER_FUNCTION_NAME': 'CitationAnalysis-ContentStudioWorker',
    'DYNAMODB_TABLE_REPORT_INSIGHTS': 'e2e-report-insights',
    'SCOPE_SNAPSHOT_BUCKET': SNAPSHOT_BUCKET,
    'CITATION_ROLLUP_BUCKET': SNAPSHOT_BUCKET,
    'CITATION_ROLLUP_FUNCTION_NAME': FUNCTION_NAME,
    'SCOPE_SNAPSHOT_FUNCTION_NAME': FUNCTION_NAME,
    'SUMMARY_BUCKET': SNAPSHOT_BUCKET,
    'CORS_ORIGIN_PARAM': '',
}

#: The fields every scoped body carries that say where it came from, not what it says.
ENVELOPE = frozenset({'source', 'as_of', 'stale', 'refreshing', 'generated_at'})

_API_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'api')
_DEDUP_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'deduplication')


def run_moment(spec: ScaleSpec, run_index: int, today: datetime) -> datetime:
    """When run ``run_index`` ran: daily at 06:00, the newest yesterday."""
    day = today.replace(hour=6, minute=0, second=0, microsecond=0) - timedelta(days=1)
    return day - timedelta(days=spec.runs - 1 - run_index)


def stamp(moment: datetime) -> str:
    return moment.strftime('%Y-%m-%dT%H:%M:%S.000000Z')


def shifted_rows(spec: ScaleSpec, keyword_index: int, run_index: int, timestamp: str) -> list[dict[str, Any]]:
    """The generated rows of a keyword-run, stamped ``timestamp``."""
    rows = []
    for row in search_result_rows(spec, keyword_index, run_index):
        engine_persona = row['timestamp_provider'].split('#', 1)[1]
        rows.append({**row, 'timestamp': timestamp, 'timestamp_provider': f'{timestamp}#{engine_persona}'})
    return rows


#: The budget ``scope_snapshot_action`` gives a build: the Lambda's 900 s less its 30 s margin.
BUILD_SECONDS = 870.0


@contextmanager
def build_deadline() -> Generator[None]:
    """The build's request deadline for the block, as the GenerateSummary action activates it."""
    activate_deadline(Deadline(BUILD_SECONDS))
    try:
        yield
    finally:
        clear_request_deadline()


def without_envelope(body: Any) -> Any:
    """``body`` without the source fields (top level), for comparing a snapshot answer with the live one."""
    return {key: value for key, value in body.items() if key not in ENVELOPE} if isinstance(body, dict) else body


def _s3_or_lambda(bucket: SnapshotBucket, invoked: RecordingLambda) -> Any:
    def client(service: str, *_args: Any, **_kwargs: Any) -> Any:
        return {'s3': bucket, 'lambda': invoked}.get(service, MagicMock(name=f'{service}-client'))

    return client


@dataclass
class EndToEndTenant:
    """The fakes, the loaded handlers and the generated tenant (see the module docstring)."""

    spec: ScaleSpec
    today: datetime = field(default_factory=lambda: datetime.now(UTC))
    dynamo: MemoryDynamo = field(default_factory=MemoryDynamo)
    bucket: SnapshotBucket = field(default_factory=SnapshotBucket)
    invoked: RecordingLambda = field(default_factory=RecordingLambda)
    modules: dict[str, ModuleType] = field(default_factory=dict)
    brand_config: dict[str, Any] = field(default_factory=lambda: dict(BRAND_CONFIG))
    budget: int = SNAPSHOT_BUDGET
    last_build: dict[str, Any] = field(default_factory=dict)
    """The summary of the latest ``build``."""

    def __post_init__(self) -> None:
        for name, (key, indexes) in TABLES.items():
            self.dynamo.add(name, key, indexes)
        self.table('e2e-keywords').put_rows(keyword_items(self.spec))
        self.table('e2e-query-prompts').put_rows([
            {'id': persona, 'name': persona, 'template': '{keyword}', 'enabled': 'true'} for persona in persona_ids(self.spec)
        ])

    def table(self, name: str) -> Any:
        return self.dynamo.Table(name)

    # -- the environment ---------------------------------------------------

    @contextmanager
    def active(self) -> Generator[None]:
        """boto3, the environment, the brand config and the routing budget pointed at this tenant for the block."""
        with ExitStack() as stack:
            stack.enter_context(patch.dict(os.environ, ENV))
            stack.enter_context(patch('boto3.resource', return_value=self.dynamo))
            stack.enter_context(patch('boto3.client', side_effect=_s3_or_lambda(self.bucket, self.invoked)))
            stack.enter_context(patch('shared.utils.get_brand_config', side_effect=lambda *_args, **_kwargs: dict(self.brand_config)))
            stack.enter_context(patch.object(scope_source, 'LIVE_ROWS_BUDGET', self.budget))
            scope_snapshot_serve._reader.cache_clear()
            stack.callback(scope_snapshot_serve._reader.cache_clear)
            for module in self.modules.values():
                stack.enter_context(self._pointed(module))
            yield

    @contextmanager
    def _pointed(self, module: ModuleType) -> Generator[None]:
        names = {'dynamodb': self.dynamo, 'get_brand_config': lambda *_args, **_kwargs: dict(self.brand_config)}
        with patch.multiple(module, **{name: value for name, value in names.items() if hasattr(module, name)}):
            yield

    @contextmanager
    def live(self) -> Generator[None]:
        """The oracle: every scope read live, whole (no citation rollup either)."""
        with ExitStack() as stack:
            stack.enter_context(patch.object(scope_source, 'LIVE_ROWS_BUDGET', ORACLE_BUDGET))
            for module in self.modules.values():
                if hasattr(module, 'rollup_reader'):
                    stack.enter_context(patch.object(module, 'rollup_reader', None))
            yield

    def handler(self, filename: str, directory: str = _API_DIR) -> ModuleType:
        """The handler ``<directory>/<filename>`` (default: an API route), loaded once against the fakes."""
        name = f'e2e_{os.path.basename(directory)}_{filename.replace("-", "_").removesuffix(".py")}'.replace('-', '_')
        if name not in self.modules:
            with patch.dict(os.environ, ENV), patch('boto3.resource', return_value=self.dynamo), patch('boto3.client', side_effect=_s3_or_lambda(self.bucket, self.invoked)):
                self.modules[name] = load_handler_module(directory, filename, name)
        return self.modules[name]

    # -- writing the tenant ------------------------------------------------

    def run_timestamp(self, run_index: int) -> str:
        return stamp(run_moment(self.spec, run_index, self.today))

    def _store_run(self, keyword_index: int, run_index: int) -> str:
        timestamp = self.run_timestamp(run_index)
        rows = shifted_rows(self.spec, keyword_index, run_index, timestamp)
        self.table('e2e-search-results').put_rows(rows)
        keyword = keyword_text(keyword_index)
        urls = sorted({url for row in rows for url in row['citations']})
        self.table('e2e-citations').put_rows([{'keyword': keyword, 'normalized_url': url, 'citation_count': 1} for url in urls])
        self.table('e2e-crawled').put_rows([{'normalized_url': url, 'crawled_at': timestamp, 'keyword': keyword} for url in urls[:2]])
        return timestamp

    def run_all(self) -> None:
        """Every run of every keyword, oldest run first, through the real Deduplication writer."""
        dedup = self._deduplication()
        ids = {item['keyword']: item['id'] for item in keyword_items(self.spec)}
        with self.active(), patch.multiple(dedup.run_kpis_action, dynamodb=self.dynamo, s3=self.bucket, get_brand_config=lambda: dict(self.brand_config)):
            dedup.run_kpis_action.personas._cached = None
            for run_index in range(self.spec.runs):
                for keyword_index in range(self.spec.keywords):
                    timestamp = self._store_run(keyword_index, run_index)
                    keyword = keyword_text(keyword_index)
                    dedup.run_kpis_action.record_run_kpis(keyword, timestamp, ids[keyword])

    def _deduplication(self) -> ModuleType:
        """The Deduplication handler (its sibling ``run_kpis_action`` imported from its directory)."""
        with (
            patch.dict(os.environ, ENV), patch.object(sys, 'path', [_DEDUP_DIR, *sys.path]),
            patch('boto3.resource', return_value=self.dynamo), patch('boto3.client', side_effect=_s3_or_lambda(self.bucket, self.invoked)),
        ):
            return load_handler_module(_DEDUP_DIR, 'handler.py', 'e2e_deduplication')

    def history(self) -> Any:
        """The stored per-run history (KeywordRunKpis with KeywordRunBrands) the build and the window jobs read."""
        return stored_history(self.table('e2e-keyword-run-kpis'), self.table('e2e-keyword-run-brands'), Deadline(600))

    def build(self) -> dict[str, Any]:
        """The real scope snapshot build over the KeywordLatest objects and the stored history, under the action's deadline."""
        with self.active(), build_deadline():
            sources = SnapshotSources(
                keywords_table=self.table('e2e-keywords'), s3=self.bucket, bucket=SNAPSHOT_BUCKET,
                brand_config=dict(self.brand_config), personas=persona_ids(self.spec),
                history=self.history(),
            )
            self.last_build = build_snapshots(sources)
            return self.last_build

    def build_citation_rollup(self) -> dict[str, Any]:
        """The real citation rollup build (BuildCitationRollup) over the tenant's Citations rows."""
        with self.active(), build_deadline():
            return build_rollup(RollupSources(
                citations_table=self.table('e2e-citations'), keywords_table=self.table('e2e-keywords'),
                s3=self.bucket, bucket=SNAPSHOT_BUCKET, brand_config=dict(self.brand_config),
            ))

    # -- serving -----------------------------------------------------------

    def call(self, filename: str, path: str, query: Mapping[str, str] | None = None, *, live: bool = False) -> tuple[int, Any]:
        """``GET path?query`` answered by the handler ``filename`` against the tenant (``live``: every scope read live, the oracle)."""
        module = self.handler(filename)
        event = api_gateway_event('GET', path, query=dict(query or {}), resource=path)
        with self.active(), (self.live() if live else nullcontext()):
            return parse_response(module.handler(event, lambda_context(29_000)))

    def call_live(self, filename: str, path: str, query: Mapping[str, str] | None = None) -> tuple[int, Any]:
        """``call`` with every scope read live (the oracle)."""
        return self.call(filename, path, query, live=True)

    def view_jobs(self) -> list[str]:
        return [call['job_id'] for call in self.invoked.invocations if call.get('action') == 'view_job']

    def rebuild_requests(self, action: str = 'build_scope_snapshots') -> list[dict[str, Any]]:
        return [call for call in self.invoked.invocations if call.get('action') == action]

    def run_jobs(self) -> list[dict[str, Any]]:
        """Run every view job started so far (and not run yet) with the real job computations."""
        with self.active():
            resources = JobResources(
                history=self.history(),
                owned_domains=[OWNED_DOMAIN],
                mention_readers=job_readers(self.dynamo, ENV['DYNAMODB_TABLE_SEARCH_RESULTS']),
            )
            computers = view_job_computers(resources)
            return [run_view_job(self.bucket, SNAPSHOT_BUCKET, job, computers=computers) for job in dict.fromkeys(self.view_jobs())]

def built_tenant(spec: ScaleSpec) -> EndToEndTenant:
    """A tenant of ``spec`` with every run written and the scope snapshots built."""
    tenant = EndToEndTenant(spec)
    tenant.run_all()
    tenant.build()
    tenant.build_citation_rollup()
    return tenant


__all__ = [
    'ENV',
    'ENVELOPE',
    'FUNCTION_NAME',
    'ORACLE_BUDGET',
    'SNAPSHOT_BUDGET',
    'EndToEndTenant',
    'built_tenant',
    'run_moment',
    'shifted_rows',
    'stamp',
    'without_envelope',
]
