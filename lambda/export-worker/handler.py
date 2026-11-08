"""
CitationAnalysis-ExportWorker: every step of the ``CitationAnalysis-Export`` state machine (2.45.0).

The state machine invokes it with ``{"action": ..., "export_id": ...}``:

- ``prepare``: the export is ``running`` and has a multipart upload;
- ``chunk``: rows until this invocation's deadline (remaining time minus
  ``CHUNK_RESERVE_SECONDS``, kept for the last part upload and the
  checkpoint) or the end of the view's rows; answers ``{"done": bool}``;
- ``finalize``: the upload is complete and the export ``ready``;
- ``fail`` (the ``MarkFailed`` catch, with the caught ``error``): the upload
  is aborted and the export ``failed``.

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


def _run(action: str, export_id: str, event: Mapping[str, Any], context: Any) -> dict[str, Any]:
    if action == 'prepare':
        return export_steps.prepare(_deps(), export_id)
    if action == 'chunk':
        deadline = activate_deadline(chunk_deadline(context))
        try:
            return export_steps.chunk(_deps(), export_id, deadline)
        finally:
            clear_request_deadline()
    if action == 'finalize':
        return export_steps.finalize(_deps(), export_id)
    if action == 'fail':
        error = event.get('error')
        return export_steps.fail(_deps(), export_id, error if isinstance(error, Mapping) else None)
    raise ValueError(f'unknown export action {action!r}')


def handler(event: Mapping[str, Any], context: Any) -> dict[str, Any]:
    """Run ``event["action"]`` for ``event["export_id"]``; errors propagate so the state machine catches them."""
    action, export_id = event.get('action'), event.get('export_id')
    if not isinstance(action, str) or not isinstance(export_id, str) or not export_id:
        raise ValueError('an export step needs an action and an export_id')
    logger.info('Export %s: %s', export_id, action)
    return _run(action, export_id, event, context)
