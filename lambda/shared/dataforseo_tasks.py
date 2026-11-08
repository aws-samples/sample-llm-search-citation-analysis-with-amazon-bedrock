"""DataForSEO standard-queue tasks: ``task_post`` (billed) and the free ``task_get``.

The queue costs about a third of a live call, so recurring work (scheduled rank checks and every retry round)
goes through it. Two rules keep it from paying twice:

- ``post_tasks`` is never retried, on a 5xx, a timeout or anything else: DataForSEO bills a queued task when it
  is posted, so a failed post may already have been charged and re-sending it would charge again. A top-level
  failure raises ``DataForSeoError``; per-entry rejections come back in ``PostedTasks.rejected`` and the caller
  treats those pairs as unanswered.
- Tasks are matched back by their ``tag`` (echoed in ``data.tag``), never by the order of the answer.

``get_task`` is free and idempotent, so it keeps the client's 5xx retries. A transport or top-level failure
raises ``DataForSeoError`` (the caller keeps the task pending and polls again). At task level: "Task Created",
"Task Handed" and "Task In Queue" are still running; a DataForSEO backend failure is also left pending, to be
polled again; "No Search Results" (matched on the message, since its code 40501 also means "Invalid Field") is a
completed task with ``result=None``; every other code is a failed task.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from shared.dataforseo_client import (
    OK_STATUS,
    TASK_CREATED_STATUS,
    UPSTREAM_FAILURE_STATUS_CODES,
    DataForSeoError,
    EnvelopeReading,
    send_envelope,
)

__all__ = [
    'IN_PROGRESS_STATUS_CODES',
    'MAX_TASKS_PER_POST',
    'PostedTasks',
    'TaskOutcome',
    'get_task',
    'post_tasks',
]

MAX_TASKS_PER_POST = 100
"""DataForSEO accepts at most 100 tasks in one ``task_post``."""

IN_PROGRESS_STATUS_CODES = frozenset({TASK_CREATED_STATUS, 40601, 40602})
"""20100 Task Created, 40601 Task Handed, 40602 Task In Queue."""

POST_TIMEOUT_S = 60.0
GET_TIMEOUT_S = 25.0
_NO_RESULTS = 'no search results'


@dataclass(frozen=True)
class PostedTasks:
    """The answer to one ``task_post`` of up to 100 tasks."""

    accepted: dict[str, str]
    """``tag`` -> DataForSEO task id, for every entry accepted (status 20100)."""
    rejected: dict[str, str]
    """``tag`` -> DataForSEO status message, for every entry refused or missing from the answer."""
    cost_usd: float
    """Summed over every entry, accepted or not (DataForSEO bills at post time)."""


@dataclass(frozen=True)
class TaskOutcome:
    """One ``task_get``: still running, failed, or done with its ``result[0]`` (``None`` = no results)."""

    status: Literal['pending', 'failed', 'completed']
    result: dict[str, Any] | None
    message: str | None


def _tags(tasks: Sequence[Mapping[str, Any]]) -> list[str]:
    """The tags of ``tasks``; raises ``ValueError`` when one is missing or repeated."""
    tags = [task.get('tag') for task in tasks]
    if not all(isinstance(tag, str) and tag for tag in tags):
        raise ValueError('every queued task needs a tag')
    known = [str(tag) for tag in tags]
    if len(set(known)) != len(known):
        raise ValueError('queued task tags must be unique')
    return known


def _entry_tag(entry: Mapping[str, Any]) -> str | None:
    data = entry.get('data')
    tag = data.get('tag') if isinstance(data, Mapping) else None
    return tag if isinstance(tag, str) else None


def _entry_cost(entry: Mapping[str, Any]) -> float:
    cost = entry.get('cost')
    return float(cost) if isinstance(cost, int | float) and not isinstance(cost, bool) else 0.0


def _read_entries(entries: object, tags: Sequence[str]) -> PostedTasks:
    """Accepted and rejected tags of a successful ``task_post`` answer; the cost of every entry."""
    accepted: dict[str, str] = {}
    rejected: dict[str, str] = {}
    cost = 0.0
    known = set(tags)
    for entry in entries if isinstance(entries, list) else []:
        if not isinstance(entry, Mapping):
            continue
        cost += _entry_cost(entry)
        tag = _entry_tag(entry)
        if tag is None or tag not in known:
            continue
        task_id = entry.get('id')
        if entry.get('status_code') == TASK_CREATED_STATUS and isinstance(task_id, str) and task_id:
            accepted[tag] = task_id
        else:
            rejected[tag] = str(entry.get('status_message') or 'DataForSEO rejected the task')
    for tag in tags:
        if tag not in accepted and tag not in rejected:
            rejected[tag] = 'DataForSEO did not answer for this task'
    return PostedTasks(accepted=accepted, rejected=rejected, cost_usd=round(cost, 6))


def post_tasks(path: str, tasks: list[dict[str, Any]], *, priority: int | None = None,
               pingback_url: str | None = None) -> PostedTasks:
    """POST ``tasks`` (1..100, each with a unique ``tag``) to a ``.../task_post`` path; never retried (billed).

    ``pingback_url`` is set on every task: DataForSEO calls it when the task is ready (``shared.dataforseo_callbacks``).
    """
    if not 1 <= len(tasks) <= MAX_TASKS_PER_POST:
        raise ValueError(f'a task_post takes 1 to {MAX_TASKS_PER_POST} tasks, got {len(tasks)}')
    tags = _tags(tasks)
    extra: dict[str, Any] = {}
    if priority is not None:
        extra['priority'] = priority
    if pingback_url is not None:
        extra['pingback_url'] = pingback_url
    sent = [{**task, **extra} for task in tasks]

    def read(envelope: dict[str, Any]) -> EnvelopeReading[PostedTasks]:
        posted = _read_entries(envelope.get('tasks'), tags)
        return EnvelopeReading(posted, cost_usd=posted.cost_usd)

    return send_envelope('POST', path, json.dumps(sent).encode('utf-8'), idempotent=False,
                         timeout_s=POST_TIMEOUT_S, read=read)


def _outcome(task: Mapping[str, Any]) -> TaskOutcome:
    status = task.get('status_code')
    message = str(task.get('status_message') or '')
    if status in IN_PROGRESS_STATUS_CODES or status in UPSTREAM_FAILURE_STATUS_CODES:
        return TaskOutcome(status='pending', result=None, message=message or None)
    if status == OK_STATUS:
        result = task.get('result')
        first = result[0] if isinstance(result, list) and result and isinstance(result[0], dict) else None
        return TaskOutcome(status='completed', result=first, message=None)
    if _NO_RESULTS in message.lower():
        return TaskOutcome(status='completed', result=None, message=message)
    return TaskOutcome(status='failed', result=None, message=message or 'DataForSEO task failed')


def _only_task(envelope: Mapping[str, Any]) -> EnvelopeReading[dict[str, Any]]:
    """The first task of a ``task_get`` answer (it holds exactly one)."""
    entries = envelope.get('tasks')
    first = next(iter(entries), None) if isinstance(entries, list) else None
    if isinstance(first, dict):
        return EnvelopeReading(first, task_status_code=first.get('status_code'))
    raise DataForSeoError('INTERNAL_ERROR', 'DataForSEO response missing task')


def get_task(path_prefix: str, task_id: str) -> TaskOutcome:
    """Free GET ``{path_prefix}/{task_id}`` (e.g. ``/v3/serp/google/organic/task_get/advanced``); idempotent.

    Raises ``DataForSeoError`` on a transport or top-level failure, after which the task is still pending.
    """
    path = f"{path_prefix.rstrip('/')}/{task_id}"
    task = send_envelope('GET', path, None, idempotent=True, timeout_s=GET_TIMEOUT_S, read=_only_task)
    return _outcome(task)
