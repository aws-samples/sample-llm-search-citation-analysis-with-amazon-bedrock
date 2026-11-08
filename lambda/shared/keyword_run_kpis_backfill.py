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
"""

from __future__ import annotations

import logging
from collections.abc import Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from boto3.dynamodb.conditions import Key
from botocore.exceptions import BotoCoreError, ClientError

from shared.keyword_run_kpis import (
    BRANDS_PER_RUN,
    emit_write_failure_metric,
    put_run_tally,
    stored_timestamps,
    tracked_brand_names,
)
from shared.kpi_engine import ANSWER_ATTRIBUTE_NAMES, ANSWER_PROJECTION, answers_from_rows, owned_domains_from
from shared.kpi_tally import owned_fingerprint, run_tally
from shared.request_deadline import Deadline

logger = logging.getLogger(__name__)

BACKFILL_ACTION = 'backfill_keyword_run_kpis'
"""The event ``action`` the Deduplication Lambda runs the backfill for."""


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


def keyword_pages(keywords_table: Any, explicit: Sequence[str] | None, scan_key: Mapping[str, Any] | None) -> Iterator[tuple[Mapping[str, Any] | None, list[str]]]:
    """``(start key, keywords)`` of each page to walk: ``explicit`` as one page, else the Keywords table's pages from ``scan_key``."""
    if explicit is not None:
        yield None, list(explicit)
        return
    start = scan_key
    while True:
        params: dict[str, Any] = {'ProjectionExpression': '#kw', 'ExpressionAttributeNames': {'#kw': 'keyword'}}
        if start:
            params['ExclusiveStartKey'] = dict(start)
        response = keywords_table.scan(**params)
        texts = [item['keyword'] for item in response.get('Items') or [] if isinstance(item.get('keyword'), str) and item['keyword']]
        yield start, texts
        start = response.get('LastEvaluatedKey')
        if not start:
            return


def run_backfill(job: KeywordRunKpisBackfill, pages: Iterator[tuple[Mapping[str, Any] | None, list[str]]], cursor: Cursor) -> dict[str, Any]:
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


def _response(job: KeywordRunKpisBackfill, cursor: Cursor | None) -> dict[str, Any]:
    return {
        'action': BACKFILL_ACTION,
        'done': cursor is None,
        'cursor': None if cursor is None else cursor.as_dict(),
        **job.stats.as_dict(),
    }


__all__ = ['BACKFILL_ACTION', 'Cursor', 'KeywordRunKpisBackfill', 'RollupNotDeployedError', 'keyword_pages', 'run_backfill']
