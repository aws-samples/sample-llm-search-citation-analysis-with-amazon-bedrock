"""
An export waiting on a view job, resumed by the job's ``view-job.finished`` event (2.49.0, issue #214).

A chunk that meets a view job still computing ends with the job's run
(``{id, started_at}``, from the route's ``202``). The export state machine's
``WaitForViewJob`` step then invokes the worker with a task token
(``waitForTaskToken``) and the execution pauses: no state runs and no Lambda
is billed until the token comes back.

- ``register_wait`` adds the token to the run's *waiter* item in the jobs
  table (key ``view-job#<job id>#<started_at>``, no ``owner``, so neither
  the owner index nor ``ExportJobs.owned`` sees it). Several exports can
  wait on one run, so the item holds every token. Each write is a
  conditional put on the item's ``revision`` (the IAM the jobs already
  have), so the append and the check that the run has not finished are one
  step: a run that finished before the token was registered (its event came
  first) resumes the export at once.
- ``finish_view_job`` (the rule's target) marks the run ``finished`` and
  sends every token back: task success for ``done``, task failure
  ``ViewJobFailed`` for ``failed`` (the state machine's catch then fails the
  export). A token whose task already ended (timed out, stopped) is skipped,
  and an event delivered twice sends again harmlessly.

The run is keyed by ``started_at`` because a failed or dead job starts
again under the same id: the end of one run never resumes an export waiting
on the next. A waiter item expires ``WAITER_RETENTION_SECONDS`` after its last write.

When an event is lost, the ``WaitForViewJob`` timeout runs ``ExportChunk``
once more, and that chunk fails the export if the same job still computes
(``shared.export_steps.ViewJobTimeoutError``).
"""

from __future__ import annotations

import json
import logging
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

from shared.dynamodb_conditions import applied_conditionally
from shared.view_job_events import STATUS_DONE, STATUS_FAILED

logger = logging.getLogger(__name__)

WAITER_PREFIX: Final = 'view-job#'
#: Exports one run may hold waiting (a task token is at most 1 KiB; the item stays far under 400 KB).
MAX_WAITERS: Final = 100
#: Seconds a waiter item outlives its last write (DynamoDB TTL), well past any wait's timeout.
WAITER_RETENTION_SECONDS: Final = 24 * 3600
#: Times a write is tried again after another writer changed the waiter item.
WRITE_ATTEMPTS: Final = 10
#: The error a failed view job fails its waiting exports with (the export's message names it).
VIEW_JOB_FAILED_ERROR: Final = 'ViewJobFailed'
_FAILED_CAUSE: Final = 'The view job the export reads failed.'
#: What Step Functions answers for a token whose task already ended: nothing left to resume.
_ENDED_TASK_CODES: Final = frozenset({'TaskDoesNotExist', 'TaskTimedOut', 'InvalidToken'})
_FINISHED: Final = frozenset({STATUS_DONE, STATUS_FAILED})


class ViewJobWaitError(RuntimeError):
    """The token could not be registered (too many waiters, or the item kept changing): the export fails."""


@dataclass(frozen=True)
class ViewJobRun:
    """One run of a view job: its id and when that run started."""

    job_id: str
    started_at: str

    @property
    def key(self) -> str:
        return f'{WAITER_PREFIX}{self.job_id}#{self.started_at}'

    def answer(self) -> dict[str, str]:
        """The run as a chunk answers it (``view_job``) and the state machine passes it back."""
        return {'id': self.job_id, 'started_at': self.started_at}


def run_from(value: Any) -> ViewJobRun | None:
    """The run ``value`` names (``{id, started_at}``, non-empty strings), else ``None``."""
    if not isinstance(value, Mapping):
        return None
    job, started_at = value.get('id'), value.get('started_at')
    if not isinstance(job, str) or not job or not isinstance(started_at, str) or not started_at:
        return None
    return ViewJobRun(job, started_at)


def _waiter(table: Any, run: ViewJobRun) -> dict[str, Any] | None:
    return table.get_item(Key={'export_id': run.key}, ConsistentRead=True).get('Item')


def _replace(table: Any, current: Mapping[str, Any] | None, changes: Mapping[str, Any], now: datetime, run: ViewJobRun) -> bool:
    """Write the waiter item with ``changes`` if nobody wrote it since ``current`` was read; whether it was written."""
    revision = 0 if current is None else int(current['revision'])
    item = {
        **(current or {}), **changes, 'export_id': run.key, 'revision': revision + 1,
        'expires_at': int(now.timestamp()) + WAITER_RETENTION_SECONDS,
    }
    condition = Attr('export_id').not_exists() if current is None else Attr('revision').eq(revision)
    return applied_conditionally(lambda: table.put_item(Item=item, ConditionExpression=condition))


def _send(sfn: Any, token: str, status: str) -> bool:
    """Send ``token`` back for a run that ended with ``status``; ``False`` when its task already ended."""
    try:
        if status == STATUS_DONE:
            sfn.send_task_success(taskToken=token, output=json.dumps({'view_job': status}))
        else:
            sfn.send_task_failure(taskToken=token, error=VIEW_JOB_FAILED_ERROR, cause=_FAILED_CAUSE)
    except ClientError as error:
        if error.response.get('Error', {}).get('Code') in _ENDED_TASK_CODES:
            return False
        raise
    return True


def register_wait(table: Any, sfn: Any, run: ViewJobRun, token: str, now: datetime) -> dict[str, Any]:
    """
    Register ``token`` against ``run``; when the run already finished, send it back now instead.

    Raises:
        ViewJobWaitError: ``MAX_WAITERS`` exports already wait on the run, or the item kept changing.
    """
    for _attempt in range(WRITE_ATTEMPTS):
        current = _waiter(table, run)
        finished = None if current is None else current.get('finished')
        if finished in _FINISHED:
            _send(sfn, token, str(finished))
            return {'job_id': run.job_id, 'waiting': False, 'finished': finished}
        tokens = [str(waiting) for waiting in (current or {}).get('tokens') or ()]
        if len(tokens) >= MAX_WAITERS:
            raise ViewJobWaitError(f'{MAX_WAITERS} exports already wait on view job {run.job_id}')
        if _replace(table, current, {'tokens': [*tokens, token]}, now, run):
            return {'job_id': run.job_id, 'waiting': True}
    raise ViewJobWaitError(f'the waiters of view job {run.job_id} kept changing')


def finish_view_job(table: Any, sfn: Any, run: ViewJobRun, status: str, now: datetime) -> dict[str, Any]:
    """
    Mark ``run`` finished with ``status`` and send back every token waiting on it; how many tasks resumed.

    A token Step Functions refuses for another reason (throttling, access)
    raises after every token was tried, so Lambda's asynchronous retry of the
    rule's invocation (twice, within the wait's timeout) sends again.
    """
    if status not in _FINISHED:
        raise ValueError(f'a view job finishes done or failed, not {status!r}')
    tokens: list[str] = []
    for _attempt in range(WRITE_ATTEMPTS):
        current = _waiter(table, run)
        tokens = [str(waiting) for waiting in (current or {}).get('tokens') or ()]
        if current is not None and current.get('finished') in _FINISHED:
            status = str(current['finished'])
            break
        if _replace(table, current, {'finished': status}, now, run):
            break
    else:
        raise ViewJobWaitError(f'the waiters of view job {run.job_id} kept changing')
    resumed, refused = 0, None
    for token in tokens:
        try:
            resumed += _send(sfn, token, status)
        except ClientError as error:
            logger.exception('View job %s: a waiting export could not be resumed', run.job_id)
            refused = refused or error
    if refused is not None:
        raise refused
    return {'job_id': run.job_id, 'status': status, 'waiting': len(tokens), 'resumed': resumed}
