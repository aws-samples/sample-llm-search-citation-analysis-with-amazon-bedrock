"""Backlinks job steps (``backlinks.*``), run by the ``CitationAnalysis-SeoBacklinkSnapshots`` state machine.

``backlinks.snapshot_all`` takes one snapshot of every tracked domain (``shared.backlink_snapshots``): one billed
``summary/live`` per domain with its subdomains, one after the other.

* A run is started by an Admin or by a Schedule (Operations > Schedule); while no schedule exists nothing runs.
* A domain snapshotted less than 20 hours ago is skipped, so a manual run next to the weekly one, or a run started
  again after a failure, never pays twice for the same week.
* DataForSEO bills a call that fails after it was sent, so a failed domain is never retried; a balance, login or
  configuration failure stops the run, since every following call would fail the same way.
* An empty summary (DataForSEO has no data for the domain) is not stored: it would draw a false drop to zero.
* The step stops starting new calls 13 minutes in (the function has 15); the rest are reported as ``deferred``
  and taken by the next run.

The answer is counts only (the state machine keeps it as its output).
"""

from __future__ import annotations

import functools
import logging
import time
from datetime import timedelta
from typing import Any

import boto3

from shared.backlink_snapshots import (
    TrackedDomain,
    latest_snapshot_at,
    snapshot_item,
    snapshots_table,
    tracked_domains,
)
from shared.backlinks_target import backlinks_target
from shared.dataforseo_backlinks import fetch_summary
from shared.dataforseo_client import DataForSeoError
from shared.env_vars import resolve_table_env
from shared.utils import get_timestamp, parse_timestamp, utc_now

logger = logging.getLogger(__name__)

RECENT_SNAPSHOT = timedelta(hours=20)
TIME_BUDGET_S = 13 * 60
STOP_CODES = frozenset({'NOT_CONFIGURED', 'AUTH_FAILED', 'BILLING_ISSUE'})


@functools.cache
def brand_config_table() -> Any:
    return boto3.resource('dynamodb').Table(resolve_table_env('DYNAMODB_TABLE_BRAND_CONFIG'))


def brand_config() -> dict[str, Any]:
    return brand_config_table().get_item(Key={'config_id': 'default'}).get('Item') or {}


def _monotonic() -> float:
    return time.monotonic()


def _is_recent(table: Any, domain: str) -> bool:
    taken = parse_timestamp(latest_snapshot_at(table, domain))
    return taken is not None and utc_now() - taken < RECENT_SNAPSHOT


class SnapshotRun:
    """The counts of one run, and the decision whether it may go on."""

    def __init__(self, total: int) -> None:
        self.counts = {'domains': total, 'stored': 0, 'recent': 0, 'empty': 0, 'failed': 0, 'deferred': 0}
        self.stopped: str | None = None

    def take(self, table: Any, tracked: TrackedDomain) -> None:
        if _is_recent(table, tracked.domain):
            self.counts['recent'] += 1
            return
        try:
            metrics, _cost = fetch_summary(backlinks_target(tracked.domain, 'subdomains'))
        except DataForSeoError as error:
            logger.warning('backlinks.snapshot failed domain=%s code=%s', tracked.domain, error.code)
            self.counts['failed'] += 1
            if error.code in STOP_CODES:
                self.stopped = error.code
            return
        if metrics is None or all(value is None for value in metrics.values()):
            self.counts['empty'] += 1
            return
        table.put_item(Item=snapshot_item(tracked.domain, metrics, get_timestamp()))
        self.counts['stored'] += 1


def snapshot_all(_event: dict[str, Any]) -> dict[str, Any]:
    """Snapshot every tracked domain."""
    table = snapshots_table()
    domains = tracked_domains(brand_config())
    run = SnapshotRun(len(domains))
    started = _monotonic()
    for index, tracked in enumerate(domains):
        if run.stopped is not None or _monotonic() - started > TIME_BUDGET_S:
            run.counts['deferred'] = len(domains) - index
            break
        run.take(table, tracked)
    logger.info('backlinks.snapshot_all %s stopped=%s', run.counts, run.stopped)
    return {**run.counts, 'stopped': run.stopped}


STEPS = {'backlinks.snapshot_all': snapshot_all}
