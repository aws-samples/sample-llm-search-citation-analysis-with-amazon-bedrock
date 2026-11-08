"""
Backfill of ``CitationAnalysis-KeywordRunKpis``: one rollup row per run already in SearchResults.

Rows are written by the workflow from the release that adds the table on;
older runs are read raw by the windowed reports (``shared.scoped_reports``)
until this backfill has rolled them up. It walks keywords (the Keywords
table, every status, or the ``keywords`` of the event) and each keyword's
SearchResults partition oldest run first, writing one row per run.

Resumable and bounded: it stops when the invocation's deadline (activated by
the caller, ``shared.request_deadline``) is spent and answers a ``cursor``;
invoking it again with that cursor carries on from the run after the last one
written. Runs that already have a row counted against the current owned
domains are skipped, so a rerun after the owned domains change rebuilds only
what it must; ``rebuild`` rewrites every row. A row that fails to write is
logged, counted (``write_failures`` and the ``KeywordRunKpisWriteFailure``
metric) and left to the next run of the backfill.

``latest`` mode (``KeywordLatestBackfill``) rebuilds every keyword's
KeywordLatest object (``shared.keyword_latest``) instead: the newest two runs
are read raw (every attribute, the partials' input), the history blocks come
from the keyword's KeywordRunKpis rows of the last ``HISTORY_DAYS``, and a
keyword whose object already holds those two runs for the current
configuration is skipped (``rebuild`` rewrites it anyway). It runs after a
brand-config or persona change, which makes every object's ``config`` stale.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator, Mapping, MutableMapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Literal, Protocol

from boto3.dynamodb.conditions import Key
from botocore.exceptions import BotoCoreError, ClientError

from shared.answer_queries import latest_run_timestamp, previous_run_timestamp
from shared.keyword_counts import KeywordCounter
from shared.keyword_latest import (
    KeywordLatestConflict,
    config_fingerprint,
    is_current,
    read_full_run_rows,
    read_keyword_latest,
    rebuild_keyword_latest,
)
from shared.keyword_run_kpis import (
    BRANDS_PER_RUN,
    emit_write_failure_metric,
    put_run_tally,
    query_stored_runs,
    run_tally_pair,
    stored_timestamps,
    tracked_brand_names,
)
from shared.kpi_engine import ANSWER_ATTRIBUTE_NAMES, ANSWER_PROJECTION, answers_from_rows, owned_domains_from
from shared.kpi_tally import RunTally, owned_fingerprint, run_tally
from shared.partial_contract import PartialConfig
from shared.request_deadline import Deadline

logger = logging.getLogger(__name__)

BACKFILL_ACTION = 'backfill_keyword_run_kpis'
"""The event ``action`` the Deduplication Lambda runs the backfill for."""

#: Days of KeywordRunKpis history a rebuilt KeywordLatest object's ``recent`` and ``series`` blocks read.
HISTORY_DAYS = 366

BackfillMode = Literal['kpis', 'latest']


class RollupNotDeployedError(RuntimeError):
    """The backfill was invoked where ``DYNAMODB_TABLE_KEYWORD_RUN_KPIS`` is not set."""

    def __init__(self) -> None:
        super().__init__('Set DYNAMODB_TABLE_KEYWORD_RUN_KPIS to backfill the KPI rollups')


@dataclass(frozen=True)
class Cursor:
    """Where a backfill resumes: the keyword page (``scan_key``), the keyword in progress and its last run written."""

    scan_key: Mapping[str, Any] | None = None
    keyword: str | None = None
    after: str | None = None

    @classmethod
    def from_event(cls, value: object) -> Cursor:
        if not isinstance(value, Mapping):
            return cls()
        scan_key, keyword, after = value.get('scan_key'), value.get('keyword'), value.get('after')
        return cls(
            scan_key if isinstance(scan_key, Mapping) else None,
            keyword if isinstance(keyword, str) else None,
            after if isinstance(after, str) else None,
        )

    def as_dict(self) -> dict[str, Any]:
        return {'scan_key': dict(self.scan_key) if self.scan_key else None, 'keyword': self.keyword, 'after': self.after}


@dataclass
class BackfillStats:
    keywords_done: int = 0
    runs_written: int = 0
    runs_skipped: int = 0
    write_failures: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            'keywords_done': self.keywords_done,
            'runs_written': self.runs_written,
            'runs_skipped': self.runs_skipped,
            'write_failures': self.write_failures,
        }


@dataclass
class KeywordRunKpisBackfill:
    """One backfill invocation over ``search_table`` into ``rollups``."""

    search_table: Any
    rollups: Any
    brand_config: Mapping[str, Any]
    deadline: Deadline
    rebuild: bool = False
    stats: BackfillStats = field(default_factory=BackfillStats)
    mode: BackfillMode = 'kpis'

    def __post_init__(self) -> None:
        self.owned_domains = owned_domains_from(self.brand_config)
        self.fingerprint = owned_fingerprint(self.owned_domains)
        self.tracked = tracked_brand_names(self.brand_config)

    def _write(self, keyword: str, timestamp: str, rows: list[dict[str, Any]], existing: Mapping[str, str]) -> None:
        if not self.rebuild and existing.get(timestamp) == self.fingerprint:
            self.stats.runs_skipped += 1
            return
        tally = run_tally(keyword, timestamp, answers_from_rows(rows), self.owned_domains, brand_cap=BRANDS_PER_RUN, tracked_brands=self.tracked)
        try:
            put_run_tally(self.rollups, tally)
        except (ClientError, BotoCoreError):
            logger.exception('KeywordRunKpis backfill: row of %r at %s not written', keyword, timestamp)
            emit_write_failure_metric('backfill')
            self.stats.write_failures += 1
            return
        self.stats.runs_written += 1

    def _pages(self, keyword: str, after: str | None) -> Iterator[list[dict[str, Any]]]:
        """``keyword``'s rows after the run ``after``, oldest first, a page at a time."""
        condition = Key('keyword').eq(keyword)
        # Every sort key of the run `after` starts with `after#`, and '$' sorts right after '#'.
        params: dict[str, Any] = {
            'KeyConditionExpression': condition if after is None else condition & Key('timestamp_provider').gt(f'{after}$'),
            'ProjectionExpression': ANSWER_PROJECTION,
            'ExpressionAttributeNames': ANSWER_ATTRIBUTE_NAMES,
        }
        while True:
            response = self.search_table.query(**params)
            yield list(response.get('Items') or [])
            last_key = response.get('LastEvaluatedKey')
            if not last_key:
                return
            params['ExclusiveStartKey'] = last_key

    def backfill_keyword(self, keyword: str, after: str | None) -> str | None:
        """Write ``keyword``'s runs after ``after``; ``None`` when done, else the last run written when the deadline stopped it."""
        existing = stored_timestamps(self.rollups, keyword)
        current: str | None = None
        rows: list[dict[str, Any]] = []
        last_written = after
        for page in self._pages(keyword, after):
            for row in page:
                timestamp = str(row.get('timestamp') or '')
                if timestamp != current:
                    if current:
                        self._write(keyword, current, rows, existing)
                        last_written = current
                    current, rows = timestamp, []
                rows.append(row)
            if self.deadline.expired():
                # The run in progress may continue on the next page: it is read again on resume.
                return last_written or ''
        if current:
            self._write(keyword, current, rows, existing)
        self.stats.keywords_done += 1
        return None


def _history_since(latest: str) -> str:
    """The first run timestamp of the ``HISTORY_DAYS`` up to ``latest`` (same layout, so it compares as text)."""
    try:
        moment = datetime.fromisoformat(latest)
    except ValueError:
        return ''
    return (moment - timedelta(days=HISTORY_DAYS)).strftime('%Y-%m-%dT%H:%M:%S')


@dataclass
class KeywordLatestBackfill:
    """One ``latest`` backfill invocation: every keyword's KeywordLatest object rebuilt from its newest two runs."""

    search_table: Any
    rollups: Any | None
    s3: Any
    bucket: str
    config: PartialConfig
    deadline: Deadline
    rebuild: bool = False
    keyword_ids: Mapping[str, str] = field(default_factory=dict)
    stats: BackfillStats = field(default_factory=BackfillStats)
    mode: BackfillMode = 'latest'
    counter: KeywordCounter | None = None
    """Counts each keyword's rows into its object's ``counts`` block (``None``: no block)."""

    def __post_init__(self) -> None:
        self.fingerprint = config_fingerprint(self.config)

    def _history(self, keyword: str, latest: str) -> list[RunTally] | None:
        """The keyword's stored per-run tallies of ``HISTORY_DAYS`` (none without the table); ``None`` when the deadline cut the read."""
        if self.rollups is None:
            return []
        stored = query_stored_runs(self.rollups, keyword, _history_since(latest), brands=False, deadline=self.deadline)
        return None if stored.cut else stored.runs

    def backfill_keyword(self, keyword: str, _after: str | None) -> str | None:
        """Rebuild ``keyword``'s object; ``None`` when done, ``''`` when the deadline stopped its history read (resume at it)."""
        latest = latest_run_timestamp(self.search_table, keyword)
        previous = None if latest is None else previous_run_timestamp(self.search_table, keyword, latest)
        runs = [stamp for stamp in (latest, previous) if stamp]
        if latest is None or (not self.rebuild and is_current(read_keyword_latest(self.s3, self.bucket, keyword)[0], self.fingerprint, runs)):
            self.stats.runs_skipped += len(runs)
            self.stats.keywords_done += 1
            return None
        history = self._history(keyword, latest)
        if history is None:
            return ''
        pairs = []
        for stamp in reversed(runs):
            rows = read_full_run_rows(self.search_table, keyword, stamp)
            pairs.append((rows, run_tally_pair(keyword, stamp, answers_from_rows(rows), self.config.brand_config).full))
        try:
            rebuild_keyword_latest(
                self.s3, self.bucket, pairs, history, self.config,
                keyword=keyword, keyword_id=self.keyword_ids.get(keyword, ''), counter=self.counter,
            )
        except (ClientError, BotoCoreError, KeywordLatestConflict):
            logger.exception('KeywordLatest backfill: object of %r not written', keyword)
            emit_write_failure_metric('keyword_latest_backfill')
            self.stats.write_failures += 1
        else:
            self.stats.runs_written += len(pairs)
        self.stats.keywords_done += 1
        return None


class BackfillJob(Protocol):
    """What ``run_backfill`` drives: either backfill mode."""

    @property
    def deadline(self) -> Deadline:
        """The invocation's time budget."""
        raise NotImplementedError

    @property
    def stats(self) -> BackfillStats:
        """What the pass did so far."""
        raise NotImplementedError

    @property
    def mode(self) -> BackfillMode:
        """Which backfill this is."""
        raise NotImplementedError

    def backfill_keyword(self, keyword: str, after: str | None, /) -> str | None:
        """Backfill one keyword from ``after``; ``None`` when done, else where to resume."""


def keyword_pages(
    keywords_table: Any, explicit: Sequence[str] | None, scan_key: Mapping[str, Any] | None, ids: MutableMapping[str, str] | None = None,
) -> Iterator[tuple[Mapping[str, Any] | None, list[str]]]:
    """``(start key, keywords)`` of each page to walk: ``explicit`` as one page, else the Keywords table's pages from ``scan_key``.

    ``ids`` collects the id of every keyword read from the table.
    """
    if explicit is not None:
        yield None, list(explicit)
        return
    start = scan_key
    while True:
        params: dict[str, Any] = {'ProjectionExpression': '#kw, #id', 'ExpressionAttributeNames': {'#kw': 'keyword', '#id': 'id'}}
        if start:
            params['ExclusiveStartKey'] = dict(start)
        response = keywords_table.scan(**params)
        items = [item for item in response.get('Items') or [] if isinstance(item.get('keyword'), str) and item['keyword']]
        if ids is not None:
            ids.update({item['keyword']: str(item.get('id') or '') for item in items})
        yield start, [item['keyword'] for item in items]
        start = response.get('LastEvaluatedKey')
        if not start:
            return


def run_backfill(job: BackfillJob, pages: Iterator[tuple[Mapping[str, Any] | None, list[str]]], cursor: Cursor) -> dict[str, Any]:
    """Walk ``pages`` from ``cursor`` until done or the deadline; the response names the cursor to resume from."""
    resume = cursor
    for start, keywords in pages:
        first = keywords.index(resume.keyword) if resume.keyword in keywords else 0
        for keyword in keywords[first:]:
            if job.deadline.expired():
                return _response(job, Cursor(start, keyword, None))
            stopped_after = job.backfill_keyword(keyword, resume.after if keyword == resume.keyword else None)
            if stopped_after is not None:
                return _response(job, Cursor(start, keyword, stopped_after or None))
        resume = Cursor()
    return _response(job, None)


def _response(job: BackfillJob, cursor: Cursor | None) -> dict[str, Any]:
    return {
        'action': BACKFILL_ACTION,
        'mode': job.mode,
        'done': cursor is None,
        'cursor': None if cursor is None else cursor.as_dict(),
        **job.stats.as_dict(),
    }


__all__ = [
    'BACKFILL_ACTION',
    'HISTORY_DAYS',
    'BackfillJob',
    'Cursor',
    'KeywordLatestBackfill',
    'KeywordRunKpisBackfill',
    'RollupNotDeployedError',
    'keyword_pages',
    'run_backfill',
]
