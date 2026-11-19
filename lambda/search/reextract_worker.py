"""
Re-extract worker (``CitationAnalysis-ReextractWorker``, 2.55.0): runs the brand extraction again on stored answers.

Event: ``{"job_id": "rx-...", "step": n}`` (the API starts step 0; every invocation that runs out of time saves its
cursor, moves the job to ``step + 1`` and invokes this function again with it). An invocation whose step is not the
job's, or whose job is no longer active, does nothing, so a duplicate delivery never runs a second pass.

Each answer the filters cover (``shared.reextract``) is extracted again with today's brand config for its market,
exactly as a new answer would be (``extraction_settings``), several at a time. A row is rewritten only when the
extraction succeeded: its previous brands go to ``brands_history`` (D1), and with ``only_outdated`` the write is
conditional on the row still being outdated. A failed extraction keeps the row as it was and counts in
``answers_failed``. Raw answers in S3 are never touched.

After every batch the job's progress is saved and announced (``REEXTRACT_CHANGED``); a ``stopping`` job stops
there. When the job ends (done, stopped or failed), the KPI rows and KeywordLatest objects of every keyword with a
rewritten answer are rebuilt by the Deduplication Lambda's backfill (``rebuild``, then ``latest``), which then
starts a scope snapshot build.
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Callable, Iterator, Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Final, Literal, Protocol

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from extraction_settings import extraction_brand_config

from brand_extractor import BrandExtractionError, extract_brands_from_response
from shared.brand_names import BRANDS_VERSION
from shared.change_events import REEXTRACT_CHANGED, publish_change
from shared.dynamo_decimal import convert_floats_to_decimal
from shared.dynamodb_conditions import is_conditional_check_failure
from shared.markets import GLOBAL_MARKET_ID, Market, load_markets, markets_by_id
from shared.models import ModelRole, get_model_id
from shared.reextract import (
    ReextractFilters,
    ScopedKeyword,
    answer_filter,
    filters_from_body,
    load_scoped_keywords,
    query_pages,
    run_key_condition,
)
from shared.reextract_jobs import ACTIVE_STATUSES, ReextractJobs, StaleStepError, reextract_jobs_table_name
from shared.request_deadline import Deadline, budget_from_context
from shared.search_results import search_results_table_name
from shared.self_invoke import SelfInvokeDispatchError, invoke_self_async
from shared.utils import get_timestamp

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

lambda_client = boto3.client('lambda')
dynamodb = boto3.resource('dynamodb')

#: Extractions in flight at once (each is one Bedrock call of 5-20 s).
CONCURRENCY: Final = 8
#: Answers per batch: progress is saved and the stop request read after each one.
BATCH_SIZE: Final = 16
#: Rows one SearchResults page reads at most (answers carry their full text).
PAGE_ROWS: Final = 40
#: A batch does not start with less time left than this (two rounds of extractions, each up to a minute, plus throttling backoff).
BATCH_SECONDS: Final = 240.0
#: The invocation stops this long before Lambda would end it.
WORKER_MARGIN_SECONDS: Final = 30.0
#: Up to this many keywords, the rebuild names them; beyond it every keyword is rebuilt (the event stays small).
REBUILD_LIST_MAX: Final = 500
_ANSWER_PROJECTION: Final = 'keyword, timestamp_provider, #response, market_id, brands, brand_count, brands_version'
_ANSWER_NAMES: Final = {'#response': 'response'}

Outcome = Literal['done', 'out_of_time', 'stopping']


class JobStore(Protocol):
    """What a pass needs of the job store (``shared.reextract_jobs.ReextractJobs``)."""

    def save(self, job_id: str, step: int, changes: Mapping[str, Any], touched: set[str] | None = None) -> dict[str, Any]:
        """Save the pass's progress at ``step``; the job after it (``StaleStepError`` when another invocation owns it)."""
        raise NotImplementedError

    def release(self, job_id: str) -> None:
        """Free the next start once the job ended."""


@dataclass
class _Tallies:
    answers_done: int = 0
    answers_skipped: int = 0
    answers_failed: int = 0
    keywords_done: int = 0

    @classmethod
    def of(cls, job: Mapping[str, Any]) -> _Tallies:
        return cls(*(int(job.get(name) or 0) for name in ('answers_done', 'answers_skipped', 'answers_failed', 'keywords_done')))

    def as_changes(self, total: int) -> dict[str, int]:
        seen = self.answers_done + self.answers_skipped + self.answers_failed
        return {
            'answers_done': self.answers_done, 'answers_skipped': self.answers_skipped,
            'answers_failed': self.answers_failed, 'keywords_done': self.keywords_done,
            # The estimate is a lower bound when it was cut; the total never reads below what was seen.
            'answers_total': max(total, seen),
        }


class ExtractionOffError(RuntimeError):
    """Brand extraction is turned off (``extraction_config.json``): nothing can be re-extracted."""


def _market_id(row: Mapping[str, Any]) -> str:
    return str(row.get('market_id') or GLOBAL_MARKET_ID)


class BrandConfigs:
    """The extraction's brand config per market, read on first use (in the main thread); a read error raises (never extract blind)."""

    def __init__(self, brand_config_table: Any) -> None:
        self.table = brand_config_table
        self._stored: dict[str, Any] | None = None
        self._markets: dict[str, Market] = {}
        self._by_market: dict[str, dict[str, Any]] = {}

    def load(self, market_ids: set[str]) -> None:
        """Read the config of every market in ``market_ids`` not read yet; raises ``ExtractionOffError`` when extraction is off."""
        if self._stored is None:
            self._stored = dict(self.table.get_item(Key={'config_id': 'default'}).get('Item') or {})
            self._markets = markets_by_id(load_markets(self.table))
        for market_id in market_ids - self._by_market.keys():
            market = None if market_id == GLOBAL_MARKET_ID else self._markets.get(market_id)
            config = extraction_brand_config(market, self._stored)
            if config is None:
                raise ExtractionOffError
            self._by_market[market_id] = config

    def for_market(self, market_id: str) -> dict[str, Any]:
        """A config ``load`` read (threads only read it)."""
        return self._by_market[market_id]


def _extract(row: Mapping[str, Any], configs: BrandConfigs) -> dict[str, Any] | None:
    """``row``'s brands extracted again; ``None`` when the extraction failed (the row keeps its brands)."""
    try:
        return extract_brands_from_response(str(row.get('response') or ''), config=configs.for_market(_market_id(row)), strict=True)
    except BrandExtractionError:
        logger.warning('Re-extract: extraction failed for %r at %s', row.get('keyword'), row.get('timestamp_provider'))
        return None


def replace_brands(
    table: Any, row: Mapping[str, Any], brand_data: Mapping[str, Any], *, job_id: str, only_outdated: bool,
) -> bool:
    """Write ``brand_data`` on ``row``, its previous brands appended to ``brands_history``; whether the row was written.

    ``False`` when the row is gone or, with ``only_outdated``, already current (another writer got there first).
    """
    now = get_timestamp()
    previous = {
        'brands_version': int(row.get('brands_version') or 0), 'brands': row.get('brands') or [],
        'brand_count': row.get('brand_count') or 0, 'replaced_at': now, 'job_id': job_id,
    }
    condition = 'attribute_exists(keyword)'
    if only_outdated:
        condition += ' AND (attribute_not_exists(brands_version) OR brands_version < :version)'
    try:
        table.update_item(
            Key={'keyword': row['keyword'], 'timestamp_provider': row['timestamp_provider']},
            UpdateExpression=(
                'SET brands = :brands, brand_count = :count, brands_version = :version, brands_extracted_at = :now, '
                'brands_history = list_append(if_not_exists(brands_history, :empty), :previous)'
            ),
            ConditionExpression=condition,
            ExpressionAttributeValues={
                ':brands': convert_floats_to_decimal(list(brand_data.get('brands') or [])),
                ':count': int(brand_data.get('brand_count') or 0), ':version': BRANDS_VERSION, ':now': now,
                ':empty': [], ':previous': [previous],
            },
        )
    except ClientError as error:
        if is_conditional_check_failure(error):
            return False
        raise
    return True


def answer_pages(table: Any, keyword: str, filters: ReextractFilters, after: str | None) -> Iterator[list[dict[str, Any]]]:
    """``keyword``'s answers the filters cover, oldest first, after the sort key ``after``, a page at a time."""
    params: dict[str, Any] = {
        'KeyConditionExpression': run_key_condition(keyword, filters),
        'FilterExpression': answer_filter(filters),
        'ProjectionExpression': _ANSWER_PROJECTION,
        'ExpressionAttributeNames': dict(_ANSWER_NAMES),
        'Limit': PAGE_ROWS,
    }
    start = {'keyword': keyword, 'timestamp_provider': after} if after else None
    return query_pages(table, params, after=start)


@dataclass
class ReextractPass:
    """One worker invocation over job ``job`` at ``step``."""

    jobs: JobStore
    job: dict[str, Any]
    step: int
    deadline: Deadline
    search_table: Any
    configs: BrandConfigs
    pool: ThreadPoolExecutor
    tallies: _Tallies = field(init=False)
    filters: ReextractFilters = field(init=False)
    touched: set[str] = field(default_factory=set)

    def __post_init__(self) -> None:
        self.tallies = _Tallies.of(self.job)
        self.filters = filters_from_body(self.job.get('filters') or {})

    @property
    def job_id(self) -> str:
        return str(self.job['job_id'])

    def _save(self, changes: Mapping[str, Any]) -> None:
        total = int(self.job.get('answers_total') or 0)
        self.job = self.jobs.save(self.job_id, self.step, {**self.tallies.as_changes(total), **changes}, self.touched)
        self.touched = set()
        publish_change(REEXTRACT_CHANGED, {'job_id': self.job_id, 'status': self.job.get('status')})

    def _batch(self, rows: list[dict[str, Any]]) -> None:
        self.configs.load({_market_id(row) for row in rows})
        # Resolved here so the extraction threads find the saved model cached (shared.models).
        get_model_id(ModelRole.EXTRACTION)
        results = list(self.pool.map(lambda row: _extract(row, self.configs), rows))
        for row, brand_data in zip(rows, results, strict=True):
            if brand_data is None:
                self.tallies.answers_failed += 1
            elif replace_brands(self.search_table, row, brand_data, job_id=self.job_id, only_outdated=self.filters.only_outdated):
                self.tallies.answers_done += 1
                self.touched.add(str(row['keyword']))
            else:
                self.tallies.answers_skipped += 1

    def _keyword(self, scoped: ScopedKeyword, after: str | None) -> Outcome:
        for page in answer_pages(self.search_table, scoped.keyword, self.filters, after):
            for start in range(0, len(page), BATCH_SIZE):
                if self.deadline.remaining() < BATCH_SECONDS:
                    return 'out_of_time'
                rows = page[start:start + BATCH_SIZE]
                self._batch(rows)
                self._save({'cursor_keyword': scoped.keyword, 'cursor_key': rows[-1]['timestamp_provider']})
                if self.job.get('status') == 'stopping':
                    return 'stopping'
        return 'done'

    def pending(self, keywords: list[ScopedKeyword]) -> list[tuple[ScopedKeyword, str | None]]:
        """The keywords still to do, each with the sort key to resume after (``None``: from its first answer)."""
        cursor_keyword, cursor_key = self.job.get('cursor_keyword'), self.job.get('cursor_key')
        if not isinstance(cursor_keyword, str):
            return [(scoped, None) for scoped in keywords]
        mark = ScopedKeyword(cursor_keyword, '').order
        resumed: list[tuple[ScopedKeyword, str | None]] = [
            (scoped, str(cursor_key)) for scoped in keywords if scoped.keyword == cursor_keyword and cursor_key
        ]
        return resumed + [(scoped, None) for scoped in keywords if scoped.order > mark]

    def run(self, keywords: list[ScopedKeyword]) -> Outcome:
        if self.job.get('status') == 'stopping':
            return 'stopping'
        for scoped, after in self.pending(keywords):
            outcome = self._keyword(scoped, after)
            if outcome != 'done':
                return outcome
            self.tallies.keywords_done += 1
            self._save({'cursor_keyword': scoped.keyword, 'cursor_key': None})
        return 'done'

    def finish(self, status: str, error: str | None = None) -> None:
        """End the job: status, the KPI rebuild of the keywords it rewrote, the pointer freed, the change announced."""
        touched = {str(keyword) for keyword in self.job.get('touched_keywords') or ()} | self.touched
        rebuild = 'started' if touched and start_kpi_rebuild(touched) else None
        self._save({'status': status, 'error': error, 'finished_at': get_timestamp(), 'rebuild': rebuild})
        self.jobs.release(self.job_id)

    def chain(self, function_name: str) -> None:
        """Hand the job to the next invocation: ``step + 1`` saved first, then that invocation started."""
        self._save({'step': self.step + 1})
        self.step += 1
        invoke_self_async(
            function_name, json.dumps({'job_id': self.job_id, 'step': self.step}).encode(),
            description='brand re-extract', lambda_client=lambda_client,
        )


def start_kpi_rebuild(keywords: set[str]) -> bool:
    """Ask the Deduplication Lambda to rebuild ``keywords``' KPI rows, then their KeywordLatest objects; whether it accepted."""
    payload: dict[str, Any] = {
        'action': 'backfill_keyword_run_kpis', 'rebuild': True, 'chain': True, 'then_latest': True,
    }
    if len(keywords) <= REBUILD_LIST_MAX:
        payload['keywords'] = sorted(keywords)
    try:
        invoke_self_async(
            os.environ['KPI_REBUILD_FUNCTION_NAME'], json.dumps(payload).encode(),
            description='KPI rebuild after a re-extract', lambda_client=lambda_client,
        )
    except SelfInvokeDispatchError:
        return False
    return True


def _event_step(event: Mapping[str, Any]) -> tuple[str, int] | None:
    job_id, step = event.get('job_id'), event.get('step', 0)
    if not isinstance(job_id, str) or not job_id or not isinstance(step, int) or isinstance(step, bool):
        return None
    return job_id, step


def run_pass(work: ReextractPass, keywords: Callable[[], list[ScopedKeyword]], function_name: str) -> str:
    try:
        outcome = work.run(keywords())
        if outcome == 'out_of_time':
            work.chain(function_name)
            return 'continued'
        status = 'stopped' if outcome == 'stopping' else 'done'
        work.finish(status)
    except StaleStepError:
        logger.info('Re-extract %s: another invocation owns the job', work.job_id)
        return 'ignored'
    except ExtractionOffError:
        work.finish('failed', 'Brand extraction is turned off')
        return 'failed'
    except (ClientError, BotoCoreError, SelfInvokeDispatchError, KeyError, ValueError, TypeError) as error:
        logger.exception('Re-extract %s failed', work.job_id)
        work.finish('failed', f'The re-extract stopped: {type(error).__name__}')
        return 'failed'
    return status


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """Run one pass of the job the event names (see the module docstring)."""
    parsed = _event_step(event)
    if parsed is None:
        logger.warning('Re-extract worker: event without a job_id and step')
        return {'status': 'ignored'}
    job_id, step = parsed
    jobs = ReextractJobs(dynamodb.Table(reextract_jobs_table_name()))
    job = jobs.get(job_id)
    if job is None or int(job.get('step') or 0) != step or job.get('status') not in ACTIVE_STATUSES:
        logger.info('Re-extract %s step %s: nothing to do', job_id, step)
        return {'status': 'ignored'}
    deadline = Deadline(budget_from_context(context, WORKER_MARGIN_SECONDS))
    keywords_table = dynamodb.Table(os.environ['DYNAMODB_TABLE_KEYWORDS'])
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        work = ReextractPass(
            jobs, job, step, deadline, dynamodb.Table(search_results_table_name()),
            BrandConfigs(dynamodb.Table(os.environ['DYNAMODB_TABLE_BRAND_CONFIG'])), pool,
        )
        status = run_pass(work, lambda: load_scoped_keywords(work.filters, keywords_table), str(getattr(context, 'invoked_function_arn', '')))
    logger.info('Re-extract %s step %s: %s', job_id, step, status)
    return {'status': status, 'job_id': job_id}
