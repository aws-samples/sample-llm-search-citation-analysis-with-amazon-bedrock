"""
Re-extract jobs (2.55.0): the ``CitationAnalysis-ReextractJobs`` table (PK ``job_id``, no TTL: each job is the audit
record of the answers it rewrote, D4).

One item per job, plus the pointer item ``job_id = 'current'`` naming the newest job and whether it is active. A
start writes the job, then takes the pointer with a conditional put, so at most one job runs per deployment (D4);
a job whose worker stopped saving progress for ``STALE_SECONDS`` gives the pointer up to the next start (it is then
marked ``failed``). The worker saves progress with a condition on its ``step``, so a duplicate or stale invocation
of the worker never writes over the live one.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any, Final

from botocore.exceptions import ClientError

from shared.dynamodb_conditions import is_conditional_check_failure
from shared.utils import get_timestamp

#: Statuses of a job the worker still runs.
ACTIVE_STATUSES: Final = frozenset({'running', 'stopping'})
#: The pointer item's ``job_id``.
POINTER_ID: Final = 'current'
#: A job that saved nothing for this long has lost its worker (a worker invocation saves at least every few minutes).
STALE_SECONDS: Final = 20 * 60
#: The fields a job's answer carries (the rest is the worker's bookkeeping).
PUBLIC_FIELDS: Final = (
    'job_id', 'status', 'created_at', 'created_by', 'finished_at', 'filters', 'brands_version',
    'answers_total', 'answers_done', 'answers_skipped', 'answers_failed', 'keywords_total', 'keywords_done',
    'estimated_cost_usd', 'model', 'error', 'rebuild', 'capped',
)
_COUNT_FIELDS: Final = ('brands_version', 'answers_total', 'answers_done', 'answers_skipped', 'answers_failed',
                        'keywords_total', 'keywords_done')


def reextract_jobs_table_name() -> str:
    return os.environ['DYNAMODB_TABLE_REEXTRACT_JOBS']


class StaleStepError(RuntimeError):
    """The worker's step no longer matches the job's: another invocation owns the job now."""


def _plain(value: Any) -> Any:
    """``value`` as JSON: ``Decimal`` to ``int`` or ``float``, nested maps and lists too."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, Mapping):
        return {key: _plain(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_plain(item) for item in value]
    return value


def job_view(item: Mapping[str, Any]) -> dict[str, Any]:
    """The public answer of a job item."""
    view = {name: _plain(item.get(name)) for name in PUBLIC_FIELDS}
    for name in _COUNT_FIELDS:
        view[name] = int(view[name] or 0)
    view['estimated_cost_usd'] = float(view['estimated_cost_usd'] or 0)
    view['filters'] = view['filters'] or {}
    view['created_by'] = view['created_by'] or ''
    view['created_at'] = view['created_at'] or ''
    view['model'] = view['model'] or ''
    view['capped'] = view['capped'] is True
    return view


def is_stale(item: Mapping[str, Any], now: datetime) -> bool:
    """Whether an active job has saved nothing for ``STALE_SECONDS`` (its worker is gone)."""
    stamp = str(item.get('updated_at') or item.get('created_at') or '')
    try:
        saved = datetime.fromisoformat(stamp)
    except ValueError:
        return True
    return now - saved > timedelta(seconds=STALE_SECONDS)


def new_job_item(
    filters: Mapping[str, Any], created_by: str, *, answers: int, keywords: int, cost: float, brands_version: int,
    model: str = '',
) -> dict[str, Any]:
    """A running job's first item: nothing done yet, at step 0.

    ``answers`` is the count the Admin confirmed and the most the job extracts (``answers_cap``: a count the request
    deadline cut never lets the job spend more than was shown). ``model`` is the extraction model it was priced for;
    the worker replaces it with the one it ran. Jobs are kept (no TTL): they are the audit record of a rewrite (D4).
    """
    stamp = get_timestamp()
    return {
        'job_id': f'rx-{uuid.uuid4().hex[:16]}',
        'status': 'running', 'created_at': stamp, 'updated_at': stamp, 'created_by': created_by,
        'finished_at': None, 'filters': dict(filters), 'brands_version': brands_version,
        'answers_total': answers, 'answers_cap': answers, 'capped': False, 'answers_done': 0, 'answers_skipped': 0, 'answers_failed': 0,
        'keywords_total': keywords, 'keywords_done': 0,
        'estimated_cost_usd': Decimal(str(cost)), 'model': model, 'error': None, 'rebuild': None,
        'step': 0, 'cursor_keyword': None, 'cursor_key': None,
    }


class ReextractJobs:
    """The job store over ``table`` (a boto3 ``Table``)."""

    def __init__(self, table: Any) -> None:
        self.table = table

    def get(self, job_id: str) -> dict[str, Any] | None:
        if job_id == POINTER_ID:
            return None
        return self.table.get_item(Key={'job_id': job_id}, ConsistentRead=True).get('Item')

    def current(self) -> tuple[dict[str, Any] | None, bool]:
        """The newest job and whether it is active (running or stopping, not stale)."""
        pointer = self.table.get_item(Key={'job_id': POINTER_ID}, ConsistentRead=True).get('Item')
        if not pointer:
            return None, False
        job = self.get(str(pointer.get('job_ref') or ''))
        if job is None:
            return None, False
        active = job.get('status') in ACTIVE_STATUSES and not is_stale(job, datetime.now(UTC))
        return job, active

    def _take_pointer(self, job_id: str, previous: Mapping[str, Any] | None) -> None:
        """Point at ``job_id``: when nothing is active, or over ``previous`` (an active job gone stale)."""
        item = {'job_id': POINTER_ID, 'job_ref': job_id, 'active': True, 'updated_at': get_timestamp()}
        if previous is None:
            self.table.put_item(
                Item=item, ConditionExpression='attribute_not_exists(job_id) OR #active = :inactive',
                ExpressionAttributeNames={'#active': 'active'}, ExpressionAttributeValues={':inactive': False},
            )
            return
        self.table.put_item(
            Item=item, ConditionExpression='job_ref = :previous',
            ExpressionAttributeValues={':previous': previous['job_id']},
        )

    def start(self, item: dict[str, Any]) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
        """Store the new job ``item`` and make it the active one: ``(job, None)``, or ``(None, active job)`` when one runs."""
        job, active = self.current()
        if active and job is not None:
            return None, job
        stale = job if job is not None and job.get('status') in ACTIVE_STATUSES else None
        self.table.put_item(Item=item)
        try:
            self._take_pointer(item['job_id'], stale)
        except ClientError as error:
            if not is_conditional_check_failure(error):
                raise
            self.table.delete_item(Key={'job_id': item['job_id']})
            winner, _ = self.current()
            return None, winner
        if stale is not None:
            self._mark_stalled(stale['job_id'])
        return item, None

    def _mark_stalled(self, job_id: str) -> None:
        try:
            self.table.update_item(
                Key={'job_id': job_id},
                UpdateExpression='SET #status = :failed, #error = :error, finished_at = :now',
                ConditionExpression='#status IN (:running, :stopping)',
                ExpressionAttributeNames={'#status': 'status', '#error': 'error'},
                ExpressionAttributeValues={
                    ':failed': 'failed', ':error': 'The job stopped saving progress and was replaced',
                    ':now': get_timestamp(), ':running': 'running', ':stopping': 'stopping',
                },
            )
        except ClientError as error:
            if not is_conditional_check_failure(error):
                raise

    def request_stop(self, job_id: str) -> dict[str, Any] | None:
        """Ask a running job to stop (``stopping``); the job as it is now, ``None`` when there is none."""
        try:
            response = self.table.update_item(
                Key={'job_id': job_id},
                UpdateExpression='SET #status = :stopping',
                ConditionExpression='attribute_exists(job_id) AND #status = :running',
                ExpressionAttributeNames={'#status': 'status'},
                ExpressionAttributeValues={':stopping': 'stopping', ':running': 'running'},
                ReturnValues='ALL_NEW',
            )
        except ClientError as error:
            if not is_conditional_check_failure(error):
                raise
            return self.get(job_id)
        return response['Attributes']

    def save(self, job_id: str, step: int, changes: Mapping[str, Any], touched: set[str] | None = None) -> dict[str, Any]:
        """Save the worker's progress at ``step``: ``changes`` set, ``touched`` keywords added; the job after it.

        Raises ``StaleStepError`` when the job moved past ``step`` (another invocation owns it).
        """
        assignments = {**changes, 'updated_at': get_timestamp()}
        names = {f'#f{index}': field for index, field in enumerate(assignments)}
        values: dict[str, Any] = {f':v{index}': value for index, value in enumerate(assignments.values())}
        values[':step'] = step
        expression = 'SET ' + ', '.join(f'#f{index} = :v{index}' for index in range(len(assignments)))
        if touched:
            expression += ' ADD touched_keywords :touched'
            values[':touched'] = set(touched)
        names['#step'] = 'step'
        try:
            response = self.table.update_item(
                Key={'job_id': job_id}, UpdateExpression=expression, ConditionExpression='#step = :step',
                ExpressionAttributeNames=names, ExpressionAttributeValues=values, ReturnValues='ALL_NEW',
            )
        except ClientError as error:
            if is_conditional_check_failure(error):
                raise StaleStepError(job_id) from error
            raise
        return response['Attributes']

    def release(self, job_id: str) -> None:
        """Mark the pointer inactive when it still names ``job_id`` (a finished job frees the next start)."""
        try:
            self.table.update_item(
                Key={'job_id': POINTER_ID}, UpdateExpression='SET #active = :inactive, updated_at = :now',
                ConditionExpression='job_ref = :job', ExpressionAttributeNames={'#active': 'active'},
                ExpressionAttributeValues={
                    ':inactive': False, ':now': get_timestamp(), ':job': job_id,
                },
            )
        except ClientError as error:
            if not is_conditional_check_failure(error):
                raise
