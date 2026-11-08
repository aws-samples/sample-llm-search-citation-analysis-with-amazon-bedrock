"""The per-caller daily limit on the paid one-off SEO routes (TENETS.md, tenet 4: spend limits are server-side).

Any signed-in user may make a one-off DataForSEO lookup (research, a results page, a domain or backlinks overview,
a local search, a Lighthouse run). Each such request counts once against its caller's UTC day, in
``CitationAnalysis-SeoCache`` under ``spend#<caller>#<YYYY-MM-DD>`` (expiring after two days). Past
``SEO_PAID_REQUESTS_PER_DAY`` (default 100) the router answers 429 before the handler runs, so no call is made.
A request answered from the cache still counts: the limit is on what a caller may ask for, not on what was billed.

The count is taken before the handler runs, so a request that then fails still counts. The MCP server's own
``seoCallsPerDay`` limit applies on top for MCP callers (their tool calls replay against this router).
Admin-only paid work (rank checks, snapshots, site audits, Lighthouse batches) is not counted here: it is
confirmed per request and limited by who may start it.
"""

from __future__ import annotations

import functools
import os
import time
from typing import Any

import boto3

from shared.dynamodb_conditions import applied_conditionally
from shared.env_vars import resolve_table_env
from shared.utils import utc_now

__all__ = ['DEFAULT_LIMIT', 'LIMIT_ENV', 'PAID_ROUTES', 'counter_key', 'is_paid', 'limit', 'take']

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


@functools.cache
def _table() -> Any:
    return boto3.resource('dynamodb').Table(resolve_table_env('DYNAMODB_TABLE_SEO_CACHE'))


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
