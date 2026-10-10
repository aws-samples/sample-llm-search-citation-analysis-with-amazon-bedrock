"""Pace requests to a provider across every Lambda slot: a shared send-time ledger in the ProviderConfig table.

Reserved concurrency caps how many requests to a provider are in flight, not
how often they start. Perplexity allows about one request a second for a key
(``x-ratelimit-limit: 1``): three slots each sending every ~15 s land in the
same second about one call in five, and the loser is refused (429) and retried
a second later. Firecrawl's plan counts requests per minute, refused ones
included, so two slots with 3 s searches overrun it and spend the quota on
retries. A refused request is recovered by ``retry_with_backoff``, but it is
noise and quota the pacer avoids: every request claims the next free send
time from one item per provider (``pacer#<provider_id>`` in the ProviderConfig
table), so no two requests to the provider leave within its interval, however
many slots are running.

``PROVIDER_MIN_INTERVAL_SECONDS`` (set by CDK on the provider functions that
need it; ``lib/constructs/provider-search.ts``) is the interval; absent or 0
means no pacing. The ledger is advisory: a DynamoDB failure sends at once.
"""

from __future__ import annotations

import logging
import os
import time
from collections.abc import Callable
from decimal import Decimal
from typing import Any

from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger(__name__)
# The Lambda root logger is WARNING: the one line per paced wait is the record of why a call took longer.
logger.setLevel(logging.INFO)

PACER_ITEM_PREFIX = 'pacer#'
PROVIDER_MIN_INTERVAL_ENV = 'PROVIDER_MIN_INTERVAL_SECONDS'
#: Claims that lost the conditional write to another slot; contention is at most the reserved concurrency.
MAX_CLAIM_ATTEMPTS = 8
#: A claimed slot further ahead than this is not waited for (a clock far off, or a corrupt ledger).
MAX_WAIT_SECONDS = 120.0


def provider_min_interval_seconds() -> float:
    """The seconds between two requests to this function's provider, from the environment; 0 when unpaced.

    Read on every call so a test (or a changed environment) sees the current
    value. An unusable value means no pacing, with a warning, rather than a
    failed search.
    """
    # Literal name (not PROVIDER_MIN_INTERVAL_ENV) so scripts/check-contracts.py
    # can match it to the CDK stack that sets it.
    raw = os.environ.get('PROVIDER_MIN_INTERVAL_SECONDS')
    if raw is None or raw.strip() == '':
        return 0.0
    try:
        interval = float(raw)
    except ValueError:
        interval = -1.0
    if interval < 0:
        logger.warning('[PACING_CONFIG] %s=%r is not a number >= 0; not pacing', PROVIDER_MIN_INTERVAL_ENV, raw)
        return 0.0
    return interval


def _ledger_key(provider_id: str) -> dict[str, str]:
    return {'provider_id': f'{PACER_ITEM_PREFIX}{provider_id}'}


def _try_claim(table: Any, key: dict[str, str], interval: float, now: float) -> float | None:
    """Claim the next send time once; ``None`` when another slot claimed it first."""
    item = table.get_item(Key=key, ConsistentRead=True).get('Item') or {}
    previous = item.get('next_send_at')
    slot = max(float(previous), now) if previous is not None else now
    condition = 'attribute_not_exists(next_send_at)' if previous is None else 'next_send_at = :previous'
    values: dict[str, Any] = {':next': Decimal(str(slot + interval))}
    if previous is not None:
        values[':previous'] = previous
    try:
        table.update_item(
            Key=key, UpdateExpression='SET next_send_at = :next', ConditionExpression=condition,
            ExpressionAttributeValues=values,
        )
    except ClientError as error:
        if error.response.get('Error', {}).get('Code') != 'ConditionalCheckFailedException':
            raise
        return None
    return slot


def claim_send_time(table: Any, provider_id: str, interval: float, *, now: Callable[[], float] = time.time) -> float:
    """The time this caller may send to ``provider_id``: the later of now and the previous claim plus ``interval``.

    Each claim moves the ledger forward by ``interval``; a slot in the past is
    "now", so an idle provider is not paid back with a burst. When the ledger
    cannot be read or written, the caller sends at once (logged once per call).
    """
    key = _ledger_key(provider_id)
    try:
        for _attempt in range(MAX_CLAIM_ATTEMPTS):
            slot = _try_claim(table, key, interval, now())
            if slot is not None:
                return slot
    except (ClientError, BotoCoreError):
        logger.warning('[PACING_LEDGER] %s send-time ledger unavailable; sending unpaced', provider_id)
        return now()
    logger.warning('[PACING_LEDGER] %s send-time ledger contended %s times; sending unpaced', provider_id, MAX_CLAIM_ATTEMPTS)
    return now()


def wait_for_send_slot(
    table: Any, provider_id: str, interval: float, *, now: Callable[[], float] = time.time, sleep: Callable[[float], None] = time.sleep,
) -> float:
    """Block until this caller's send time for ``provider_id``; returns the seconds waited (0 when unpaced)."""
    if interval <= 0:
        return 0.0
    wait = min(max(claim_send_time(table, provider_id, interval, now=now) - now(), 0.0), MAX_WAIT_SECONDS)
    if wait > 0:
        logger.info('[PACING] %s next send slot in %.1fs', provider_id, wait)
        sleep(wait)
    return wait


__all__ = [
    'MAX_CLAIM_ATTEMPTS',
    'MAX_WAIT_SECONDS',
    'PACER_ITEM_PREFIX',
    'PROVIDER_MIN_INTERVAL_ENV',
    'claim_send_time',
    'provider_min_interval_seconds',
    'wait_for_send_slot',
]
