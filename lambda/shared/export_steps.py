"""
The steps of the ``CitationAnalysis-Export`` state machine (2.45.0), run by ``lambda/export-worker``.

``Prepare`` → ``ExportChunk`` (looped until ``done``) → ``Finalize``; any
error → ``MarkFailed``. Each step reads the job item, does its part and
writes the item back (``shared.export_jobs``), so a retried step (Step
Functions retries Lambda service errors) repeats its work instead of
corrupting the file:

- ``prepare``: ``queued`` → ``running`` with a new multipart upload, after
  checking the owner may still export the view (an Admin-only list reads
  their Cognito groups again);
- ``chunk``: resumes the row source at the checkpointed cursor and the
  writer at its checkpoint (``shared.export_writers``), writes rows until
  the deadline or the end of the source, uploads every whole part and
  checkpoints the rest under a key of its own (``checkpoint-<n>``: a retry of
  chunk n reads checkpoint n-1, which is never overwritten). When the source
  says it finished (``RowsEnd.FINISHED``, never inferred from the clock) it
  closes the file and uploads the last part;
- ``finalize``: completes the upload, removes the checkpoint, ``ready``;
- ``fail``: aborts the upload, removes the checkpoint, ``failed`` with the
  error type (never a stack trace or a resource name). A cancelled export
  stays ``cancelled``.

A chunk whose deadline ends before it writes a row or reads on past one
(an ``ExportMark``) ``STALL_LIMIT`` times in a row fails the export instead
of looping for ever.

A chunk stopped by a view job still computing answers the job's run
(``view_job``); the state machine waits for the job's ``view-job.finished``
event (``wait_view_job``, ``shared.export_view_job_wait``) and runs the next
chunk once. When that wait times out (an event lost), the next chunk is told
the job (``timed_out_job``) and fails the export if it still computes
(``ViewJobTimeoutError``).
"""

from __future__ import annotations

import json
import logging
import math
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

from botocore.exceptions import ClientError

from shared.export_contract import (
    XLSX_SHEET_ROWS,
    ExportMark,
    ExportRow,
    ExportRows,
    ExportRowSource,
    RowsEnd,
    export_object_key,
)
from shared.export_jobs import ExportJobs, StaleExportError, item_cursor, item_owner, item_writer_state
from shared.export_source_routes import reading_for
from shared.export_view_job_wait import ViewJobRun
from shared.export_writers import (
    PART_BYTES,
    FileOutput,
    PartUpload,
    checkpoint_blob,
    checkpoint_key,
    open_writer,
    split_checkpoint_blob,
    writer_state_json,
)
from shared.request_deadline import Deadline

logger = logging.getLogger(__name__)

#: Chunks in a row that may end without writing a row before the export fails.
STALL_LIMIT: Final = 3

_MISSING_UPLOAD = frozenset({'NoSuchUpload', '404', 'NoSuchKey'})


class ExportStepError(RuntimeError):
    """The job is not in a state this step can run from (the state machine then runs ``MarkFailed``)."""


class ViewJobTimeoutError(ExportStepError):
    """The view job the export waited on still computes after the wait timed out (its event was lost or it died)."""


class ExportPermissionError(ExportStepError):
    """The owner may no longer export the view as queued (removed from a group it needs since the POST)."""


@dataclass(frozen=True)
class ExportDeps:
    """What the steps work with: the jobs table, the bucket, the row sources and the clock."""

    jobs: ExportJobs
    s3: Any
    bucket: str
    sources: Mapping[str, ExportRowSource]
    now: Callable[[], datetime]
    groups_of: Callable[[str], frozenset[str]] | None = None
    """The Cognito groups of a user name now (``AdminListGroupsForUser``); ``None``: unknown, so an export that needs a group fails."""
    part_bytes: int = PART_BYTES
    sheet_rows: int = XLSX_SHEET_ROWS


def _item(deps: ExportDeps, export_id: str) -> dict[str, Any]:
    item = deps.jobs.get(export_id)
    if item is None:
        raise ExportStepError(f'export {export_id} not found')
    return item


def file_key(item: Mapping[str, Any]) -> str:
    """The object key of an export's file: ``exports/<owner>/<export_id>/<filename>``."""
    return export_object_key(str(item['owner']), str(item['export_id']), str(item['filename']))


def _upload(deps: ExportDeps, item: Mapping[str, Any]) -> PartUpload:
    return PartUpload(deps.s3, deps.bucket, file_key(item), str(item['upload_id']), list(item.get('part_etags') or []), deps.part_bytes)


def _is_missing(error: ClientError) -> bool:
    return error.response.get('Error', {}).get('Code') in _MISSING_UPLOAD


def _delete_checkpoint(s3: Any, bucket: str, item: Mapping[str, Any], sequence: int) -> None:
    if sequence > 0:
        s3.delete_object(Bucket=bucket, Key=checkpoint_key(file_key(item), sequence))


def _source(deps: ExportDeps, item: Mapping[str, Any]) -> ExportRowSource:
    source = deps.sources.get(str(item['view']))
    if source is None:
        raise ExportStepError(f'no row source for view {item["view"]}')
    return source


def _recheck_owner(deps: ExportDeps, item: Mapping[str, Any]) -> None:
    """
    Refuse an export whose owner lost a group it needs since the POST.

    The view is validated again for the owner without the groups they had
    then; only when that refuses (an Admin-only list) are their groups read
    from Cognito now and the view validated with those.
    """
    source = _source(deps, item)
    params = dict(item.get('params') or {})
    owner = item_owner(item, frozenset())
    if source.validate(params, owner) is None:
        return
    if deps.groups_of is None:
        raise ExportPermissionError('the owner\'s groups cannot be checked')
    refused = source.validate(params, item_owner(item, deps.groups_of(str(owner.username))))
    if refused is not None:
        raise ExportPermissionError(refused)


def prepare(deps: ExportDeps, export_id: str) -> dict[str, Any]:
    """Check the owner may still export the view, mark the export running and start its multipart upload (a retry after success changes nothing)."""
    item = _item(deps, export_id)
    if item['status'] == 'running' and item.get('upload_id'):
        return {'export_id': export_id, 'done': False}
    if item['status'] != 'queued':
        raise ExportStepError(f'export {export_id} is {item["status"]}, not queued')
    _recheck_owner(deps, item)
    upload = PartUpload.create(deps.s3, deps.bucket, file_key(item), item['format'], str(item['filename']))
    try:
        deps.jobs.save(item, deps.now(), status='running', upload_id=upload.upload_id)
    except Exception:
        deps.s3.abort_multipart_upload(Bucket=deps.bucket, Key=upload.key, UploadId=upload.upload_id)
        raise
    return {'export_id': export_id, 'done': False}


def _resume_output(deps: ExportDeps, item: Mapping[str, Any]) -> tuple[FileOutput, bytes]:
    sequence = int(item.get('chunks') or 0)
    if sequence == 0 or item.get('writer_state') is None:
        return FileOutput(), b''
    blob = deps.s3.get_object(Bucket=deps.bucket, Key=checkpoint_key(file_key(item), sequence))['Body'].read()
    buffer, pending = split_checkpoint_blob(blob)
    return FileOutput(bytearray(buffer), int(item['bytes'])), pending


def chunk(deps: ExportDeps, export_id: str, deadline: Deadline, timed_out_job: str | None = None) -> dict[str, Any]:
    """
    Write rows from the checkpoint until ``deadline`` or the end of the source; ``{done}`` says which.

    ``timed_out_job``: the view job whose wait timed out before this chunk;
    meeting it still computing fails the export (``ViewJobTimeoutError``).
    """
    item = _item(deps, export_id)
    if item['status'] != 'running':
        raise ExportStepError(f'export {export_id} is {item["status"]}, not running')
    if item.get('written'):
        return {'export_id': export_id, 'done': True}
    source = _source(deps, item)
    output, pending = _resume_output(deps, item)
    state = item_writer_state(item)
    writer = open_writer(item['format'], source.sheets, output, state, pending, deps.sheet_rows)
    upload = _upload(deps, item)
    reading = _Reading(item_cursor(item))
    # Paid reads count against the owner's own daily limit, not one shared service identity (tenet 4, D4).
    with reading_for(str(item_owner(item).username)) as read:
        rows = source.rows(dict(item.get('params') or {}), reading.cursor, deadline)
        done = _write_rows(rows, reading, lambda row: (writer.write_row(row), upload.send_full_parts(output)), deadline)
    waiting = None if done else read.view_job
    if waiting is not None and waiting.job_id == timed_out_job:
        raise ViewJobTimeoutError(f'view job {waiting.job_id} still computes after the export waited for it')
    if done:
        writer.close()
        upload.send_rest(output)
    progress = _Progress(writer.rows, writer.truncated_cells, reading.cursor, reading.written + reading.marks, done, waiting, read.wait_seconds)
    return _checkpoint(deps, item, progress, output, upload, writer.checkpoint())


@dataclass
class _Reading:
    cursor: Any
    written: int = 0
    marks: int = 0


def _write_rows(rows: ExportRows, reading: _Reading, write: Callable[[ExportRow], object], deadline: Deadline) -> bool:
    """
    Write ``rows`` until the source ends or ``deadline`` expires; whether the source said it finished.

    Only ``RowsEnd.FINISHED`` ends the file: a source that stopped for time
    (``STOPPED``), one cut off by the deadline, and one that ends without
    saying why all leave the export to the next chunk or fail it.
    """
    while not deadline.expired():
        try:
            row = next(rows)
        except StopIteration as stop:
            if not isinstance(stop.value, RowsEnd):
                raise ExportStepError('the row source ended without saying whether it finished') from None
            return stop.value is RowsEnd.FINISHED
        reading.cursor = row.cursor
        if isinstance(row, ExportMark):
            reading.marks += 1
            continue
        write(row)
        reading.written += 1
    rows.close()
    return False


@dataclass(frozen=True)
class _Progress:
    rows: int
    truncated_cells: int
    cursor: Any
    advanced: int
    """Rows written plus progress marks read: 0 is a stall."""
    done: bool
    view_job: ViewJobRun | None = None
    """A view job the source reads is computing: wait for its event before the next chunk (not a stall)."""
    wait_seconds: float | None = None
    """How long the job's answer asked to wait, for executions started before 2.49.0."""


def _checkpoint(
    deps: ExportDeps, item: dict[str, Any], progress: _Progress, output: FileOutput, upload: PartUpload,
    writer_checkpoint: tuple[dict[str, Any], bytes],
) -> dict[str, Any]:
    previous = int(item.get('chunks') or 0)
    waiting = progress.view_job is not None
    stalls = 0 if progress.advanced or progress.done or waiting else int(item.get('stalls') or 0) + 1
    if stalls >= STALL_LIMIT:
        raise ExportStepError(f'export {item["export_id"]} made no progress in {stalls} chunks')
    changes: dict[str, Any] = {
        'rows': progress.rows, 'truncated_cells': progress.truncated_cells, 'bytes': output.total, 'parts': len(upload.etags), 'part_etags': list(upload.etags),
        'cursor': None if progress.cursor is None else json.dumps(progress.cursor, separators=(',', ':'), sort_keys=True),
        'chunks': previous + 1, 'stalls': stalls,
    }
    if progress.done:
        changes.update(written=True, writer_state=None)
    else:
        state, pending = writer_checkpoint
        key = checkpoint_key(file_key(item), previous + 1)
        deps.s3.put_object(Bucket=deps.bucket, Key=key, Body=checkpoint_blob(bytes(output.buffer), pending))
        changes['writer_state'] = writer_state_json(state)
    try:
        deps.jobs.save(item, deps.now(), **changes)
    except StaleExportError:
        # Cancelled (or failed) meanwhile: the canceller removed checkpoint n, this one is ours to remove.
        _delete_checkpoint(deps.s3, deps.bucket, item, previous + 1)
        raise
    _delete_checkpoint(deps.s3, deps.bucket, item, previous)
    answer: dict[str, Any] = {'export_id': item['export_id'], 'done': progress.done}
    if progress.view_job is not None:
        # WaitForViewJob registers a task token against this run and the execution pauses until the job's event.
        answer['view_job'] = progress.view_job.answer()
        # Executions started before 2.49.0 still loop through a Wait state on it. Remove in the next minor release.
        answer['wait_seconds'] = max(1, math.ceil(progress.wait_seconds or 0))
    return answer


def finalize(deps: ExportDeps, export_id: str) -> dict[str, Any]:
    """Complete the upload and mark the export ``ready`` (not yet notified)."""
    item = _item(deps, export_id)
    if item['status'] == 'ready':
        return {'export_id': export_id, 'status': 'ready'}
    if item['status'] != 'running' or not item.get('written'):
        raise ExportStepError(f'export {export_id} is not completely written')
    try:
        _upload(deps, item).complete()
    except ClientError as error:
        # A retry after a completed upload: the object exists, the upload does not.
        if not _is_missing(error):
            raise
        deps.s3.head_object(Bucket=deps.bucket, Key=file_key(item))
    deps.jobs.save(item, deps.now(), status='ready', notified=False, upload_id=None, cursor=None)
    _delete_checkpoint(deps.s3, deps.bucket, item, int(item.get('chunks') or 0))
    return {'export_id': export_id, 'status': 'ready'}


def abort_upload(s3: Any, bucket: str, item: Mapping[str, Any]) -> None:
    """
    Drop the parts uploaded so far and the checkpoints (all may already be gone).

    Removes checkpoint n (the last saved) and n+1, which a chunk in flight
    may have written before it lost its save to this cancel or failure.
    """
    if item.get('upload_id'):
        try:
            s3.abort_multipart_upload(Bucket=bucket, Key=file_key(item), UploadId=str(item['upload_id']))
        except ClientError as error:
            if not _is_missing(error):
                raise
    sequence = int(item.get('chunks') or 0)
    for checkpoint in (sequence, sequence + 1):
        _delete_checkpoint(s3, bucket, item, checkpoint)


def delete_files(s3: Any, bucket: str, item: Mapping[str, Any]) -> None:
    """Remove an export's file, its unfinished upload and its checkpoint."""
    abort_upload(s3, bucket, item)
    s3.delete_object(Bucket=bucket, Key=file_key(item))


def stop_execution(sfn: Any, item: Mapping[str, Any]) -> None:
    """Stop the export's ``CitationAnalysis-Export`` execution (one already gone is fine)."""
    arn = item.get('execution_arn')
    if not arn:
        return
    try:
        sfn.stop_execution(executionArn=str(arn), cause='Cancelled by its owner')
    except ClientError as error:
        if error.response.get('Error', {}).get('Code') != 'ExecutionDoesNotExist':
            raise


def error_message(error: Mapping[str, Any] | None) -> str:
    """What a failed export tells its owner: the error type the state machine caught, never its details."""
    kind = str((error or {}).get('Error') or 'Error')[:100]
    return f'The export failed ({kind}). Start it again; if it fails again, contact an administrator.'


def fail(deps: ExportDeps, export_id: str, error: Mapping[str, Any] | None) -> dict[str, Any]:
    """
    Mark the export ``failed`` (a cancelled or finished export keeps its status), then abort the upload.

    The status is saved first: an abort S3 refuses (throttling, access) is
    logged and left to the bucket's lifecycle rule (unfinished uploads go
    after a day), so it cannot leave the export ``running``.
    """
    item = deps.jobs.get(export_id)
    if item is None:
        return {'export_id': export_id, 'status': 'missing'}
    logger.error('Export %s failed: %s', export_id, json.dumps(error, default=str)[:2000])
    status = str(item['status'])
    if status in ('queued', 'running'):
        deps.jobs.save(item, deps.now(), status='failed', error=error_message(error), upload_id=None)
        status = 'failed'
    try:
        abort_upload(deps.s3, deps.bucket, item)
    except ClientError:
        logger.exception('Export %s: the upload could not be aborted; the lifecycle rule removes it', export_id)
    return {'export_id': export_id, 'status': status}
