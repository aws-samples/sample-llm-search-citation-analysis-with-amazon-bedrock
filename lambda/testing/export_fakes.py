"""In-memory doubles for the export service (2.45.0): multipart S3, a conditional jobs table, a row source, Step Functions.

- ``MultipartS3`` is ``ConditionalS3`` with S3's multipart upload: parts kept
  per upload id, ``complete`` refuses a part (but the last) under
  ``min_part_bytes`` and an unknown upload (``NoSuchUpload``), ``abort``
  drops the parts; presigned URLs are recorded, never fetched.
- ``ConditionalTable`` is a ``MemoryTable`` whose ``put_item`` /
  ``delete_item`` honour ``ConditionExpression`` (boto3 ``Attr``), as the jobs
  table's optimistic writes need.
- ``ListRowSource`` is an ``ExportRowSource`` over fixed rows whose cursor is
  the next row's position. With ``per_chunk`` it yields that many rows and
  then spends the deadline (its ``clock`` jumps), as a slow source does;
  with ``spends_deadline=False`` it stops there before the deadline (a source
  keeping time for itself) and says so with ``RowsEnd.STOPPED``.
- ``FakeStepFunctions`` records ``start_execution`` / ``stop_execution``.
"""

from __future__ import annotations

import re
import threading
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

from botocore.exceptions import ClientError

from shared.export_contract import Caller, ExportCursor, ExportRow, ExportRows, ExportSheet, RowsEnd
from shared.request_deadline import Deadline
from testing.clocks import JumpClock
from testing.dynamodb_stubs import conditional_check_failure
from testing.memory_dynamodb import MemoryTable, matches, stored
from testing.snapshot_fakes import ConditionalS3


def _no_such_upload(operation: str, upload_id: str) -> ClientError:
    return ClientError({'Error': {'Code': 'NoSuchUpload', 'Message': upload_id}}, operation)


@dataclass
class MultipartS3(ConditionalS3):
    """A bucket with multipart uploads (see the module docstring)."""

    min_part_bytes: int = 5 * 1024 * 1024
    uploads: dict[str, dict[str, Any]] = field(default_factory=dict)
    aborted: list[str] = field(default_factory=list)
    presigned: list[dict[str, Any]] = field(default_factory=list)

    def create_multipart_upload(self, **params: Any) -> dict[str, Any]:
        upload_id = f'upload-{len(self.uploads) + 1}'
        self.uploads[upload_id] = {'key': params['Key'], 'parts': {}, 'params': dict(params)}
        return {'UploadId': upload_id, 'Key': params['Key']}

    def _open_upload(self, operation: str, upload_id: str) -> dict[str, Any]:
        upload = self.uploads.get(upload_id)
        if upload is None:
            raise _no_such_upload(operation, upload_id)
        return upload

    def upload_part(self, **params: Any) -> dict[str, Any]:
        upload = self._open_upload('UploadPart', params['UploadId'])
        body = bytes(params['Body'])
        etag = f'"part-{params["PartNumber"]}-{len(body)}-{hash(body) & 0xFFFF:04x}"'
        upload['parts'][int(params['PartNumber'])] = (body, etag)
        return {'ETag': etag}

    def complete_multipart_upload(self, **params: Any) -> dict[str, Any]:
        upload = self._open_upload('CompleteMultipartUpload', params['UploadId'])
        listed = params['MultipartUpload']['Parts']
        bodies = []
        for position, part in enumerate(listed):
            body, etag = upload['parts'][part['PartNumber']]
            if etag != part['ETag'] or part['PartNumber'] != position + 1:
                raise ClientError({'Error': {'Code': 'InvalidPart', 'Message': str(part)}}, 'CompleteMultipartUpload')
            if position < len(listed) - 1 and len(body) < self.min_part_bytes:
                raise ClientError({'Error': {'Code': 'EntityTooSmall', 'Message': str(part)}}, 'CompleteMultipartUpload')
            bodies.append(body)
        del self.uploads[params['UploadId']]
        return self.put_object(Key=upload['key'], Body=b''.join(bodies))

    def abort_multipart_upload(self, **params: Any) -> dict[str, Any]:
        self._open_upload('AbortMultipartUpload', params['UploadId'])
        del self.uploads[params['UploadId']]
        self.aborted.append(params['UploadId'])
        return {}

    def generate_presigned_url(self, ClientMethod: str, Params: Mapping[str, Any], ExpiresIn: int) -> str:
        self.presigned.append({'method': ClientMethod, 'params': dict(Params), 'expires_in': ExpiresIn})
        return f'https://bucket.example/{Params["Key"]}?signature=fake'

    def body(self, key: str) -> bytes:
        """The stored bytes of ``key`` (``KeyError`` when absent)."""
        return self.objects[key][0]


# One lock for every fake table: a conditional write checks and writes as one step, as DynamoDB does.
_WRITES = threading.RLock()
_NOT_EXISTS = re.compile(r'attribute_not_exists\((#?\w+)\)')
_EQUALS = re.compile(r'(#?\w+) = (:\w+)')


def _string_condition_holds(put: Mapping[str, Any], current: Mapping[str, Any]) -> bool:
    """A low-level ``ConditionExpression`` of the two forms the export jobs write: ``attribute_not_exists(a)`` and ``#a = :v``."""
    expression = put.get('ConditionExpression')
    if expression is None:
        return True
    names = put.get('ExpressionAttributeNames') or {}
    absent = _NOT_EXISTS.fullmatch(expression)
    if absent:
        return names.get(absent[1], absent[1]) not in current
    equal = _EQUALS.fullmatch(expression)
    if equal is None:
        raise NotImplementedError(f'condition {expression!r}')
    attribute = names.get(equal[1], equal[1])
    return attribute in current and current[attribute] == stored(put['ExpressionAttributeValues'][equal[2]])


def _transaction_cancelled(reasons: list[str]) -> ClientError:
    return ClientError(
        {'Error': {'Code': 'TransactionCanceledException', 'Message': 'Transaction cancelled'},
         'CancellationReasons': [{'Code': reason} for reason in reasons]},
        'TransactWriteItems',
    )


class ConditionalTable(MemoryTable):
    """
    A ``MemoryTable`` whose writes check ``ConditionExpression`` against the stored row.

    ``meta.client.transact_write_items`` applies ``Put`` items of this table
    all or none (string conditions, ``_string_condition_holds``), and answers
    ``TransactionCanceledException`` with per-item reasons as DynamoDB does.
    """

    def _check(self, key: Mapping[str, Any], conditions: Mapping[str, Any], operation: str) -> None:
        condition = conditions.get('ConditionExpression')
        current = self.rows.get(self._row_key(stored(key)), {})
        if condition is not None and not matches(condition, current):
            raise conditional_check_failure(operation)

    def put_item(self, Item: Mapping[str, Any], **conditions: Any) -> dict[str, Any]:
        with _WRITES:
            self._check(Item, conditions, 'PutItem')
            return super().put_item(Item=Item)

    def delete_item(self, Key: Mapping[str, Any], **conditions: Any) -> dict[str, Any]:
        with _WRITES:
            self._check(Key, conditions, 'DeleteItem')
            return super().delete_item(Key=Key)

    def transact_write_items(self, TransactItems: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
        puts = [entry['Put'] for entry in TransactItems]
        if any(put['TableName'] != self.name for put in puts) or len(puts) != len(TransactItems):
            raise NotImplementedError('only Put items of this table')
        with _WRITES:
            reasons = [
                'None' if _string_condition_holds(put, self.rows.get(self._row_key(stored(put['Item'])), {})) else 'ConditionalCheckFailed'
                for put in puts
            ]
            if 'ConditionalCheckFailed' in reasons:
                raise _transaction_cancelled(reasons)
            for put in puts:
                super().put_item(Item=put['Item'])
        return {}

    @property
    def meta(self) -> Any:
        return SimpleNamespace(client=self)


def exports_table() -> ConditionalTable:
    """An empty ``CitationAnalysis-Exports`` table with its owner index."""
    return ConditionalTable('CitationAnalysis-Exports', ('export_id',), {'OwnerCreatedIndex': ('owner', 'created_at')})


@dataclass
class ListRowSource:
    """An ``ExportRowSource`` over ``rows`` (see the module docstring)."""

    sheets: tuple[ExportSheet, ...]
    rows_by_position: Sequence[tuple[str, tuple[Any, ...]]]
    view: str = 'citations'
    per_chunk: int | None = None
    spends_deadline: bool = True
    clock: JumpClock = field(default_factory=JumpClock)
    refused: str | None = None
    calls: list[ExportCursor | None] = field(default_factory=list)

    def validate(self, params: Mapping[str, str], caller: Caller) -> str | None:
        del params, caller
        return self.refused

    def rows(self, params: Mapping[str, str], cursor: ExportCursor | None, deadline: Deadline) -> ExportRows:
        del params
        self.calls.append(cursor)
        position_after = (cursor or {}).get('next')
        start = position_after if isinstance(position_after, int) else 0
        for position in range(start, len(self.rows_by_position)):
            if deadline.expired():
                return RowsEnd.STOPPED
            if self.per_chunk is not None and position - start >= self.per_chunk:
                if self.spends_deadline:
                    self.clock.jump()
                return RowsEnd.STOPPED
            sheet, values = self.rows_by_position[position]
            yield ExportRow(sheet, values, {'next': position + 1})
        return RowsEnd.FINISHED


@dataclass
class FakeStepFunctions:
    """``start_execution`` / ``stop_execution`` recorded; ``running`` holds executions not stopped."""

    started: list[dict[str, Any]] = field(default_factory=list)
    stopped: list[dict[str, Any]] = field(default_factory=list)

    def start_execution(self, **params: Any) -> dict[str, Any]:
        self.started.append(dict(params))
        return {'executionArn': f'arn:aws:states:us-east-1:123456789012:execution:CitationAnalysis-Export:{params["name"]}'}

    def stop_execution(self, **params: Any) -> dict[str, Any]:
        self.stopped.append(dict(params))
        return {}
