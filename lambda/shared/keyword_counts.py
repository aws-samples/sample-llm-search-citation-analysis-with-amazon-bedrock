"""
The ``counts`` block of a KeywordLatest object: how many SearchResults, Citations and CrawledContent rows the keyword has.

The scope snapshot's ``stats`` artifact (``shared.artifact_stats``) sums the
blocks of a market's keywords for ``/stats?market_id``. The Deduplication
writer refreshes the block with every run it folds:

- ``searches``: ``base`` plus the rows of every run folded since (``runs``,
  by run timestamp, so a rerun of a run replaces its count). ``base`` is the
  keyword's SearchResults rows before the first run the block counts, read
  once with one ``Select=COUNT`` query when the keyword has no block yet (the
  backfill does it for the keywords analysed before 2.45.0); counting the
  whole partition on every run would read a year of answers each time. Runs
  more than ``RUNS_KEPT_DAYS`` older than the newest are folded into ``base``.
- ``citations``: a ``COUNT`` of the keyword's Citations partition (one row per
  cited URL, small).
- ``crawled``: a ``COUNT`` of its CrawledContent rows on ``KeywordIndex``,
  as of the Deduplication step: the pages the same run crawls next are
  counted at its next run (the live ``/stats`` count includes them). The
  index holds whole pages, so the count is read again only every
  ``CRAWLED_RECOUNT_DAYS`` (``crawled_counted_at``); in between the block
  keeps the last count.

A count that cannot be read whole (a failure, or a page the count's budget
did not reach) leaves the block out, so the market's totals are read live
instead of from an inexact block.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from boto3.dynamodb.conditions import Key
from botocore.exceptions import BotoCoreError, ClientError

from shared.bounded_counts import count_pages
from shared.request_deadline import Deadline

logger = logging.getLogger(__name__)

#: Seconds one partition count may take.
COUNT_SECONDS = 10.0

#: The index CrawledContent rows are counted on (PK ``keyword``).
CRAWLED_INDEX = 'KeywordIndex'

#: Runs younger than this (days before the newest) keep their own count; older ones are folded into ``base``
#: (``shared.keyword_latest.RECENT_DAYS``), so the block stays the same size however many runs a keyword has.
RUNS_KEPT_DAYS = 62

#: The CrawledContent count is read again only when the block's is this many days older than the run folded.
#: ``KeywordIndex`` projects every attribute, so a ``COUNT`` reads (and is billed for) every crawled page of the keyword.
CRAWLED_RECOUNT_DAYS = 7


class CountIncomplete(RuntimeError):
    """A partition count stopped before its last page."""


def _count(table: Any, keyword: str, index_name: str | None = None) -> int:
    index = {'IndexName': index_name} if index_name else {}
    count, complete = count_pages(table.query, Deadline(COUNT_SECONDS), KeyConditionExpression=Key('keyword').eq(keyword), **index)
    if not complete:
        raise CountIncomplete(f'the count of {keyword!r} did not finish')
    return count


def _valid(block: object) -> Mapping[str, Any] | None:
    """``block`` when it is a counts block this module wrote."""
    if not isinstance(block, Mapping) or not isinstance(block.get('runs'), Mapping) or not isinstance(block.get('base'), int):
        return None
    return block


@dataclass(frozen=True)
class KeywordCounter:
    """The tables a writer counts a keyword's rows in (``None``: not configured, no block is written)."""

    search_table: Any
    citations_table: Any | None
    crawled_table: Any | None

    def counts(self, keyword: str, previous: object, run_rows: Mapping[str, int]) -> dict[str, Any] | None:
        """The block once the runs ``run_rows`` (timestamp: rows) are counted; ``None`` when a count cannot be read whole."""
        if self.citations_table is None or self.crawled_table is None:
            return None
        try:
            return self._counts(keyword, _valid(previous), run_rows)
        except (ClientError, BotoCoreError, CountIncomplete, TypeError, ValueError, KeyError):
            logger.exception('KeywordLatest counts of %r not read; the block is left out', keyword)
            return None

    def _counts(self, keyword: str, previous: Mapping[str, Any] | None, run_rows: Mapping[str, int]) -> dict[str, Any]:
        if previous is None:
            runs = dict(run_rows)
            base = max(0, _count(self.search_table, keyword) - sum(runs.values()))
        else:
            runs = {**{str(stamp): int(rows) for stamp, rows in previous['runs'].items()}, **run_rows}
            base = int(previous['base'])
        runs, base = fold_old_runs(runs, base)
        newest = max(runs, default='')
        reused = None if previous is None else _recent_crawl_count(previous, newest)
        if reused is None:
            crawled, counted_at = _count(self.crawled_table, keyword, CRAWLED_INDEX), newest
        else:
            crawled, counted_at = reused, str((previous or {})['crawled_counted_at'])
        return {
            'searches': base + sum(runs.values()),
            'citations': _count(self.citations_table, keyword),
            'crawled': crawled,
            'crawled_counted_at': counted_at,
            'base': base,
            'runs': runs,
        }


def _moment(timestamp: str) -> datetime | None:
    try:
        return datetime.fromisoformat(timestamp)
    except ValueError:
        return None


def fold_old_runs(runs: Mapping[str, int], base: int) -> tuple[dict[str, int], int]:
    """``runs`` without those older than ``RUNS_KEPT_DAYS`` before the newest, and ``base`` with their rows added."""
    newest = _moment(max(runs, default=''))
    if newest is None:
        return dict(runs), base
    cutoff = (newest - timedelta(days=RUNS_KEPT_DAYS)).strftime('%Y-%m-%dT%H:%M:%S')
    kept = {stamp: rows for stamp, rows in runs.items() if stamp >= cutoff}
    return kept, base + sum(rows for stamp, rows in runs.items() if stamp < cutoff)


def _recent_crawl_count(previous: Mapping[str, Any], newest: str) -> int | None:
    """The previous block's ``crawled`` while it was counted less than ``CRAWLED_RECOUNT_DAYS`` before the run ``newest``; else ``None`` (count again)."""
    counted, now = _moment(str(previous.get('crawled_counted_at') or '')), _moment(newest)
    crawled = previous.get('crawled')
    if counted is None or now is None or not isinstance(crawled, int) or now - counted >= timedelta(days=CRAWLED_RECOUNT_DAYS):
        return None
    return crawled


__all__ = ['COUNT_SECONDS', 'CRAWLED_INDEX', 'CRAWLED_RECOUNT_DAYS', 'RUNS_KEPT_DAYS', 'CountIncomplete', 'KeywordCounter', 'fold_old_runs']
