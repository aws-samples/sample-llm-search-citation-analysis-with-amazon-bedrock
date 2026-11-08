"""``rank.due``: start the scheduled check of one tracker when its own schedule fires.

Each scheduled tracker has a one-time EventBridge Scheduler schedule at its slot (``shared.rank_tracking_timer``).
When it fires:

1. A tracker that is gone, archived or ``manual`` gets its schedule deleted and is not run. A tracker whose slot
   is still ahead (it was edited after the schedule fired) gets its schedule moved to that slot.
2. The next slot is computed from the due slot (``shared.rank_tracking_schedule``), never from now, so a late
   fire does not shift the schedule.
3. A tracker without keywords is advanced with ``last_skip_reason='no_keywords'`` and not run.
4. The tracker is claimed by writing the next slot conditioned on the version that was read. Losing that race
   means an edit got there first: the edit has already moved the schedule.
5. The run is started (``begin_run``). If another run is still active, the claim is undone (the slot goes back
   to the due value) and the schedule fires again ``BUSY_RETRY`` later. If the state machine cannot be started
   the schedule stays advanced, so an outage does not make the tracker due again at once.

An error before the claim leaves the tracker due: its slot is the schedule's anchor. The schedule then fires
again ``BUSY_RETRY`` later instead of never.
"""

from __future__ import annotations

import json
import logging
from dataclasses import replace
from datetime import datetime, timedelta
from typing import Any

from shared.rank_tracking_runs import StartExecution, begin_run
from shared.rank_tracking_schedule import format_timestamp, next_check_at, parse_timestamp
from shared.rank_tracking_store import (
    StaleWriteError,
    Tracker,
    get_tracker,
    put_tracker,
    resolve_run_keywords,
)
from shared.rank_tracking_timer import MIN_LEAD, scheduled_time, sync_schedule

__all__ = ['BUSY_RETRY', 'run_due']

logger = logging.getLogger(__name__)

BUSY_RETRY = timedelta(minutes=15)
_RETRIED = frozenset({'already_running', 'error'})


def _advanced(tracker: Tracker, now: datetime, skip_reason: str | None) -> Tracker:
    anchor = parse_timestamp(tracker.next_check_at) if tracker.next_check_at else None
    following = next_check_at(tracker.schedule, anchor, now)
    return replace(tracker, next_check_at=format_timestamp(following) if following else None,
                   last_skip_reason=skip_reason)


def _start(table: Any, start_execution: StartExecution, tracker: Tracker, now: datetime) -> str:
    """Claim and start one due tracker; the outcome name."""
    claimed = put_tracker(table, _advanced(tracker, now, None), tracker.version)
    try:
        run, _blocking = begin_run(table, start_execution, claimed, 'scheduled', now)
    except Exception:
        logger.exception('rank.due could not start tracker %s', tracker.tracker_id)
        return 'start_failed'
    if run is not None:
        return 'started'
    try:
        put_tracker(table, replace(claimed, next_check_at=tracker.next_check_at), claimed.version)
    except StaleWriteError:
        logger.info('rank.due could not restore tracker %s after a busy run', tracker.tracker_id)
    return 'already_running'


def _handle(table: Any, keywords_table: Any, start_execution: StartExecution, tracker: Tracker | None,
            now: datetime) -> str:
    slot = scheduled_time(tracker)
    if tracker is None or slot is None:
        return 'not_scheduled'
    if slot > now + MIN_LEAD:
        return 'not_due'
    if not resolve_run_keywords(table, keywords_table, tracker):
        put_tracker(table, _advanced(tracker, now, 'no_keywords'), tracker.version)
        return 'no_keywords'
    return _start(table, start_execution, tracker, now)


def run_due(table: Any, keywords_table: Any, start_execution: StartExecution, tracker_id: str, now: datetime,
            scheduler: Any = None) -> dict[str, Any]:
    """Start the tracker's check when it is due and move its schedule; the outcome and the next fire time."""
    try:
        outcome = _handle(table, keywords_table, start_execution, get_tracker(table, tracker_id), now)
    except StaleWriteError:
        outcome = 'claim_lost'
    except Exception:
        logger.exception('rank.due left tracker %s due after an error', tracker_id)
        outcome = 'error'
    retry_at = now + BUSY_RETRY if outcome in _RETRIED else None
    fires = sync_schedule(get_tracker(table, tracker_id), now, tracker_id=tracker_id, at=retry_at, client=scheduler)
    summary = {'tracker_id': tracker_id, 'outcome': outcome, 'next_fire_at': format_timestamp(fires) if fires else None}
    logger.info('%s', json.dumps({'event': 'rank_tracking_due', **summary}))
    return summary
