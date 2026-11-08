"""One EventBridge Scheduler schedule per scheduled rank tracker: its next check.

Each scheduled tracker has a one-time ``at(...)`` schedule ``rank-<tracker_id>`` in the
``citation-analysis-seo-rank`` group, at its ``next_check_at``. It invokes the SEO jobs function with
``{"step": "rank.due", "tracker_id": ...}``; that step starts the run and moves the schedule to the next slot.
Nothing runs between checks: there is no tick to look for due trackers.

``sync_schedule`` makes the schedule match the tracker: created or moved while the tracker is active, scheduled
and has a slot; deleted otherwise (archived, switched to ``manual``). The tracker routes call it after every save
that can change the slot, and ``rank.due`` after every run it starts. ``at`` overrides the slot for a retry
(another run still active, an error before the claim): the tracker keeps its slot and the schedule fires again
then. A slot already in the past fires ``MIN_LEAD`` from now.

The schedule's Description is the tracker's name (domain and market), which the Schedule page lists read-only.
"""

from __future__ import annotations

import contextlib
import functools
import json
import os
from datetime import datetime, timedelta
from typing import Any

import boto3

from shared.rank_tracking_schedule import parse_timestamp
from shared.rank_tracking_store import Tracker

__all__ = [
    'DUE_STEP',
    'MIN_LEAD',
    'ROLE_ENV',
    'SCHEDULE_GROUP',
    'TARGET_ENV',
    'schedule_name',
    'scheduled_time',
    'sync_schedule',
]

SCHEDULE_GROUP = 'citation-analysis-seo-rank'
TARGET_ENV = 'RANK_TRACKER_TARGET_ARN'
"""The SEO jobs function's ARN."""
ROLE_ENV = 'RANK_TRACKER_SCHEDULER_ROLE_ARN'
"""The role EventBridge Scheduler assumes to invoke it."""
DUE_STEP = 'rank.due'
MIN_LEAD = timedelta(minutes=1)
TARGET_RETRY_ATTEMPTS = 3
"""Scheduler retries of a failed invocation; ``rank.due`` is safe to repeat (it claims on the tracker version)."""
TARGET_MAX_EVENT_AGE_S = 3600


@functools.cache
def _scheduler() -> Any:
    return boto3.client('scheduler')


def schedule_name(tracker_id: str) -> str:
    return f'rank-{tracker_id}'


def scheduled_time(tracker: Tracker | None) -> datetime | None:
    """When ``tracker`` should be checked next, or ``None`` when it runs only on demand."""
    if tracker is None or not tracker.is_active or tracker.schedule == 'manual' or not tracker.next_check_at:
        return None
    return parse_timestamp(tracker.next_check_at)


def _at_expression(moment: datetime) -> str:
    return f"at({moment.strftime('%Y-%m-%dT%H:%M:%S')})"


def _definition(tracker: Tracker, moment: datetime) -> dict[str, Any]:
    return {
        'Name': schedule_name(tracker.tracker_id),
        'GroupName': SCHEDULE_GROUP,
        'ScheduleExpression': _at_expression(moment),
        'ScheduleExpressionTimezone': 'UTC',
        'FlexibleTimeWindow': {'Mode': 'OFF'},
        'State': 'ENABLED',
        'Description': f'{tracker.domain} ({tracker.market_id})',
        'ActionAfterCompletion': 'NONE',
        'Target': {
            'Arn': os.environ[TARGET_ENV],
            'RoleArn': os.environ[ROLE_ENV],
            'Input': json.dumps({'step': DUE_STEP, 'tracker_id': tracker.tracker_id}),
            'RetryPolicy': {
                'MaximumRetryAttempts': TARGET_RETRY_ATTEMPTS,
                'MaximumEventAgeInSeconds': TARGET_MAX_EVENT_AGE_S,
            },
        },
    }


def _delete(client: Any, tracker_id: str) -> None:
    with contextlib.suppress(client.exceptions.ResourceNotFoundException):
        client.delete_schedule(Name=schedule_name(tracker_id), GroupName=SCHEDULE_GROUP)


def sync_schedule(tracker: Tracker | None, now: datetime, *, tracker_id: str | None = None,
                  at: datetime | None = None, client: Any = None) -> datetime | None:
    """Create, move or delete the tracker's schedule; the time it fires, or ``None`` once deleted.

    ``tracker_id`` names the schedule to delete when the tracker itself is gone.
    """
    scheduler = client or _scheduler()
    slot = scheduled_time(tracker)
    if tracker is None or slot is None:
        name = tracker.tracker_id if tracker is not None else tracker_id
        if name:
            _delete(scheduler, name)
        return None
    moment = max(at or slot, now + MIN_LEAD)
    definition = _definition(tracker, moment)
    try:
        scheduler.update_schedule(**definition)
    except scheduler.exceptions.ResourceNotFoundException:
        scheduler.create_schedule(**definition)
    return moment
