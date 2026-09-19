"""Persistent freshness policy for crawled page artifacts."""

from __future__ import annotations

import hashlib
import json
import logging
import sys
import time
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, NotRequired, TypedDict

from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

_CACHE_PROJECTION = "#crawled_at, #cache_status, #analysis_status, #block_reason"
_PERMANENT_CACHE_ERRORS = frozenset({
    'AccessDeniedException',
    'ResourceNotFoundException',
    'ValidationException',
})


class CrawlCacheConfigurationError(RuntimeError):
    """Raised when cache configuration would otherwise buy paid sessions."""


class CachedCrawl(TypedDict):
    """The lightweight cache fields returned to Step Functions."""

    status: Literal['success', 'blocked']
    crawled_at: str
    block_reason: NotRequired[str]


def _scope_digest(*parts: str) -> str:
    payload = '\0'.join(parts).encode('utf-8')
    return hashlib.sha256(payload).hexdigest()


def success_cache_scope(normalized_url: str, keyword: str) -> str:
    """Return the non-sensitive GSI key for one URL/keyword analysis."""
    return f"success#{_scope_digest(normalized_url, keyword)}"


def blocked_cache_scope(normalized_url: str) -> str:
    """Return the non-sensitive GSI key for a URL-wide blocked verdict."""
    return f"blocked#{_scope_digest(normalized_url)}"


def _parse_timestamp(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(UTC)


def _error_code(exc: Exception) -> str:
    if isinstance(exc, ClientError):
        code = exc.response.get('Error', {}).get('Code')
        if isinstance(code, str) and code:
            return code
    return type(exc).__name__


def _emit_read_failure(error_code: str) -> None:
    """Emit a low-cardinality CloudWatch EMF event without another API call."""
    metric = {
        '_aws': {
            'Timestamp': int(time.time() * 1000),
            'CloudWatchMetrics': [{
                'Namespace': 'CitationAnalysis/Crawler',
                'Dimensions': [['ErrorCode']],
                'Metrics': [{
                    'Name': 'CrawlCacheReadFailure',
                    'Unit': 'Count',
                }],
            }],
        },
        'ErrorCode': error_code,
        'CrawlCacheReadFailure': 1,
    }
    sys.stdout.write(json.dumps(metric, separators=(',', ':')) + '\n')


def _query_latest_scope(table: Any, index_name: str, cache_scope: str) -> Mapping[str, object] | None:
    response = table.query(
        IndexName=index_name,
        KeyConditionExpression=Key('cache_scope').eq(cache_scope),
        ScanIndexForward=False,
        Limit=1,
        ProjectionExpression=_CACHE_PROJECTION,
        ExpressionAttributeNames={
            '#crawled_at': 'crawled_at',
            '#cache_status': 'cache_status',
            '#analysis_status': 'analysis_status',
            '#block_reason': 'block_reason',
        },
    )
    items = response.get('Items', [])
    if not isinstance(items, list) or not items or not isinstance(items[0], Mapping):
        return None
    return items[0]


def find_fresh_crawl(
    table: Any,
    index_name: str,
    normalized_url: str,
    keyword: str,
    *,
    success_freshness_days: int,
    blocked_freshness_days: int,
    now: datetime | None = None,
) -> CachedCrawl | None:
    """Return the newest reusable success or blocked verdict.

    Success scope includes the keyword because SEO analysis is keyword-specific.
    Blocked scope is URL-wide. The compact GSI prevents one keyword's newer row
    from hiding another keyword's fresh result and avoids reading full page
    artifacts merely to make a freshness decision.

    Transient read failures degrade to metered misses. Permanent IAM/schema
    failures stop before AgentCore so a broken cache cannot silently multiply
    paid browser sessions.
    """
    if success_freshness_days <= 0 and blocked_freshness_days <= 0:
        return None

    candidates: list[
        tuple[Literal['success', 'blocked', 'error'], Mapping[str, object]]
    ] = []
    try:
        if success_freshness_days > 0:
            keyword_result = _query_latest_scope(
                table,
                index_name,
                success_cache_scope(normalized_url, keyword),
            )
            if keyword_result is not None:
                keyword_status = keyword_result.get('cache_status')
                if keyword_status in ('success', 'error'):
                    candidates.append((keyword_status, keyword_result))
        if blocked_freshness_days > 0:
            blocked_result = _query_latest_scope(
                table,
                index_name,
                blocked_cache_scope(normalized_url),
            )
            if blocked_result is not None and blocked_result.get('cache_status') == 'blocked':
                candidates.append(('blocked', blocked_result))
    except Exception as exc:
        error_code = _error_code(exc)
        _emit_read_failure(error_code)
        if error_code in _PERMANENT_CACHE_ERRORS:
            raise CrawlCacheConfigurationError(
                f'Crawl cache configuration error ({error_code})'
            ) from exc
        logger.warning(
            'Crawl cache read failed; continuing with an uncached crawl (%s)',
            error_code,
        )
        return None

    valid: list[
        tuple[Literal['success', 'blocked', 'error'], Mapping[str, object], datetime]
    ] = []
    for status, item in candidates:
        parsed_timestamp = _parse_timestamp(item.get('crawled_at'))
        if parsed_timestamp is not None:
            valid.append((status, item, parsed_timestamp))
    if not valid:
        return None

    status, item, crawled_at = max(valid, key=lambda entry: entry[2])
    if status == 'error':
        return None

    current_time = datetime.now(UTC) if now is None else now
    freshness_days = success_freshness_days if status == 'success' else blocked_freshness_days
    age = current_time - crawled_at
    if not timedelta(0) <= age < timedelta(days=freshness_days):
        return None
    if status == 'success' and item.get('analysis_status') != 'complete':
        return None

    crawled_at_value = item.get('crawled_at')
    if not isinstance(crawled_at_value, str):
        return None

    cached: CachedCrawl = {
        'status': status,
        'crawled_at': crawled_at_value,
    }
    block_reason = item.get('block_reason')
    if status == 'blocked' and isinstance(block_reason, str) and block_reason:
        cached['block_reason'] = block_reason
    return cached
