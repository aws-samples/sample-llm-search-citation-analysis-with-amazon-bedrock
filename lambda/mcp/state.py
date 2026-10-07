"""
The MCP server's own state in DynamoDB (``CitationAnalysis-McpState``, ``MCP_STATE_TABLE``).

One table, string keys ``pk`` / ``sk``, TTL attribute ``ttl``:

==================  ========================  ==============================
item                pk                        sk
==================  ========================  ==============================
confirmation token  ``token#<sha256(token)>``  ``token``
daily counter       ``limit#<sub>``            ``<counter>#<YYYY-MM-DD>`` (UTC)
run start lock      ``limit#<sub>``            ``lock``
started run         ``runs#<sub>``             ``<started_at>#<execution name>``
audit record        ``audit#<sub>``            ``<at>#<operation>``
==================  ========================  ==============================

Confirmation tokens are random, stored only as a hash, bound to the caller,
the spend family and a digest of the exact API request, valid five minutes,
and consumed by a conditional delete so one token starts at most one spend.
Per-caller limits come from ``MCP_LIMITS`` (CDK context ``mcpLimits``).
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

TOKEN_TTL = timedelta(minutes=5)
#: A start that crashed mid-way frees the caller's lock after this long.
LOCK_TTL = timedelta(minutes=1)
AUDIT_TTL = timedelta(days=365)
RUN_RECORD_TTL = timedelta(days=7)
#: Started runs checked for "still running", newest first.
RECENT_RUNS = 10

_CONDITIONAL_CHECK_FAILED = 'ConditionalCheckFailedException'

_table: Any = None


def table() -> Any:
    """The state table, created on first use so importing this module needs no AWS region."""
    global _table
    if _table is None:
        _table = boto3.resource('dynamodb').Table(os.environ['MCP_STATE_TABLE'])
    return _table


def utc_now() -> datetime:
    return datetime.now(UTC)


def _epoch(moment: datetime) -> int:
    return int(moment.timestamp())


def _iso(moment: datetime) -> str:
    return moment.isoformat().replace('+00:00', 'Z')


def _is_conditional_failure(error: ClientError) -> bool:
    return error.response.get('Error', {}).get('Code') == _CONDITIONAL_CHECK_FAILED


# --- Limits ---------------------------------------------------------------------

@dataclass(frozen=True)
class Limits:
    """Per-caller limits; field names match the ``mcpLimits`` CDK context keys in camelCase."""

    runs_in_flight: int = 1
    runs_per_day: int = 5
    jobs_per_day: int = 20
    max_run_keywords: int = 50


_LIMIT_KEYS = {
    'runsInFlight': 'runs_in_flight',
    'runsPerDay': 'runs_per_day',
    'jobsPerDay': 'jobs_per_day',
    'maxRunKeywords': 'max_run_keywords',
}


def limits() -> Limits:
    """``MCP_LIMITS`` (a JSON object, camelCase keys) over the defaults; unknown keys and non-integers are ignored."""
    raw = json.loads(os.environ.get('MCP_LIMITS') or '{}')
    values = {
        field: raw[key] for key, field in _LIMIT_KEYS.items()
        if isinstance(raw.get(key), int) and not isinstance(raw.get(key), bool) and raw[key] >= 0
    }
    return Limits(**values)


def next_reset() -> str:
    """When the UTC-day counters start again: the next midnight UTC."""
    tomorrow = (utc_now() + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return _iso(tomorrow)


# --- Confirmation tokens -------------------------------------------------------

class TokenRefused(Exception):
    """A confirmation token that cannot start this spend; ``str(error)`` says why."""


def request_digest(request: Any) -> str:
    """SHA-256 of the canonical JSON of ``request`` (the API request a spend makes)."""
    canonical = json.dumps(request, sort_keys=True, separators=(',', ':'), ensure_ascii=False, default=str)
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def _token_key(token: str) -> dict[str, str]:
    return {'pk': f'token#{hashlib.sha256(token.encode("utf-8")).hexdigest()}', 'sk': 'token'}


def issue_token(caller_sub: str, family: str, digest: str) -> tuple[str, str]:
    """A new single-use token for ``family`` bound to ``caller_sub`` and ``digest``, and when it expires (ISO)."""
    token = secrets.token_urlsafe(32)
    expires = utc_now() + TOKEN_TTL
    table().put_item(Item={
        **_token_key(token),
        'caller_sub': caller_sub,
        'family': family,
        'request_digest': digest,
        'expires_at': _epoch(expires),
        'ttl': _epoch(expires + LOCK_TTL),
    })
    return token, _iso(expires)


def _token_refusal(item: dict[str, Any] | None, caller_sub: str, family: str, digest: str) -> str | None:
    """Why the stored token ``item`` cannot start this spend, or ``None`` when it can."""
    if not item:
        return 'The confirmation_token is unknown, already used or expired; call the estimate again'
    if item.get('caller_sub') != caller_sub:
        return 'The confirmation_token was issued to another user'
    if int(item.get('expires_at', 0)) <= _epoch(utc_now()):
        return 'The confirmation_token has expired (5 minutes); call the estimate again'
    if item.get('family') != family or item.get('request_digest') != digest:
        return 'The confirmation_token was issued for other arguments; call the estimate again with these'
    return None


def consume_token(token: str, caller_sub: str, family: str, digest: str) -> None:
    """Use up the token when it matches caller, family and request and has not expired; ``TokenRefused`` otherwise.

    A token that does not match is left in place (it may still be the
    caller's for other arguments). A matching one is deleted under
    ``attribute_exists``, so of two concurrent starts presenting it only one
    deletes it and proceeds.
    """
    key = _token_key(token)
    reason = _token_refusal(table().get_item(Key=key, ConsistentRead=True).get('Item'), caller_sub, family, digest)
    if reason is not None:
        raise TokenRefused(reason)
    try:
        table().delete_item(Key=key, ConditionExpression='attribute_exists(pk)')
    except ClientError as error:
        if not _is_conditional_failure(error):
            raise
        raise TokenRefused('The confirmation_token has just been used; call the estimate again') from error


# --- Daily counters ---------------------------------------------------------------

def _counter_key(caller_sub: str, counter: str, day: str) -> dict[str, str]:
    return {'pk': f'limit#{caller_sub}', 'sk': f'{counter}#{day}'}


def _today() -> str:
    return utc_now().strftime('%Y-%m-%d')


def used_today(caller_sub: str, counter: str) -> int:
    item = table().get_item(Key=_counter_key(caller_sub, counter, _today())).get('Item') or {}
    return int(item.get('used', 0))


def reserve(caller_sub: str, counter: str, limit: int) -> str | None:
    """Count one more ``counter`` use today when under ``limit``: the day reserved, or ``None`` at the limit."""
    if limit <= 0:
        return None
    day = _today()
    try:
        table().update_item(
            Key=_counter_key(caller_sub, counter, day),
            UpdateExpression='ADD used :one SET #ttl = :ttl',
            ConditionExpression='attribute_not_exists(used) OR used < :limit',
            ExpressionAttributeNames={'#ttl': 'ttl'},
            ExpressionAttributeValues={':one': 1, ':limit': limit, ':ttl': _epoch(utc_now() + timedelta(days=2))},
        )
    except ClientError as error:
        if _is_conditional_failure(error):
            return None
        raise
    return day


def release(caller_sub: str, counter: str, day: str) -> None:
    """Give back a use ``reserve`` counted when the spend did not happen (best effort)."""
    try:
        table().update_item(
            Key=_counter_key(caller_sub, counter, day),
            UpdateExpression='ADD used :minus_one',
            ConditionExpression='used > :zero',
            ExpressionAttributeValues={':minus_one': -1, ':zero': 0},
        )
    except (BotoCoreError, ClientError):
        logger.exception('Could not release a %s use for %s', counter, caller_sub)


# --- Runs in flight ------------------------------------------------------------------

def acquire_run_lock(caller_sub: str) -> bool:
    """Take the caller's start lock, so two start_run calls cannot both pass the in-flight check."""
    now = utc_now()
    try:
        table().put_item(
            Item={'pk': f'limit#{caller_sub}', 'sk': 'lock', 'expires_at': _epoch(now + LOCK_TTL),
                  'ttl': _epoch(now + LOCK_TTL + LOCK_TTL)},
            ConditionExpression='attribute_not_exists(pk) OR expires_at < :now',
            ExpressionAttributeValues={':now': _epoch(now)},
        )
    except ClientError as error:
        if _is_conditional_failure(error):
            return False
        raise
    return True


def release_run_lock(caller_sub: str) -> None:
    try:
        table().delete_item(Key={'pk': f'limit#{caller_sub}', 'sk': 'lock'})
    except (BotoCoreError, ClientError):
        logger.exception('Could not release the run lock of %s; it expires on its own', caller_sub)


def unfinished_runs(caller_sub: str) -> list[dict[str, Any]]:
    """The caller's newest started runs not yet seen finished."""
    response = table().query(
        KeyConditionExpression=Key('pk').eq(f'runs#{caller_sub}'),
        ScanIndexForward=False,
        Limit=RECENT_RUNS,
    )
    return [item for item in response.get('Items', []) if not item.get('finished')]


def record_run(caller_sub: str, execution_arn: str) -> None:
    now = utc_now()
    table().put_item(Item={
        'pk': f'runs#{caller_sub}',
        'sk': f'{_iso(now)}#{execution_arn.rsplit(":", 1)[-1]}',
        'execution_arn': execution_arn,
        'ttl': _epoch(now + RUN_RECORD_TTL),
    })


def mark_finished(run: dict[str, Any]) -> None:
    """Remember that ``run`` (an item of ``unfinished_runs``) has stopped, so it is not checked again."""
    try:
        table().update_item(
            Key={'pk': run['pk'], 'sk': run['sk']},
            UpdateExpression='SET finished = :true',
            ExpressionAttributeValues={':true': True},
        )
    except (BotoCoreError, ClientError):
        logger.exception('Could not mark run %s finished', run.get('execution_arn'))


# --- Audit ----------------------------------------------------------------------------

def record_audit(caller_sub: str, tool: str, operation: str, outcome: str, reason: str | None) -> None:
    """One audit record (365-day TTL) for a write or spend call; best effort, and skipped without a state table."""
    if not os.environ.get('MCP_STATE_TABLE'):
        return
    now = utc_now()
    item: dict[str, Any] = {
        'pk': f'audit#{caller_sub}',
        'sk': f'{_iso(now)}#{operation}#{secrets.token_hex(4)}',
        'tool': tool,
        'operation': operation,
        'outcome': outcome,
        'ttl': _epoch(now + AUDIT_TTL),
    }
    if reason:
        item['reason'] = reason
    try:
        table().put_item(Item=item)
    except (BotoCoreError, ClientError):
        logger.exception('Could not write the audit record of %s', operation)
