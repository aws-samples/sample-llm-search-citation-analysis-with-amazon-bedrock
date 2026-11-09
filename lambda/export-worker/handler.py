"""
CitationAnalysis-ExportWorker: every step of the ``CitationAnalysis-Export`` state machine (2.45.0).

The state machine invokes it with ``{"action": ..., "export_id": ...}``:

- ``prepare``: the export is ``running`` and has a multipart upload;
- ``chunk``: rows until this invocation's deadline (remaining time minus
  ``CHUNK_RESERVE_SECONDS``, kept for the last part upload and the
  checkpoint) or the end of the view's rows; answers ``{"done": bool}``,
  plus ``view_job`` when a view job still computes. After a timed-out wait
  the event names that job (``timed_out_job``);
- ``wait_view_job`` (the ``WaitForViewJob`` task, with its ``task_token``):
  registers the token against the ``view_job`` run, or sends it back now
  when the run already finished;
- ``finalize``: the upload is complete and the export ``ready``;
- ``fail`` (the ``MarkFailed`` catch, with the caught ``error``): the upload
  is aborted and the export ``failed``.

The ``ViewJobFinishedRule`` EventBridge rule invokes it with
``{"action": "view_job_finished", "job_id", "started_at", "status"}`` (no
export id): every export waiting on that run resumes
(``shared.export_view_job_wait``; ``states:SendTaskSuccess`` /
``SendTaskFailure`` on the export state machine only).

The steps themselves are ``shared.export_steps``; this module only wires the
table, the bucket and the row sources (``shared.export_sources``).

Environment: ``DYNAMODB_TABLE_EXPORTS``, ``EXPORTS_BUCKET`` (the keywords
bucket), ``USER_POOL_ID`` (Prepare reads an Admin-only export's owner's
groups again, ``cognito-idp:AdminListGroupsForUser``; unset, such an
export fails), plus whatever the row sources read.
"""

from __future__ import annotations

import logging
import os
import sys
from collections.abc import Callable, Mapping
from typing import Any, Final

import boto3

# Shared layer path (populated by the Lambda layer at /opt/python)
sys.path.insert(0, '/opt/python')

from shared import export_steps
from shared.env_vars import resolve_table_env
from shared.export_jobs import ExportJobs, export_sources
from shared.export_steps import ExportDeps
from shared.export_view_job_wait import finish_view_job, register_wait, run_from
from shared.request_deadline import Deadline, activate_deadline, budget_from_context, clear_request_deadline
from shared.utils import utc_now

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

#: Seconds a chunk keeps after its deadline for the last part upload and the checkpoint.
CHUNK_RESERVE_SECONDS: Final = 60
#: The shortest chunk budget (a chunk invoked with less time still writes a few rows).
MIN_CHUNK_SECONDS: Final = 5

s3 = boto3.client('s3')
exports_table = boto3.resource('dynamodb').Table(resolve_table_env('DYNAMODB_TABLE_EXPORTS'))
_cognito_client: list[Any] = []
_sfn_client: list[Any] = []


def _sfn() -> Any:
    if not _sfn_client:
        _sfn_client.append(boto3.client('stepfunctions'))
    return _sfn_client[0]


def _cognito() -> Any:
    if not _cognito_client:
        _cognito_client.append(boto3.client('cognito-idp'))
    return _cognito_client[0]


def owner_groups(username: str) -> frozenset[str]:
    """The Cognito groups ``username`` belongs to now (none when the user is gone)."""
    client = _cognito()
    groups: set[str] = set()
    params: dict[str, Any] = {'UserPoolId': os.environ['USER_POOL_ID'], 'Username': username, 'Limit': 60}
    try:
        while True:
            response = client.admin_list_groups_for_user(**params)
            groups.update(str(group['GroupName']) for group in response.get('Groups', []))
            if not response.get('NextToken'):
                return frozenset(groups)
            params['NextToken'] = response['NextToken']
    except client.exceptions.UserNotFoundException:
        return frozenset()


def groups_lookup() -> Callable[[str], frozenset[str]] | None:
    """``owner_groups`` when a user pool is configured, else ``None`` (an Admin-only export then fails)."""
    return owner_groups if os.environ.get('USER_POOL_ID') else None


def chunk_deadline(context: Any) -> Deadline:
    """The deadline of one chunk: the invocation's remaining time minus ``CHUNK_RESERVE_SECONDS``."""
    return Deadline(max(MIN_CHUNK_SECONDS, budget_from_context(context, CHUNK_RESERVE_SECONDS)))


def _deps() -> ExportDeps:
    return ExportDeps(
        jobs=ExportJobs(exports_table), s3=s3, bucket=os.environ['EXPORTS_BUCKET'], sources=export_sources(), now=utc_now,
        groups_of=groups_lookup(),
    )


def _chunk(export_id: str, event: Mapping[str, Any], context: Any) -> dict[str, Any]:
    deadline = activate_deadline(chunk_deadline(context))
    timed_out = event.get('timed_out_job')
    try:
        return export_steps.chunk(_deps(), export_id, deadline, timed_out if isinstance(timed_out, str) and timed_out else None)
    finally:
        clear_request_deadline()


def _wait_view_job(export_id: str, event: Mapping[str, Any]) -> dict[str, Any]:
    run, token = run_from(event.get('view_job')), event.get('task_token')
    if run is None or not isinstance(token, str) or not token:
        raise ValueError(f'export {export_id}: waiting on a view job needs its run and a task token')
    return {'export_id': export_id, **register_wait(exports_table, _sfn(), run, token, utc_now())}


def view_job_finished(event: Mapping[str, Any]) -> dict[str, Any]:
    """Resume every export waiting on the run the ``view-job.finished`` event names."""
    run = run_from({'id': event.get('job_id'), 'started_at': event.get('started_at')})
    if run is None:
        raise ValueError('a view-job.finished event needs a job_id and a started_at')
    return finish_view_job(exports_table, _sfn(), run, str(event.get('status')), utc_now())


def _run(action: str, export_id: str, event: Mapping[str, Any], context: Any) -> dict[str, Any]:
    if action == 'prepare':
        return export_steps.prepare(_deps(), export_id)
    if action == 'chunk':
        return _chunk(export_id, event, context)
    if action == 'wait_view_job':
        return _wait_view_job(export_id, event)
    if action == 'finalize':
        return export_steps.finalize(_deps(), export_id)
    if action == 'fail':
        error = event.get('error')
        return export_steps.fail(_deps(), export_id, error if isinstance(error, Mapping) else None)
    raise ValueError(f'unknown export action {action!r}')


def handler(event: Mapping[str, Any], context: Any) -> dict[str, Any]:
    """Run ``event["action"]`` for ``event["export_id"]``; errors propagate so the state machine catches them."""
    action, export_id = event.get('action'), event.get('export_id')
    if action == 'view_job_finished':
        logger.info('View job %s finished: %s', event.get('job_id'), event.get('status'))
        return view_job_finished(event)
    if not isinstance(action, str) or not isinstance(export_id, str) or not export_id:
        raise ValueError('an export step needs an action and an export_id')
    logger.info('Export %s: %s', export_id, action)
    return _run(action, export_id, event, context)
