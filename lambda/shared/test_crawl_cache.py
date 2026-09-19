"""Tests for persistent crawl freshness decisions."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError

from shared import crawl_cache
from shared.crawl_cache import (
    CrawlCacheConfigurationError,
    blocked_cache_scope,
    find_fresh_crawl,
    success_cache_scope,
)

_NOW = datetime(2026, 9, 19, 12, tzinfo=UTC)
_URL = 'https://example.com/article'
_KEYWORD = 'family hotels'
_INDEX = 'CacheScopeIndex'


class CacheReadError(Exception):
    """Transient cache failure injected by a test."""


def _timestamp(*, age: timedelta) -> str:
    return (_NOW - age).isoformat().replace('+00:00', 'Z')


def _cache_row(
    *,
    crawled_at: str | None = None,
    cache_status: str = 'success',
    analysis_status: str = 'complete',
    block_reason: str | None = None,
) -> dict[str, str]:
    row = {
        'crawled_at': crawled_at or _timestamp(age=timedelta(days=1)),
        'cache_status': cache_status,
        'analysis_status': analysis_status,
    }
    if block_reason is not None:
        row['block_reason'] = block_reason
    return row


def _table_with_scopes(
    *,
    success: dict[str, str] | None = None,
    blocked: dict[str, str] | None = None,
) -> MagicMock:
    table = MagicMock()
    table.query.side_effect = [
        {'Items': [] if success is None else [success]},
        {'Items': [] if blocked is None else [blocked]},
    ]
    return table


def _find(table: MagicMock, *, success_days: int = 30, blocked_days: int = 3):
    return find_fresh_crawl(
        table,
        _INDEX,
        _URL,
        _KEYWORD,
        success_freshness_days=success_days,
        blocked_freshness_days=blocked_days,
        now=_NOW,
    )


def test_returns_success_when_latest_keyword_scope_is_fresh_and_analysis_is_complete():
    row = _cache_row()

    result = _find(_table_with_scopes(success=row))

    assert result == {
        'status': 'success',
        'crawled_at': row['crawled_at'],
    }


def test_returns_blocked_when_latest_url_scope_is_fresh():
    row = _cache_row(cache_status='blocked', block_reason='captcha')

    result = _find(_table_with_scopes(blocked=row))

    assert result == {
        'status': 'blocked',
        'crawled_at': row['crawled_at'],
        'block_reason': 'captcha',
    }


def test_omits_block_reason_when_blocked_row_has_none():
    row = _cache_row(cache_status='blocked')

    result = _find(_table_with_scopes(blocked=row))

    assert result == {'status': 'blocked', 'crawled_at': row['crawled_at']}


def test_queries_only_url_scope_when_success_window_is_zero():
    row = _cache_row(cache_status='blocked', block_reason='captcha')
    table = MagicMock()
    table.query.return_value = {'Items': [row]}

    result = _find(table, success_days=0)

    assert result == {
        'status': 'blocked',
        'crawled_at': row['crawled_at'],
        'block_reason': 'captcha',
    }
    assert table.query.call_count == 1
    condition = table.query.call_args.kwargs['KeyConditionExpression']
    assert condition.get_expression()['values'][1] == blocked_cache_scope(_URL)


def test_returns_newer_keyword_success_when_older_url_block_also_exists():
    success = _cache_row(crawled_at=_timestamp(age=timedelta(hours=1)))
    blocked = _cache_row(
        crawled_at=_timestamp(age=timedelta(days=1)),
        cache_status='blocked',
        block_reason='captcha',
    )

    result = _find(_table_with_scopes(success=success, blocked=blocked))

    assert result == {
        'status': 'success',
        'crawled_at': success['crawled_at'],
    }


def test_returns_newer_url_block_when_older_keyword_success_also_exists():
    success = _cache_row(crawled_at=_timestamp(age=timedelta(days=1)))
    blocked = _cache_row(
        crawled_at=_timestamp(age=timedelta(hours=1)),
        cache_status='blocked',
        block_reason='access_denied',
    )

    result = _find(_table_with_scopes(success=success, blocked=blocked))

    assert result == {
        'status': 'blocked',
        'crawled_at': blocked['crawled_at'],
        'block_reason': 'access_denied',
    }


def test_returns_miss_when_success_analysis_is_incomplete():
    table = _table_with_scopes(success=_cache_row(analysis_status='failed'))

    assert _find(table) is None


def test_returns_miss_when_latest_keyword_scope_is_an_error():
    table = _table_with_scopes(success=_cache_row(cache_status='error'))

    assert _find(table) is None


def test_returns_miss_when_success_is_exactly_at_freshness_boundary():
    table = _table_with_scopes(
        success=_cache_row(crawled_at=_timestamp(age=timedelta(days=30)))
    )

    assert _find(table) is None


def test_returns_miss_when_latest_timestamp_is_in_the_future():
    future = (_NOW + timedelta(seconds=1)).isoformat()
    table = _table_with_scopes(success=_cache_row(crawled_at=future))

    assert _find(table) is None


def test_returns_miss_when_latest_timestamp_is_invalid():
    table = _table_with_scopes(success=_cache_row(crawled_at='not-a-timestamp'))

    assert _find(table) is None


def test_returns_miss_without_query_when_both_freshness_windows_are_zero():
    table = MagicMock()

    result = _find(table, success_days=0, blocked_days=0)

    assert result is None
    table.query.assert_not_called()


def test_returns_miss_and_emits_metric_when_transient_cache_read_fails(
    caplog,
    capsys,
    monkeypatch,
):
    table = MagicMock()
    table.query.side_effect = CacheReadError('DynamoDB unavailable')
    monkeypatch.setattr(crawl_cache.time, 'time', MagicMock(return_value=1_600_000_000.5))

    result = _find(table)

    assert result is None
    assert json.loads(capsys.readouterr().out) == {
        '_aws': {
            'Timestamp': 1_600_000_000_500,
            'CloudWatchMetrics': [{
                'Namespace': 'CitationAnalysis/Crawler',
                'Dimensions': [['ErrorCode']],
                'Metrics': [{
                    'Name': 'CrawlCacheReadFailure',
                    'Unit': 'Count',
                }],
            }],
        },
        'ErrorCode': 'CacheReadError',
        'CrawlCacheReadFailure': 1,
    }
    assert 'continuing with an uncached crawl (CacheReadError)' in caplog.text


def test_raises_configuration_error_when_cache_index_is_missing(capsys):
    table = MagicMock()
    table.query.side_effect = ClientError(
        {'Error': {'Code': 'ValidationException', 'Message': 'missing index'}},
        'Query',
    )

    with pytest.raises(
        CrawlCacheConfigurationError,
        match=r'Crawl cache configuration error \(ValidationException\)',
    ):
        _find(table)

    metric = json.loads(capsys.readouterr().out)
    assert metric['ErrorCode'] == 'ValidationException'


def test_queries_compact_index_scope_when_reading_success_cache():
    table = _table_with_scopes()

    _find(table)

    query = table.query.call_args_list[0].kwargs
    assert query['IndexName'] == _INDEX
    assert query['ScanIndexForward'] is False
    assert query['Limit'] == 1
    assert query['ProjectionExpression'] == '#crawled_at, #cache_status, #analysis_status, #block_reason'


def test_uses_distinct_success_scopes_when_keywords_differ():
    first = success_cache_scope(_URL, 'family hotels')
    second = success_cache_scope(_URL, 'business hotels')

    assert first != second
    assert first.startswith('success#')
    assert len(first) == 72


def test_uses_same_blocked_scope_when_keyword_context_differs():
    first = blocked_cache_scope(_URL)
    second = blocked_cache_scope(_URL)

    assert first == second
    assert first.startswith('blocked#')
    assert len(first) == 72
