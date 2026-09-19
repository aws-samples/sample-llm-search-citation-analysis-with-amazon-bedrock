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


# A row's stored verdict; 'error' rows only exist to hide older successes.
_Verdict = Literal['success', 'blocked', 'error']
_Candidate = tuple[_Verdict, Mapping[str, object]]


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


def _keyword_candidate(
    table: Any,
    index_name: str,
    normalized_url: str,
    keyword: str,
) -> _Candidate | None:
    """Return the newest keyword-scoped row when it carries a success or error verdict."""
    row = _query_latest_scope(table, index_name, success_cache_scope(normalized_url, keyword))
    if row is None:
        return None
    status = row.get('cache_status')
    if status in ('success', 'error'):
        return status, row
    return None


def _blocked_candidate(table: Any, index_name: str, normalized_url: str) -> _Candidate | None:
    """Return the newest URL-scoped row when it carries a blocked verdict."""
    row = _query_latest_scope(table, index_name, blocked_cache_scope(normalized_url))
    if row is not None and row.get('cache_status') == 'blocked':
        return 'blocked', row
    return None


def _load_candidates(
    table: Any,
    index_name: str,
    normalized_url: str,
    keyword: str,
    *,
    success_freshness_days: int,
    blocked_freshness_days: int,
) -> list[_Candidate]:
    """Query each scope whose freshness window is open and keep the rows worth comparing."""
    candidates: list[_Candidate] = []
    if success_freshness_days > 0:
        keyword_candidate = _keyword_candidate(table, index_name, normalized_url, keyword)
        if keyword_candidate is not None:
            candidates.append(keyword_candidate)
    if blocked_freshness_days > 0:
        blocked_candidate = _blocked_candidate(table, index_name, normalized_url)
        if blocked_candidate is not None:
            candidates.append(blocked_candidate)
    return candidates


def _read_candidates(
    table: Any,
    index_name: str,
    normalized_url: str,
    keyword: str,
    *,
    success_freshness_days: int,
    blocked_freshness_days: int,
) -> list[_Candidate]:
    """Load the candidate rows, degrading transient read failures to a cache miss.

    Permanent IAM/schema failures are re-raised as ``CrawlCacheConfigurationError``
    so a broken cache cannot silently multiply paid browser sessions.
    """
    try:
        return _load_candidates(
            table,
            index_name,
            normalized_url,
            keyword,
            success_freshness_days=success_freshness_days,
            blocked_freshness_days=blocked_freshness_days,
        )
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
        return []


def _newest_candidate(
    candidates: list[_Candidate],
) -> tuple[_Verdict, Mapping[str, object], datetime] | None:
    """Return the candidate with the latest valid timestamp, ignoring unparseable rows."""
    timestamped: list[tuple[_Verdict, Mapping[str, object], datetime]] = []
    for status, item in candidates:
        crawled_at = _parse_timestamp(item.get('crawled_at'))
        if crawled_at is not None:
            timestamped.append((status, item, crawled_at))
    return max(timestamped, key=lambda entry: entry[2], default=None)


def _within_freshness_window(crawled_at: datetime, freshness_days: int, now: datetime | None) -> bool:
    """A row is fresh when it is not from the future and younger than its window."""
    current_time = datetime.now(UTC) if now is None else now
    age = current_time - crawled_at
    return timedelta(0) <= age < timedelta(days=freshness_days)


def _cached_crawl(status: Literal['success', 'blocked'], item: Mapping[str, object]) -> CachedCrawl | None:
    """Project a fresh row onto the compact fields Step Functions consumes."""
    crawled_at = item.get('crawled_at')
    if not isinstance(crawled_at, str):
        return None
    cached: CachedCrawl = {
        'status': status,
        'crawled_at': crawled_at,
    }
    block_reason = item.get('block_reason')
    if status == 'blocked' and isinstance(block_reason, str) and block_reason:
        cached['block_reason'] = block_reason
    return cached


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

    newest = _newest_candidate(_read_candidates(
        table,
        index_name,
        normalized_url,
        keyword,
        success_freshness_days=success_freshness_days,
        blocked_freshness_days=blocked_freshness_days,
    ))
    if newest is None:
        return None

    status, item, crawled_at = newest
    if status == 'error':
        return None
    freshness_days = success_freshness_days if status == 'success' else blocked_freshness_days
    if not _within_freshness_window(crawled_at, freshness_days, now):
        return None
    if status == 'success' and item.get('analysis_status') != 'complete':
        return None
    return _cached_crawl(status, item)
