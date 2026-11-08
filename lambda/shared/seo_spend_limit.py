"""The per-caller daily limit on the paid one-off SEO routes (TENETS.md, tenet 4: spend limits are server-side).

Any signed-in user may make a one-off DataForSEO lookup (research, a results page, a domain or backlinks overview,
a local search, a Lighthouse run). Each such request counts once against its caller's UTC day, in
``CitationAnalysis-SeoCache`` under ``spend#<caller>#<YYYY-MM-DD>`` (expiring after two days). Past
``SEO_PAID_REQUESTS_PER_DAY`` (default 100) the router answers 429 before the handler runs, so no call is made.
A request answered from the cache still counts: the limit is on what a caller may ask for, not on what was billed.

An export's reads (the export worker invokes this router as ``export-service``) count against the export's owner,
named in the ``custom:export_owner`` claim of the worker's event; a user cannot set that claim (no such attribute
exists in the user pool) and a signed-in user is never ``export-service``.

The count is taken before the handler runs, so a request that then fails still counts. The MCP server's own
``seoCallsPerDay`` limit applies on top for MCP callers (their tool calls replay against this router).
Admin-only paid work (rank checks, snapshots, site audits, Lighthouse batches) is not counted here: it is
confirmed per request and limited by who may start it.
"""

from __future__ import annotations

import os
import time
from collections.abc import Callable
from typing import Any

from shared.api_response import api_response
from shared.auth import get_caller_claims, get_caller_identity
from shared.dynamodb_conditions import applied_conditionally
from shared.seo_cache import cache_table
from shared.utils import utc_now

__all__ = ['DEFAULT_LIMIT', 'LIMIT_ENV', 'PAID_ROUTES', 'counter_key', 'is_paid', 'limit', 'limited', 'spender', 'take']

LIMIT_ENV = 'SEO_PAID_REQUESTS_PER_DAY'
DEFAULT_LIMIT = 100
COUNTER_TTL_S = 2 * 24 * 3600

#: The paid one-off routes (``POST``), by their path below ``/api/seo``.
PAID_ROUTES = frozenset({
    'keywords/research', 'keywords/metrics', 'serp',
    'domains/overview', 'domains/keywords', 'domains/pages', 'domains/competitors',
    'backlinks/overview', 'backlinks/rows', 'backlinks/referring-domains', 'backlinks/top-pages',
    'local/businesses', 'local/profile', 'local/questions', 'local/serp', 'local/jobs',
    'lighthouse',
})
_PREFIX = '/api/seo/'


def _table() -> Any:
    return cache_table()


def limit() -> int:
    """The configured daily limit (a non-positive or unreadable value falls back to the default)."""
    try:
        value = int(os.environ.get(LIMIT_ENV, DEFAULT_LIMIT))
    except ValueError:
        return DEFAULT_LIMIT
    return value if value > 0 else DEFAULT_LIMIT


def is_paid(method: str, path: str) -> bool:
    return method == 'POST' and path.startswith(_PREFIX) and path[len(_PREFIX):].rstrip('/') in PAID_ROUTES


def counter_key(caller: str, day: str) -> str:
    return f'spend#{caller}#{day}'


def take(caller: str, table: Any = None) -> bool:
    """Count one paid request for ``caller`` today; ``False`` (nothing counted) when the limit is reached."""
    key = counter_key(caller, utc_now().strftime('%Y-%m-%d'))
    return applied_conditionally(lambda: (table or _table()).update_item(
        Key={'cache_key': key},
        UpdateExpression='ADD requests :one SET #ttl = if_not_exists(#ttl, :ttl)',
        ConditionExpression='attribute_not_exists(requests) OR requests < :limit',
        ExpressionAttributeNames={'#ttl': 'ttl'},
        ExpressionAttributeValues={':one': 1, ':limit': limit(), ':ttl': int(time.time()) + COUNTER_TTL_S},
    ))


Handler = Callable[[dict[str, Any], Any], dict[str, Any]]

#: The export worker's caller identity and the claim naming the export's owner (``shared.export_source_routes``).
EXPORT_SERVICE = 'export-service'
EXPORT_OWNER_CLAIM = 'custom:export_owner'


def spender(event: dict[str, Any]) -> str:
    """Whom a paid request counts against: the caller, or the owner of the export the worker reads for."""
    caller = get_caller_identity(event) or 'unknown'
    owner = get_caller_claims(event).get(EXPORT_OWNER_CLAIM) if caller == EXPORT_SERVICE else None
    return owner if isinstance(owner, str) and owner else caller


def limited(dispatch: Handler) -> Handler:
    """``dispatch`` behind the daily limit: a paid one-off request past it answers 429 and is not dispatched."""
    def guarded(event: dict[str, Any], context: Any) -> dict[str, Any]:
        paid = is_paid(str(event.get('httpMethod') or ''), str(event.get('path') or ''))
        if paid and not take(spender(event)):
            return api_response(429, {
                'error': f'You have made {limit()} paid SEO requests today (UTC); the limit resets at midnight UTC',
                'code': 'DAILY_LIMIT',
            }, event)
        return dispatch(event, context)

    return guarded
