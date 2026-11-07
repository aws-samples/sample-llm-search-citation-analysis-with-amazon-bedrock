"""The scheduler tick: start the rank checks of due trackers (an EventBridge rule runs it every 15 minutes).

Per tick at most ``DUE_PER_TICK`` trackers, oldest slot first (``GSI2``). For each one:

1. The next slot is computed from the due slot (``shared.rank_tracking_schedule``), never from now, so a late
   tick does not shift the schedule.
2. A tracker without keywords is advanced with ``last_skip_reason='no_keywords'`` and not run.
3. The tracker is claimed by writing the next slot conditioned on the version that was read. Losing that
   race means another tick or an edit got there first: the tracker is skipped.
4. The run is started (``begin_run``). If another run is still active, the claim is undone (the slot goes back
   to the due value) so the tracker is picked up again next tick. If the state machine cannot be started the
   schedule stays advanced, so an outage does not make every tracker due again at once.

Any error before the claim leaves the tracker untouched and due: its slot is the schedule's anchor, and writing
it on an error would move every failing tracker to the same new time.
"""

from __future__ import annotations

import json
import logging
from collections import Counter
from dataclasses import replace
from datetime import datetime
from typing import Any

from boto3.dynamodb.conditions import Key

from shared.rank_tracking_runs import StartExecution, begin_run
from shared.rank_tracking_schedule import format_timestamp, next_check_at, parse_timestamp
from shared.rank_tracking_store import (
    DUE_INDEX_KEY,
    StaleWriteError,
    Tracker,
    put_tracker,
    resolve_run_keywords,
)

__all__ = ['DUE_PER_TICK', 'due_trackers', 'tick']

logger = logging.getLogger(__name__)

DUE_PER_TICK = 50


def due_trackers(table: Any, now: datetime) -> list[Tracker]:
    answer = table.query(
        IndexName='GSI2',
        KeyConditionExpression=Key('gsi2pk').eq(DUE_INDEX_KEY) & Key('gsi2sk').lte(f'{format_timestamp(now)}#~'),
        ScanIndexForward=True, Limit=DUE_PER_TICK,
    )
    return [Tracker.from_item(item) for item in answer.get('Items') or []]


def _advanced(tracker: Tracker, now: datetime, skip_reason: str | None) -> Tracker:
    anchor = parse_timestamp(tracker.next_check_at) if tracker.next_check_at else None
    following = next_check_at(tracker.schedule, anchor, now)
    return replace(tracker, next_check_at=format_timestamp(following) if following else None,
                   last_skip_reason=skip_reason)


def _start(table: Any, start_execution: StartExecution, tracker: Tracker, now: datetime) -> str:
    """Claim and start one due tracker; the outcome name for the tick summary."""
    claimed = put_tracker(table, _advanced(tracker, now, None), tracker.version)
    try:
        run, _blocking = begin_run(table, start_execution, claimed, 'scheduled', now)
    except Exception:
        logger.exception('rank.tick could not start tracker %s', tracker.tracker_id)
        return 'start_failed'
    if run is not None:
        return 'started'
    try:
        put_tracker(table, replace(claimed, next_check_at=tracker.next_check_at), claimed.version)
    except StaleWriteError:
        logger.info('rank.tick could not restore tracker %s after a busy run', tracker.tracker_id)
    return 'already_running'


def _handle(table: Any, keywords_table: Any, start_execution: StartExecution, tracker: Tracker,
            now: datetime) -> str:
    if not tracker.is_active or tracker.schedule == 'manual':
        return 'not_scheduled'
    if not resolve_run_keywords(table, keywords_table, tracker):
        put_tracker(table, _advanced(tracker, now, 'no_keywords'), tracker.version)
        return 'no_keywords'
    return _start(table, start_execution, tracker, now)


def tick(table: Any, keywords_table: Any, start_execution: StartExecution, now: datetime) -> dict[str, int]:
    """Start the due trackers' runs; the count of each outcome."""
    outcomes: Counter[str] = Counter()
    for tracker in due_trackers(table, now):
        try:
            outcomes[_handle(table, keywords_table, start_execution, tracker, now)] += 1
        except StaleWriteError:
            outcomes['claim_lost'] += 1
        except Exception:
            logger.exception('rank.tick left tracker %s due after an error', tracker.tracker_id)
            outcomes['error'] += 1
    summary = dict(outcomes)
    logger.info('%s', json.dumps({'event': 'rank_tracking_scheduler_summary', **summary}))
    return summary
