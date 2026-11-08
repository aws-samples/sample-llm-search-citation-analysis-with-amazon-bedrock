"""
The export jobs table ``CitationAnalysis-Exports`` (2.45.0): one item per export, its state and checkpoint.

Key: ``export_id``; GSI ``OwnerCreatedIndex`` (``owner`` = the Cognito
``sub``, ``created_at``) lists a user's exports newest first; TTL
``expires_at`` drops an item ``EXPORT_RETENTION_DAYS`` after it was created
(the file under ``exports/`` expires with the bucket's lifecycle rule).

Every write replaces the whole item on the condition that its ``revision``
is the one read, so the API (cancel, seen, delete) and the worker
(checkpoints) never overwrite each other's change: the loser gets
``StaleExportError`` and reads again. Writer state and cursors are stored as
JSON strings, so their integers do not come back as ``Decimal``.

Status: ``queued`` (POST) → ``running`` (Prepare) → ``ready`` (Finalize) |
``failed`` (MarkFailed) | ``cancelled`` (DELETE while queued or running).

Running limit: each owner has one *slots* item (key ``slots#<sub>``, no
``owner`` attribute, so neither the owner index nor ``owned`` sees it)
listing their queued and running export ids. ``create`` puts the export and
the slots item with one more id in one ``TransactWriteItems``, conditioned on
the slots item's revision, and refuses a sixth (``TooManyExportsError``); a
``save`` that moves an export out of queued/running takes its id out in the
same transaction. Both writes are puts (the IAM the jobs already have). A
listed id whose export is gone or finished is dropped when the list is full.
"""

from __future__ import annotations

import importlib
import json
import secrets
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Final

from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import ClientError

from shared.cursors import encode_cursor
from shared.dynamodb_conditions import applied_conditionally
from shared.export_contract import (
    EXPORT_RETENTION_DAYS,
    MAX_RUNNING_EXPORTS_PER_USER,
    Caller,
    ExportCursor,
    ExportFormat,
    ExportRowSource,
    ExportSummary,
)
from shared.partition_pages import decode_key
from shared.utils import format_timestamp

OWNER_INDEX: Final = 'OwnerCreatedIndex'
RUNNING_STATUSES: Final = frozenset({'queued', 'running'})
#: Exports one ``GET /api/exports`` page lists by default and at most.
PAGE_DEFAULT: Final = 50
PAGE_MAX: Final = 100

_INDEX_KEY: Final = ('export_id', 'owner', 'created_at')
_INT_FIELDS: Final = ('rows', 'truncated_cells', 'bytes', 'parts', 'chunks', 'revision', 'expires_at')


class StaleExportError(RuntimeError):
    """The item changed (or vanished) since it was read: another writer won."""


class TooManyExportsError(RuntimeError):
    """The owner already has ``MAX_RUNNING_EXPORTS_PER_USER`` exports queued or running."""


#: Times ``create`` / a finishing ``save`` read the slots item again after another writer changed it.
SLOT_ATTEMPTS: Final = 10
_SLOTS_PREFIX: Final = 'slots#'
_NEW_ITEM: Final = 'attribute_not_exists(export_id)'
_SAME_REVISION: Final = '#revision = :revision'
_CANCELLED: Final = 'TransactionCanceledException'


def slots_key(owner: str) -> str:
    """The key of ``owner``'s slots item."""
    return f'{_SLOTS_PREFIX}{owner}'


def _put(table_name: str, item: Mapping[str, Any], revision: int | None) -> dict[str, Any]:
    """A transaction ``Put`` of ``item``: new (``revision`` ``None``) or replacing the one at ``revision``."""
    put: dict[str, Any] = {'TableName': table_name, 'Item': dict(item)}
    if revision is None:
        put['ConditionExpression'] = _NEW_ITEM
    else:
        put.update(ConditionExpression=_SAME_REVISION, ExpressionAttributeNames={'#revision': 'revision'}, ExpressionAttributeValues={':revision': revision})
    return {'Put': put}


@dataclass(frozen=True)
class _Slots:
    owner: str
    ids: tuple[str, ...]
    revision: int | None
    """``None``: the owner has no slots item yet."""

    def put(self, table_name: str, ids: tuple[str, ...]) -> dict[str, Any]:
        item = {'export_id': slots_key(self.owner), 'running_ids': list(ids), 'revision': (self.revision or 0) + 1}
        return _put(table_name, item, self.revision)


def new_export_id() -> str:
    """A random export id (URL- and S3-key-safe)."""
    return f'exp-{secrets.token_hex(12)}'


def export_filename(view: str, export_format: ExportFormat, now: datetime) -> str:
    """``<view>-<UTC yyyymmdd-hhmmss>.<format>``."""
    return f'{view}-{now.strftime("%Y%m%d-%H%M%S")}.{export_format}'


def _plain(item: Mapping[str, Any]) -> dict[str, Any]:
    """``item`` with its counters as ``int`` (DynamoDB answers ``Decimal``)."""
    plain = dict(item)
    for name in _INT_FIELDS:
        if name in plain and plain[name] is not None:
            plain[name] = int(plain[name])
    if 'part_etags' in plain:
        plain['part_etags'] = [str(etag) for etag in plain['part_etags']]
    return plain


@dataclass(frozen=True)
class NewExport:
    """What ``POST /api/exports`` asked for, validated."""

    caller: Caller
    view: str
    params: dict[str, str]
    export_format: ExportFormat


def new_item(request: NewExport, now: datetime) -> dict[str, Any]:
    """A ``queued`` export item."""
    stamp = format_timestamp(now)
    return {
        'export_id': new_export_id(), 'owner': request.caller.sub, 'owner_email': request.caller.email,
        'owner_username': request.caller.username, 'owner_groups': sorted(request.caller.groups),
        'view': request.view, 'params': dict(request.params), 'format': request.export_format, 'status': 'queued',
        'created_at': stamp, 'updated_at': stamp, 'expires_at': int((now + timedelta(days=EXPORT_RETENTION_DAYS)).timestamp()),
        'rows': 0, 'truncated_cells': 0, 'bytes': 0, 'parts': 0, 'chunks': 0, 'part_etags': [], 'cursor': None, 'writer_state': None,
        'upload_id': None, 'filename': export_filename(request.view, request.export_format, now),
        'notified': False, 'revision': 0,
    }


class ExportJobs:
    """The jobs table (``table``: a boto3 ``Table``)."""

    def __init__(self, table: Any) -> None:
        self._table = table

    def _slots(self, owner: str) -> _Slots:
        found = self._table.get_item(Key={'export_id': slots_key(owner)}, ConsistentRead=True).get('Item')
        if found is None:
            return _Slots(owner, (), None)
        return _Slots(owner, tuple(str(export_id) for export_id in found.get('running_ids') or ()), int(found['revision']))

    def _is_running(self, export_id: str) -> bool:
        item = self.get(export_id)
        return item is not None and item['status'] in RUNNING_STATUSES

    def _transact(self, puts: list[dict[str, Any]]) -> list[str] | None:
        """``None`` when the puts were written, else each one's cancellation reason (``ConditionalCheckFailed`` …)."""
        try:
            self._table.meta.client.transact_write_items(TransactItems=puts)
        except ClientError as error:
            if error.response.get('Error', {}).get('Code') != _CANCELLED:
                raise
            return [str(reason.get('Code')) for reason in error.response.get('CancellationReasons', [])]
        return None

    def create(self, item: Mapping[str, Any]) -> dict[str, Any]:
        """
        Store a new export and take one of its owner's running slots, in one transaction.

        Raises:
            TooManyExportsError: The owner's slots are all taken by running exports.
            StaleExportError: Other writers kept changing the slots item.
        """
        export_id = str(item['export_id'])
        for _attempt in range(SLOT_ATTEMPTS):
            slots = self._slots(str(item['owner']))
            ids = slots.ids
            if len(ids) >= MAX_RUNNING_EXPORTS_PER_USER:
                ids = tuple(listed for listed in ids if self._is_running(listed))
            if len(ids) >= MAX_RUNNING_EXPORTS_PER_USER:
                raise TooManyExportsError(slots.owner)
            reasons = self._transact([_put(self._table.name, item, None), slots.put(self._table.name, (*ids, export_id))])
            if reasons is None:
                return _plain(item)
            if reasons[0] != 'None':
                raise StaleExportError(export_id)
        raise StaleExportError(export_id)

    def _save_releasing(self, updated: dict[str, Any], revision: int) -> dict[str, Any]:
        """Write ``updated`` (no longer running) and free its slot in one transaction."""
        export_id = str(updated['export_id'])
        for _attempt in range(SLOT_ATTEMPTS):
            slots = self._slots(str(updated['owner']))
            if export_id not in slots.ids:
                return self._save_alone(updated, revision)
            remaining = tuple(listed for listed in slots.ids if listed != export_id)
            reasons = self._transact([_put(self._table.name, updated, revision), slots.put(self._table.name, remaining)])
            if reasons is None:
                return _plain(updated)
            if reasons[0] != 'None':
                raise StaleExportError(export_id)
        raise StaleExportError(export_id)

    def _save_alone(self, updated: dict[str, Any], revision: int) -> dict[str, Any]:
        if not applied_conditionally(lambda: self._table.put_item(Item=updated, ConditionExpression=Attr('revision').eq(revision))):
            raise StaleExportError(str(updated['export_id']))
        return _plain(updated)

    def get(self, export_id: str) -> dict[str, Any] | None:
        found = self._table.get_item(Key={'export_id': export_id}, ConsistentRead=True).get('Item')
        return None if found is None else _plain(found)

    def owned(self, export_id: str, owner: str) -> dict[str, Any] | None:
        """The export ``export_id`` when ``owner`` created it, else ``None`` (another user's export does not exist for them)."""
        item = self.get(export_id)
        return item if item is not None and item.get('owner') == owner else None

    def save(self, item: Mapping[str, Any], now: datetime, **changes: Any) -> dict[str, Any]:
        """
        Write ``item`` with ``changes`` if nobody wrote it since it was read.

        A save that moves the export out of queued/running frees its running
        slot in the same transaction.

        Raises:
            StaleExportError: The item's ``revision`` moved on, or it was deleted.
        """
        revision = int(item['revision'])
        updated = {**item, **changes, 'revision': revision + 1, 'updated_at': format_timestamp(now)}
        if item['status'] in RUNNING_STATUSES and updated['status'] not in RUNNING_STATUSES:
            return self._save_releasing(updated, revision)
        return self._save_alone(updated, revision)

    def delete(self, export_id: str) -> None:
        self._table.delete_item(Key={'export_id': export_id})

    def page(self, owner: str, limit: int, start: Mapping[str, Any] | None) -> tuple[list[dict[str, Any]], dict[str, Any] | None]:
        """One newest-first page of ``owner``'s exports and the key after it (``None``: the last page)."""
        params: dict[str, Any] = {
            'IndexName': OWNER_INDEX, 'KeyConditionExpression': Key('owner').eq(owner), 'ScanIndexForward': False, 'Limit': limit,
        }
        if start is not None:
            params['ExclusiveStartKey'] = dict(start)
        response = self._table.query(**params)
        return [_plain(item) for item in response.get('Items', [])], response.get('LastEvaluatedKey')


def export_sources() -> Mapping[str, ExportRowSource]:
    """``shared.export_sources.EXPORT_SOURCES``: the row source of every view (imported on first use)."""
    return importlib.import_module('shared.export_sources').EXPORT_SOURCES


def page_token(start: Mapping[str, Any] | None) -> str | None:
    """The ``next_token`` of a list page."""
    return None if start is None else encode_cursor({name: start[name] for name in _INDEX_KEY if name in start})


def page_start(token: str, owner: str) -> dict[str, Any] | None:
    """The start key ``token`` carries when it is well-formed and ``owner``'s, else ``None`` (a 400)."""
    start = decode_key(token, _INDEX_KEY)
    return start if start is not None and start['owner'] == owner else None


def item_owner(item: Mapping[str, Any], groups: frozenset[str] | None = None) -> Caller:
    """The export's owner as a ``Caller``, with ``groups`` (default: the groups they had when they queued it)."""
    stored = frozenset(str(group) for group in item.get('owner_groups') or ())
    return Caller(
        sub=str(item['owner']), email=item.get('owner_email'), groups=stored if groups is None else groups,
        username=str(item.get('owner_username') or item['owner']),
    )


def item_cursor(item: Mapping[str, Any]) -> ExportCursor | None:
    raw = item.get('cursor')
    return None if not raw else json.loads(str(raw))


def item_writer_state(item: Mapping[str, Any]) -> dict[str, Any] | None:
    raw = item.get('writer_state')
    return None if not raw else json.loads(str(raw))


def summary(item: Mapping[str, Any]) -> ExportSummary:
    """The API shape of an export item (no key, upload id, cursor or owner)."""
    answer: ExportSummary = {
        'export_id': str(item['export_id']), 'view': str(item['view']),
        'params': {str(name): str(value) for name, value in dict(item.get('params') or {}).items()},
        'format': 'xlsx' if item.get('format') == 'xlsx' else 'csv', 'status': item['status'],
        'created_at': str(item['created_at']), 'updated_at': str(item['updated_at']),
        'rows': int(item.get('rows') or 0), 'truncated_cells': int(item.get('truncated_cells') or 0),
        'bytes': int(item.get('bytes') or 0), 'filename': str(item['filename']),
        'notified': bool(item.get('notified')),
    }
    if item.get('error'):
        answer['error'] = str(item['error'])
    return answer
