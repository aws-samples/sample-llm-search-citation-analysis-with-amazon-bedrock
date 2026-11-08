"""DataForSEO pingbacks resume a waiting state machine: no polling while queued tasks run.

A step that posts queued tasks (rank checks, local SEO jobs) is a Step Functions ``waitForTaskToken`` task.
Before posting it opens a *gate*: one item in ``CitationAnalysis-SeoCache`` keyed ``callback#<gate id>``, holding
the number of tasks it is about to post, the task token and the output to resume with. Each task carries a
``pingback_url`` naming the gate (``?gate=<gate id>&id=$id``; DataForSEO fills in the task id), and DataForSEO
calls it once the task is ready. The public callback function (``lambda/seo-callbacks``) counts the arrival on
the gate; the arrival that brings it to zero sends the task token, and the state machine collects the results
with free ``task_get`` calls.

- The gate id is 32 random bytes: knowing it is the only way to reach the gate, so it is never logged.
- An arrival is counted once per task id (``seen``), so a repeated pingback cannot release the gate early.
- Releasing claims the gate first (``released``), so it sends the token once; a send that fails gives the claim
  back, and the next pingback of the gate (a retry of the same one included) or the post step sends it again.
- Tasks DataForSEO refused at post time never call back: ``settle`` takes them off the count, and releases the
  gate when that leaves none.
- A pingback that never comes is covered by the wait's own timeout, after which the state machine collects
  once anyway (the bounded safety check).
- Gates expire with the table's TTL after ``GATE_TTL_S``; a late pingback then finds no gate and is ignored.
"""

from __future__ import annotations

import functools
import json
import logging
import os
import re
import secrets
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, TypeGuard

import boto3
from botocore.exceptions import ClientError

from shared.dynamodb_conditions import is_conditional_check_failure
from shared.env_vars import resolve_table_env

__all__ = [
    'CALLBACK_URL_ENV',
    'GATE_KEY_PREFIX',
    'GATE_TTL_S',
    'Arrival',
    'arrive',
    'gate_key',
    'is_gate_id',
    'is_task_id',
    'new_gate_id',
    'open_gate',
    'pingback_url',
    'release',
    'release_if_due',
    'settle',
]

logger = logging.getLogger(__name__)

CALLBACK_URL_ENV = 'DATAFORSEO_CALLBACK_URL'
GATE_KEY_PREFIX = 'callback#'
GATE_TTL_S = 2 * 24 * 3600
_GATE_ID = re.compile(r'[A-Za-z0-9_-]{43}')
_TASK_ID = re.compile(r'[A-Za-z0-9-]{1,64}')
_GONE_TOKEN_CODES = frozenset({'TaskTimedOut', 'TaskDoesNotExist', 'InvalidToken'})


@functools.cache
def _table() -> Any:
    return boto3.resource('dynamodb').Table(resolve_table_env('DYNAMODB_TABLE_SEO_CACHE'))


@functools.cache
def _states() -> Any:
    return boto3.client('stepfunctions')


def new_gate_id() -> str:
    return secrets.token_urlsafe(32)


def is_gate_id(value: object) -> TypeGuard[str]:
    return isinstance(value, str) and _GATE_ID.fullmatch(value) is not None


def is_task_id(value: object) -> TypeGuard[str]:
    return isinstance(value, str) and _TASK_ID.fullmatch(value) is not None


def gate_key(gate_id: str) -> str:
    return f'{GATE_KEY_PREFIX}{gate_id}'


def pingback_url(gate_id: str) -> str:
    """The URL DataForSEO calls when a task of this gate is ready (``$id`` is DataForSEO's placeholder)."""
    return f'{os.environ[CALLBACK_URL_ENV]}?gate={gate_id}&id=$id'


def open_gate(gate_id: str, expected: int, task_token: str, output: Mapping[str, Any], table: Any = None) -> None:
    """Write the gate before its ``expected`` tasks are posted, so no pingback can arrive first."""
    (table or _table()).put_item(Item={
        'cache_key': gate_key(gate_id),
        'remaining': expected,
        'task_token': task_token,
        'output': json.dumps(output),
        'ttl': int(time.time()) + GATE_TTL_S,
    })


@dataclass(frozen=True)
class Arrival:
    remaining: int
    task_token: str
    output: str


def _arrival(attributes: Mapping[str, Any]) -> Arrival:
    return Arrival(remaining=int(attributes.get('remaining') or 0), task_token=str(attributes.get('task_token') or ''),
                   output=str(attributes.get('output') or '{}'))


def _conditional_update(gate_id: str, table: Any, **update: Any) -> Arrival | None:
    """Apply ``update`` to the gate; ``None`` when its condition does not hold."""
    try:
        answer = table.update_item(Key={'cache_key': gate_key(gate_id)}, ReturnValues='ALL_NEW', **update)
    except ClientError as error:
        if is_conditional_check_failure(error):
            return None
        raise
    return _arrival(answer.get('Attributes') or {})


def arrive(gate_id: str, task_id: str, table: Any = None) -> Arrival | None:
    """Count ``task_id`` on the gate once; ``None`` for an unknown gate or a task already counted."""
    return _conditional_update(
        gate_id, table or _table(),
        UpdateExpression='ADD remaining :minus_one, seen :task',
        ConditionExpression='attribute_exists(cache_key) AND NOT contains(seen, :task_id)',
        ExpressionAttributeValues={':minus_one': -1, ':task': {task_id}, ':task_id': task_id},
    )


def settle(gate_id: str, never_coming: int, table: Any = None) -> Arrival:
    """Take ``never_coming`` tasks (refused at post time) off the gate's count."""
    answer = (table or _table()).update_item(
        Key={'cache_key': gate_key(gate_id)},
        UpdateExpression='ADD remaining :minus',
        ExpressionAttributeValues={':minus': -never_coming},
        ReturnValues='ALL_NEW',
    )
    return _arrival(answer.get('Attributes') or {})


def release(task_token: str, output: str, states: Any = None) -> bool:
    """Resume the waiting state machine; ``False`` when it no longer waits (timed out, or already resumed)."""
    try:
        (states or _states()).send_task_success(taskToken=task_token, output=output)
    except ClientError as error:
        if error.response.get('Error', {}).get('Code') in _GONE_TOKEN_CODES:
            logger.info('callback gate released after its wait ended')
            return False
        raise
    return True


def _claim(gate_id: str, table: Any) -> Arrival | None:
    """Mark an emptied gate released; ``None`` when it is unknown, not empty yet or already released."""
    return _conditional_update(
        gate_id, table,
        UpdateExpression='SET released = :yes',
        ConditionExpression='attribute_exists(cache_key) AND remaining <= :zero AND attribute_not_exists(released)',
        ExpressionAttributeValues={':yes': True, ':zero': 0},
    )


def release_if_due(gate_id: str, table: Any = None, states: Any = None) -> bool:
    """Resume the state machine once its gate is empty, exactly once; ``True`` when this call sent the token.

    A failed send gives the claim back and raises, so a later pingback (or a retry of this one) sends it.
    """
    gates = table or _table()
    gate = _claim(gate_id, gates)
    if gate is None:
        return False
    try:
        return release(gate.task_token, gate.output, states)
    except Exception:
        gates.update_item(Key={'cache_key': gate_key(gate_id)}, UpdateExpression='REMOVE released')
        raise
