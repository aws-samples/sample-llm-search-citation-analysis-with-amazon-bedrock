"""
Exports API (2.45.0): every data view's "Export all", run in the background until the file is complete.

Routes (Lambda ``CitationAnalysis-Exports``, behind the Cognito authorizer):

  POST   /api/exports              {view, params, format} → 202 {export}
  GET    /api/exports              → {exports, next_token} (the caller's, newest first)
  GET    /api/exports/{id}         → {export} (+ download_url, download_expires_at when ready)
  DELETE /api/exports/{id}         → 204 (cancels a queued/running export, deletes a finished one)
  POST   /api/exports/{id}/seen    → {export} with notified = true

A POST checks the view's params through its row source
(``shared.export_sources``), stores a ``queued`` item and takes one of the
user's five running slots in one transaction (a sixth answers 429;
``shared.export_jobs``) and starts the
``CitationAnalysis-Export`` execution named after the export id.

Security (builder-security): an export belongs to the Cognito ``sub`` that
created it; every other caller, Admin included, gets 404 for its id. The
file stays in the private keywords bucket under ``exports/<sub>/``; the API
never returns its key, only a presigned GET valid ``DOWNLOAD_URL_SECONDS``
(15 min), minted per request for a key under the caller's own prefix.

Environment: ``DYNAMODB_TABLE_EXPORTS``, ``EXPORTS_BUCKET``,
``EXPORT_STATE_MACHINE_ARN``, plus whatever the row sources' ``validate`` reads.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from collections.abc import Callable, Mapping
from datetime import timedelta
from typing import Any, Final

import boto3

# Shared layer path
sys.path.insert(0, '/opt/python')

from shared.api_response import (
    api_response,
    cors_json_headers,
    forbidden_response,
    not_found_response,
    success_response,
    validation_error,
)
from shared.decorators import api_handler, parse_json_body
from shared.env_vars import resolve_table_env
from shared.export_contract import (
    DOWNLOAD_URL_SECONDS,
    EXPORT_KEY_PREFIX,
    EXPORT_VIEWS,
    MAX_RUNNING_EXPORTS_PER_USER,
    Caller,
    ExportSummary,
    caller_from_event,
    export_params,
)
from shared.export_jobs import (
    PAGE_DEFAULT,
    PAGE_MAX,
    RUNNING_STATUSES,
    ExportJobs,
    NewExport,
    StaleExportError,
    TooManyExportsError,
    export_sources,
    new_item,
    page_start,
    page_token,
    summary,
)
from shared.export_steps import abort_upload, delete_files, file_key, stop_execution
from shared.response_budget import json_bytes
from shared.utils import format_timestamp, utc_now

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

#: Params one export may carry, and their sizes (a view's query string is far smaller).
MAX_PARAMS: Final = 40
MAX_PARAM_NAME: Final = 100
MAX_PARAM_VALUE: Final = 2_000
#: Bytes of the params as JSON: about a URL's query string (CloudFront and API Gateway cap a
#: URL near 8 KB), so a page of ``PAGE_MAX`` summaries stays inside ``PAGE_BUDGET_BYTES``.
MAX_PARAMS_BYTES: Final = 8_000
#: Times a cancel / seen write re-reads the item when the worker wrote it meanwhile.
WRITE_ATTEMPTS: Final = 3

s3 = boto3.client('s3')
sfn = boto3.client('stepfunctions')
exports_table = boto3.resource('dynamodb').Table(resolve_table_env('DYNAMODB_TABLE_EXPORTS'))


def _jobs() -> ExportJobs:
    return ExportJobs(exports_table)


def _bucket() -> str:
    return os.environ['EXPORTS_BUCKET']


def _no_content(event: dict[str, Any]) -> dict[str, Any]:
    return {'statusCode': 204, 'headers': cors_json_headers(event), 'body': ''}


def _params_error(params: Any) -> str | None:
    if not isinstance(params, dict):
        return 'params must be an object of strings'
    if len(params) > MAX_PARAMS:
        return f'params may hold at most {MAX_PARAMS} entries'
    for name, value in params.items():
        if not isinstance(value, str) or not name or len(name) > MAX_PARAM_NAME or len(value) > MAX_PARAM_VALUE:
            return f'params.{str(name)[:MAX_PARAM_NAME]} must be a string of at most {MAX_PARAM_VALUE} characters'
    if json_bytes(params) > MAX_PARAMS_BYTES:
        return f'params may take at most {MAX_PARAMS_BYTES} bytes as JSON'
    return None


def _request_error(body: Mapping[str, Any]) -> tuple[str, str] | None:
    """``(message, field)`` of the first invalid body field, else ``None``."""
    if body.get('view') not in EXPORT_VIEWS:
        return 'view must be one of the export views', 'view'
    if body.get('format') not in ('csv', 'xlsx'):
        return "format must be 'csv' or 'xlsx'", 'format'
    message = _params_error(body.get('params', {}))
    return None if message is None else (message, 'params')


def _start(item: dict[str, Any]) -> dict[str, Any]:
    """Start the export's execution; a start that fails marks the export failed and raises."""
    jobs = _jobs()
    try:
        started = sfn.start_execution(
            stateMachineArn=os.environ['EXPORT_STATE_MACHINE_ARN'], name=str(item['export_id']),
            input=json.dumps({'export_id': item['export_id']}),
        )
    except Exception:
        jobs.save(item, utc_now(), status='failed', error='The export could not be started. Try again later.')
        raise
    return jobs.save(item, utc_now(), execution_arn=started['executionArn'])


def create_export(event: dict[str, Any], caller: Caller, body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        return validation_error('Request body must be a JSON object', event, 'body')
    invalid = _request_error(body)
    if invalid is not None:
        return validation_error(invalid[0], event, invalid[1])
    source = export_sources().get(body['view'])
    if source is None:
        return validation_error(f'view {body["view"]} cannot be exported yet', event, 'view')
    params = export_params(body.get('params', {}))
    refused = source.validate(params, caller)
    if refused is not None:
        return validation_error(refused, event, 'params')
    try:
        item = _jobs().create(new_item(NewExport(caller, body['view'], params, body['format']), utc_now()))
    except TooManyExportsError:
        return api_response(429, {
            'error': f'You already have {MAX_RUNNING_EXPORTS_PER_USER} exports running. Wait for one to finish or cancel one.',
            'code': 'too_many_exports',
        }, event)
    return success_response({'export': summary(_start(item))}, event, 202)


def _limit(event: dict[str, Any]) -> int | None:
    raw = (event.get('queryStringParameters') or {}).get('limit')
    if raw is None:
        return PAGE_DEFAULT
    return int(raw) if raw.isdigit() and 1 <= int(raw) <= PAGE_MAX else None


def list_exports(event: dict[str, Any], caller: Caller) -> dict[str, Any]:
    limit = _limit(event)
    if limit is None:
        return validation_error(f'limit must be between 1 and {PAGE_MAX}', event, 'limit')
    token = (event.get('queryStringParameters') or {}).get('next_token')
    start = None if not token else page_start(token, caller.sub)
    if token and start is None:
        return validation_error('next_token is invalid', event, 'next_token')
    items, last = _jobs().page(caller.sub, limit, start)
    return success_response({'exports': [summary(item) for item in items], 'next_token': page_token(last)}, event)


def _with_download(item: Mapping[str, Any], caller: Caller) -> ExportSummary:
    """The summary; a ready export's carries a fresh presigned GET of the caller's own file."""
    answer = summary(item)
    if item['status'] != 'ready':
        return answer
    key = file_key(item)
    if not key.startswith(f'{EXPORT_KEY_PREFIX}/{caller.sub}/'):
        raise PermissionError('export key outside the caller prefix')
    answer['download_url'] = s3.generate_presigned_url(
        ClientMethod='get_object',
        Params={'Bucket': _bucket(), 'Key': key, 'ResponseContentDisposition': f'attachment; filename="{item["filename"]}"'},
        ExpiresIn=DOWNLOAD_URL_SECONDS,
    )
    answer['download_expires_at'] = format_timestamp(utc_now() + timedelta(seconds=DOWNLOAD_URL_SECONDS))
    return answer


def get_export(event: dict[str, Any], caller: Caller, export_id: str) -> dict[str, Any]:
    item = _jobs().owned(export_id, caller.sub)
    if item is None:
        return not_found_response('Export', event)
    return success_response({'export': _with_download(item, caller)}, event)


def _on_owned(caller: Caller, export_id: str, act: Callable[[dict[str, Any]], dict[str, Any]]) -> dict[str, Any] | None:
    """``act`` on ``caller``'s export, read again when the worker wrote it meanwhile; ``None`` when it is not theirs."""
    for _attempt in range(WRITE_ATTEMPTS):
        item = _jobs().owned(export_id, caller.sub)
        if item is None:
            return None
        try:
            return act(item)
        except StaleExportError:
            continue
    raise StaleExportError(export_id)


def _remove(item: dict[str, Any]) -> dict[str, Any]:
    """Cancel a queued or running export (stop, abort), or delete a finished one with its file."""
    if item['status'] not in RUNNING_STATUSES:
        delete_files(s3, _bucket(), item)
        _jobs().delete(str(item['export_id']))
        return item
    cancelled = _jobs().save(item, utc_now(), status='cancelled', error=None)
    stop_execution(sfn, cancelled)
    abort_upload(s3, _bucket(), cancelled)
    return cancelled


def delete_export(event: dict[str, Any], caller: Caller, export_id: str) -> dict[str, Any]:
    return not_found_response('Export', event) if _on_owned(caller, export_id, _remove) is None else _no_content(event)


def _seen(item: dict[str, Any]) -> dict[str, Any]:
    return item if item.get('notified') else _jobs().save(item, utc_now(), notified=True)


def mark_seen(event: dict[str, Any], caller: Caller, export_id: str) -> dict[str, Any]:
    item = _on_owned(caller, export_id, _seen)
    return not_found_response('Export', event) if item is None else success_response({'export': summary(item)}, event)


def _route(event: dict[str, Any], caller: Caller, body: Any) -> dict[str, Any]:
    method = str(event.get('httpMethod', 'GET')).upper()
    export_id = (event.get('pathParameters') or {}).get('id')
    if not export_id:
        if method == 'POST':
            return create_export(event, caller, body)
        if method == 'GET':
            return list_exports(event, caller)
    elif str(event.get('path', '')).rstrip('/').endswith('/seen'):
        if method == 'POST':
            return mark_seen(event, caller, export_id)
    elif method == 'GET':
        return get_export(event, caller, export_id)
    elif method == 'DELETE':
        return delete_export(event, caller, export_id)
    return validation_error(f'Method {method} not allowed', event)


@api_handler
@parse_json_body
def handler(event: dict[str, Any], context: Any, body: Any) -> dict[str, Any]:
    """Route an exports request for the signed-in caller."""
    del context
    caller = caller_from_event(event)
    if caller is None:
        return forbidden_response('Forbidden', event)
    return _route(event, caller, body)
