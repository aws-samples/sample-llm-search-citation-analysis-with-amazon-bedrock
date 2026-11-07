"""Rank check runs: the one-active-run lock, run items, (keyword, device) pairs and per-keyword state.

Items (table ``CitationAnalysis-SeoRankTracking``):

- ``TRACKER#<id>`` / ``ACTIVE_RUN``: the lock. Put only when absent or expired (``expires_at``, also the TTL
  backstop) and deleted, conditioned on its run id, when that run ends, so a tracker never has two runs paying
  for the same checks.
- ``TRACKER#<id>`` / ``RUN#<run_id>``: one run. Run ids start with their UTC start time, so the partition sorts
  runs by age. Status moves only forward from ``pending`` / ``running``; a run that already ended is never
  resurrected (every status write is conditioned on the status it expects).
- ``RUN#<run_id>`` / ``PAIR#<keyword_id>#<device>``: the work of one check and its best answer. Deterministic
  keys make a repeated write idempotent. A pair goes ``pending`` -> ``sent`` (marked before the paid call, so a
  repeated step never pays for it again) -> ``queued`` (task id known) -> ``answered`` or ``error``. Finalize
  sets its ``result_status`` and the ``GSI1`` history keys (``HIST#<tracker>#<keyword_id>`` /
  ``<checked_at>#<device>``).
- ``TRACKER#<id>`` / ``STATE#<keyword_id>``: the keyword's best position ever (the re-check baseline) and the
  newest result per device (the latest-results read).
"""

from __future__ import annotations

import secrets
from collections.abc import Callable, Iterable, Mapping, Sequence
from contextlib import suppress
from datetime import datetime, timedelta
from typing import Any

from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

from shared.dataforseo_rank import RankCheck
from shared.dynamo_decimal import plain
from shared.dynamodb_batch import collect_all_items
from shared.rank_tracking_retry import PairAnswer, is_better
from shared.rank_tracking_schedule import format_timestamp
from shared.rank_tracking_store import (
    StaleWriteError,
    TrackedKeyword,
    Tracker,
    device_list,
    is_conditional_failure,
    tracker_pk,
)

__all__ = [
    'ACTIVE_STATUSES',
    'LOCK_HOURS',
    'StartExecution',
    'apply_check',
    'apply_error',
    'begin_run',
    'fail_run',
    'get_run',
    'history_key',
    'latest_run',
    'list_runs',
    'load_pairs',
    'load_states',
    'pair_answer',
    'release_lock',
    'run_pk',
    'save_items',
    'set_run_status',
    'write_pairs',
]

ACTIVE_STATUSES = ('pending', 'running')
LOCK_HOURS = 4
"""Longer than the state machine's own timeout, so only a run that can no longer be running loses its lock."""

ANSWER_FIELDS = ('position', 'rank_absolute', 'url', 'serp_features', 'checked_at')
StartExecution = Callable[[str, dict[str, Any]], None]


def run_pk(run_id: str) -> str:
    return f'RUN#{run_id}'


def history_key(tracker_id: str, keyword_id: str) -> str:
    return f'HIST#{tracker_id}#{keyword_id}'


def new_run_id(now: datetime) -> str:
    """``YYYYMMDDTHHMMSSZ-<8 hex>``: sorts by start time and is a valid Step Functions execution name."""
    return f"{now.strftime('%Y%m%dT%H%M%SZ')}-{secrets.token_hex(4)}"


def save_items(table: Any, items: Iterable[Mapping[str, Any]]) -> None:
    with table.batch_writer() as batch:
        for item in items:
            batch.put_item(Item=dict(item))


# ---------------------------------------------------------------------------
# Lock
# ---------------------------------------------------------------------------

def _acquire_lock(table: Any, tracker_id: str, run_id: str, now: datetime) -> str | None:
    """``None`` when the lock is taken for ``run_id``, else the run id holding it."""
    expires = now + timedelta(hours=LOCK_HOURS)
    try:
        table.put_item(
            Item={'pk': tracker_pk(tracker_id), 'sk': 'ACTIVE_RUN', 'run_id': run_id,
                  'expires_at': format_timestamp(expires), 'ttl': int(expires.timestamp())},
            ConditionExpression=Attr('pk').not_exists() | Attr('expires_at').lt(format_timestamp(now)),
        )
    except ClientError as error:
        if not is_conditional_failure(error):
            raise
        held = table.get_item(Key={'pk': tracker_pk(tracker_id), 'sk': 'ACTIVE_RUN'}).get('Item') or {}
        return str(held.get('run_id') or 'unknown')
    return None


def release_lock(table: Any, tracker_id: str, run_id: str) -> None:
    """Delete the lock if ``run_id`` still holds it."""
    try:
        table.delete_item(Key={'pk': tracker_pk(tracker_id), 'sk': 'ACTIVE_RUN'},
                          ConditionExpression=Attr('run_id').eq(run_id))
    except ClientError as error:
        if not is_conditional_failure(error):
            raise


# ---------------------------------------------------------------------------
# Runs
# ---------------------------------------------------------------------------

def get_run(table: Any, tracker_id: str, run_id: str) -> dict[str, Any] | None:
    item = table.get_item(Key={'pk': tracker_pk(tracker_id), 'sk': run_pk(run_id)}).get('Item')
    return plain(item) if item else None


def latest_run(table: Any, tracker_id: str) -> dict[str, Any] | None:
    answer = table.query(
        KeyConditionExpression=Key('pk').eq(tracker_pk(tracker_id)) & Key('sk').begins_with('RUN#'),
        ScanIndexForward=False, Limit=1,
    )
    items = answer.get('Items') or []
    return plain(items[0]) if items else None


def list_runs(table: Any, tracker_id: str, since: datetime) -> list[dict[str, Any]]:
    """Runs started at or after ``since``, oldest first."""
    lower = f"RUN#{since.strftime('%Y%m%dT%H%M%SZ')}"
    items = collect_all_items(
        table.query,
        KeyConditionExpression=Key('pk').eq(tracker_pk(tracker_id)) & Key('sk').between(lower, 'RUN#~'),
    )
    return [plain(item) for item in items]


def set_run_status(table: Any, run: Mapping[str, Any], expected: Sequence[str], **changes: Any) -> dict[str, Any]:
    """Write ``changes`` to ``run`` if its stored status is one of ``expected``; ``StaleWriteError`` otherwise."""
    updated = {key: value for key, value in {**run, **changes}.items() if value is not None}
    try:
        table.put_item(Item=updated, ConditionExpression=Attr('status').is_in(list(expected)))
    except ClientError as error:
        if is_conditional_failure(error):
            raise StaleWriteError(str(run.get('run_id'))) from error
        raise
    return updated


def _run_item(tracker: Tracker, run_id: str, trigger: str, now: datetime) -> dict[str, Any]:
    return {
        'pk': tracker_pk(tracker.tracker_id), 'sk': run_pk(run_id), 'run_id': run_id,
        'tracker_id': tracker.tracker_id, 'status': 'pending', 'trigger': trigger,
        'method': 'live' if trigger == 'manual' else 'queued', 'is_subset': False,
        'devices': device_list(tracker.devices), 'depth': tracker.depth, 'keywords_total': 0,
        'started_at': format_timestamp(now),
    }


def begin_run(table: Any, start_execution: StartExecution, tracker: Tracker, trigger: str,
              now: datetime) -> tuple[dict[str, Any] | None, str | None]:
    """``(run, None)`` for a started run, or ``(None, blocking_run_id)`` while another run is active.

    The lock is taken first; if the state machine cannot be started the run is failed and the lock released,
    so the tracker is free again, and the error propagates.
    """
    run_id = new_run_id(now)
    blocking = _acquire_lock(table, tracker.tracker_id, run_id, now)
    if blocking is not None:
        return None, blocking
    run = _run_item(tracker, run_id, trigger, now)
    table.put_item(Item=run)
    try:
        start_execution(run_id, {'tracker_id': tracker.tracker_id, 'run_id': run_id})
    except Exception:
        fail_run(table, tracker.tracker_id, run_id, 'START_FAILED', 'The rank check could not be started.', now)
        raise
    return run, None


def fail_run(table: Any, tracker_id: str, run_id: str, code: str, message: str, now: datetime) -> bool:
    """Mark a still-active run failed and free the tracker; ``False`` when the run had already ended."""
    run = get_run(table, tracker_id, run_id)
    failed = False
    if run is not None and run.get('status') in ACTIVE_STATUSES:
        with suppress(StaleWriteError):
            set_run_status(table, run, ACTIVE_STATUSES, status='failed', error_code=code, error_message=message,
                           completed_at=format_timestamp(now))
            failed = True
    release_lock(table, tracker_id, run_id)
    return failed


# ---------------------------------------------------------------------------
# Pairs and keyword state
# ---------------------------------------------------------------------------

def write_pairs(table: Any, tracker: Tracker, run_id: str, keywords: Sequence[TrackedKeyword]) -> int:
    """One ``pending`` pair per keyword and device; the number written."""
    items = [
        {'pk': run_pk(run_id), 'sk': f'PAIR#{keyword.keyword_id}#{device}', 'run_id': run_id,
         'tracker_id': tracker.tracker_id, 'keyword_id': keyword.keyword_id, 'keyword': keyword.keyword,
         'device': device, 'status': 'pending', 'answered': False}
        for keyword in keywords for device in device_list(tracker.devices)
    ]
    save_items(table, items)
    return len(items)


def load_pairs(table: Any, run_id: str) -> list[dict[str, Any]]:
    items = collect_all_items(
        table.query, KeyConditionExpression=Key('pk').eq(run_pk(run_id)) & Key('sk').begins_with('PAIR#'),
    )
    return [plain(item) for item in items]


def load_states(table: Any, tracker_id: str) -> dict[str, dict[str, Any]]:
    items = collect_all_items(
        table.query, KeyConditionExpression=Key('pk').eq(tracker_pk(tracker_id)) & Key('sk').begins_with('STATE#'),
    )
    return {str(item['keyword_id']): plain(item) for item in items}


def pair_answer(pair: Mapping[str, Any]) -> PairAnswer:
    position = pair.get('position')
    return PairAnswer(
        keyword_id=str(pair['keyword_id']), device=str(pair['device']), answered=bool(pair.get('answered')),
        position=position if isinstance(position, int) else None,
    )


def apply_check(pair: Mapping[str, Any], check: RankCheck, checked_at: str) -> dict[str, Any]:
    """``pair`` after an answer: the answer is kept only when it is the first or a better one."""
    current = pair.get('position')
    updated: dict[str, Any] = {**pair, 'status': 'answered'}
    updated.pop('task_id', None)
    if not is_better(bool(pair.get('answered')), current if isinstance(current, int) else None, check.position):
        return updated
    for key in ANSWER_FIELDS:
        updated.pop(key, None)
    answer = {'position': check.position, 'rank_absolute': check.rank_absolute, 'url': check.url}
    updated.update({key: value for key, value in answer.items() if value is not None})
    updated.update(answered=True, serp_features=list(check.serp_features), checked_at=checked_at)
    return updated


def apply_error(pair: Mapping[str, Any], code: str) -> dict[str, Any]:
    """``pair`` after a failed check: an earlier answer stands, else the pair is an error."""
    updated = {**pair, 'error_code': code}
    updated.pop('task_id', None)
    updated['status'] = 'answered' if pair.get('answered') else 'error'
    return updated
