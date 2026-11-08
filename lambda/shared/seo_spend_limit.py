"""The per-user daily limit on paid one-off DataForSEO calls (TENETS.md, tenet 4: spend limits are server-side).

Any signed-in user may make a one-off DataForSEO lookup (research, a results page, a domain or backlinks overview,
a local search, a Lighthouse run). Each billed DataForSEO call such a request makes counts once against its user's
UTC day, in ``CitationAnalysis-SeoCache`` under ``spend#<user>#<YYYY-MM-DD>`` (expiring after two days). A request
that makes three calls uses three; an answer read from the cache makes no call and uses none.

The limit is one number for every client: the dashboard, a script on the REST API, the MCP server (its SEO tools
replay against this router) and the export worker all go through here. An Admin sets it in Settings > AI Providers >
SEO data (``daily_call_limit`` on the ``dataforseo`` ProviderConfig row, ``shared.config``); the default is 100 and
``0`` turns paid one-off calls off. The call that would pass the limit is refused before it is sent
(``shared.dataforseo_client.guarding_billed_calls``) and the request answers 429 ``DAILY_LIMIT``.

An export's reads (the export worker invokes this router as ``export-service``) count against the export's owner,
named in the ``custom:export_owner`` claim of the worker's event; a user cannot set that claim (no such attribute
exists in the user pool) and a signed-in user is never ``export-service``.

Every paid request writes an audit record (``shared.spend_audit``): who, which route, how it ended and how many
billed calls it made (D4). Admin-only paid work (rank checks, snapshots, site audits, Lighthouse batches) is not
counted here: it is confirmed per request with its price and limited by who may start it.
"""

from __future__ import annotations

import logging
import os
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from shared.auth import get_caller_claims, get_caller_identity
from shared.config import DATAFORSEO_PROVIDER, seo_daily_call_limit
from shared.dataforseo_client import DataForSeoError, guarding_billed_calls
from shared.dynamodb_conditions import applied_conditionally
from shared.env_vars import resolve_table_env
from shared.seo_cache import cache_table
from shared.seo_paid_routes import PAID_ROUTES, is_paid
from shared.spend_audit import audit_item, put_audit
from shared.utils import utc_now

__all__ = [
    'DAILY_LIMIT_CODE', 'PAID_ROUTES', 'DailyCalls', 'counter_key', 'daily_calls', 'is_paid', 'limit', 'limited',
    'spender', 'take',
]

logger = logging.getLogger(__name__)

DAILY_LIMIT_CODE = 'DAILY_LIMIT'
COUNTER_TTL_S = 2 * 24 * 3600
#: The table the audit records go to (the MCP stack's ``CitationAnalysis-McpState``); unset: none are written.
AUDIT_TABLE_ENV = 'DYNAMODB_TABLE_MCP_STATE'
AUDIT_TOOL = 'seo-api'



def _counter_table() -> Any:
    return cache_table()


def _config_table() -> Any:
    return boto3.resource('dynamodb').Table(resolve_table_env('DYNAMODB_TABLE_PROVIDER_CONFIG'))


def limit(table: Any = None) -> int:
    """Today's limit per user, from Settings; the default when the row cannot be read (never unlimited)."""
    try:
        row = (table or _config_table()).get_item(Key={'provider_id': DATAFORSEO_PROVIDER}).get('Item')
    except (BotoCoreError, ClientError):
        logger.exception('Could not read the daily SEO call limit; using the default')
        row = None
    return seo_daily_call_limit(row)


def counter_key(caller: str, day: str) -> str:
    return f'spend#{caller}#{day}'


def _today() -> str:
    return utc_now().strftime('%Y-%m-%d')


def take(caller: str, allowed: int, table: Any = None) -> bool:
    """Count one billed call for ``caller`` today; ``False`` (nothing counted) when ``allowed`` are already made."""
    if allowed <= 0:
        return False
    return applied_conditionally(lambda: (table or _counter_table()).update_item(
        Key={'cache_key': counter_key(caller, _today())},
        UpdateExpression='ADD calls :one SET #ttl = if_not_exists(#ttl, :ttl)',
        ConditionExpression='attribute_not_exists(calls) OR calls < :limit',
        ExpressionAttributeNames={'#ttl': 'ttl'},
        ExpressionAttributeValues={':one': 1, ':limit': allowed, ':ttl': int(time.time()) + COUNTER_TTL_S},
    ))


@dataclass(frozen=True)
class DailyCalls:
    """A user's paid one-off DataForSEO calls today, the limit and when the count starts again."""

    used: int
    limit: int
    resets_at: str

    @property
    def remaining(self) -> int:
        return max(self.limit - self.used, 0)


def daily_calls(caller: str, counter_table: Any = None, config_table: Any = None) -> DailyCalls:
    item = (counter_table or _counter_table()).get_item(Key={'cache_key': counter_key(caller, _today())}).get('Item')
    tomorrow = (utc_now() + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return DailyCalls(int((item or {}).get('calls') or 0), limit(config_table), tomorrow.isoformat().replace('+00:00', 'Z'))


Handler = Callable[[dict[str, Any], Any], dict[str, Any]]

#: The export worker's caller identity and the claim naming the export's owner (``shared.export_source_routes``).
EXPORT_SERVICE = 'export-service'
EXPORT_OWNER_CLAIM = 'custom:export_owner'


def spender(event: dict[str, Any]) -> str:
    """Whom a paid request counts against: the caller, or the owner of the export the worker reads for."""
    caller = get_caller_identity(event) or 'unknown'
    owner = get_caller_claims(event).get(EXPORT_OWNER_CLAIM) if caller == EXPORT_SERVICE else None
    return owner if isinstance(owner, str) and owner else caller


class _Meter:
    """The billed calls of one request: each must pass ``take`` before it is sent."""

    def __init__(self, who: str, allowed: int) -> None:
        self.who = who
        self.allowed = allowed
        self.calls = 0
        self.refused = False

    def __call__(self, path: str) -> None:
        if not take(self.who, self.allowed):
            self.refused = True
            raise DataForSeoError(DAILY_LIMIT_CODE, f'Daily limit of {self.allowed} paid DataForSEO calls reached ({path})')
        self.calls += 1


def _audit(event: dict[str, Any], meter: _Meter, status: int) -> None:
    table_name = os.environ.get(AUDIT_TABLE_ENV)
    if not table_name:
        return
    operation = f'POST {str(event.get("path") or "").rstrip("/")}'
    # The outcome is the HTTP status the caller got: a request the limit cut short may still answer 200 with what
    # its earlier calls paid for (a backlinks summary without its history), and says so.
    reason = f'daily limit of {meter.allowed} calls reached: a billed call was not sent' if meter.refused else None
    item = audit_item(meter.who, AUDIT_TOOL, operation, f'http_{status}', utc_now(), calls=meter.calls, reason=reason)
    put_audit(boto3.resource('dynamodb').Table(table_name), item)


def limited(dispatch: Handler) -> Handler:
    """``dispatch`` with every billed call of a paid one-off request counted against today's limit, and audited."""
    def guarded(event: dict[str, Any], context: Any) -> dict[str, Any]:
        if not is_paid(str(event.get('httpMethod') or ''), str(event.get('path') or '')):
            return dispatch(event, context)
        meter = _Meter(spender(event), limit())
        with guarding_billed_calls(meter):
            response = dispatch(event, context)
        _audit(event, meter, int(response.get('statusCode') or 0))
        return response

    return guarded
