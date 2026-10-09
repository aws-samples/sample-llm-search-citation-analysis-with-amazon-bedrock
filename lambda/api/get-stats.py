"""
Get Stats API Lambda

Returns overall dashboard statistics.
Uses efficient query operations with GSIs instead of full table scans.
Counts are cached in a metadata item to avoid expensive scan operations.

With ``market_id`` (one market id, or ``global`` for the keywords without
one) every total counts only that market's keywords: the Keywords rows the
market carries (any status, like the unfiltered count), and the SearchResults,
Citations and CrawledContent rows of those keyword texts. A row whose keyword
text no Keywords row carries any more (a deleted keyword) belongs to no
market, so it is in the unfiltered totals only. ``last_execution`` is the
newest run of the market's keywords (any provider) with ``market_id``, and
the newest run across every market (of ``provider``, when given) without.
"""

import functools
import logging
import sys
import time
from collections.abc import Callable

import boto3
from botocore.exceptions import BotoCoreError, ClientError

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared import answer_queries, dynamodb_batch, markets, scope_params
from shared.api_response import success_response, validation_error
from shared.config import PROVIDERS
from shared.decorators import api_handler, optional_provider, validate
from shared.env_vars import resolve_table_env
from shared.utils import get_timestamp

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables (audit #12 canonical naming).
SEARCH_RESULTS_TABLE = resolve_table_env('DYNAMODB_TABLE_SEARCH_RESULTS')
CITATIONS_TABLE = resolve_table_env('DYNAMODB_TABLE_CITATIONS')
CRAWLED_CONTENT_TABLE = resolve_table_env('DYNAMODB_TABLE_CRAWLED_CONTENT')
KEYWORDS_TABLE = resolve_table_env('DYNAMODB_TABLE_KEYWORDS')

search_results_table = dynamodb.Table(SEARCH_RESULTS_TABLE)
citations_table = dynamodb.Table(CITATIONS_TABLE)
crawled_table = dynamodb.Table(CRAWLED_CONTENT_TABLE)
keywords_table = dynamodb.Table(KEYWORDS_TABLE)

# Cache for table item counts (refreshed periodically via describe_table)
_count_cache = {}
_count_cache_ttl = 300  # 5 minutes

MARKET_PARAM = scope_params.MARKET_PARAM


def _cached_value[ValueT](cache_key: str, label: str, read: Callable[[], ValueT], fallback: ValueT) -> ValueT:
    """``read()``, reused for five minutes; on a read failure the last cached value (or ``fallback``)."""
    now = time.time()
    cached = _count_cache.get(cache_key)

    if cached and (now - cached['timestamp']) < _count_cache_ttl:
        return cached['count']

    try:
        value = read()
    except (BotoCoreError, ClientError) as e:
        logger.warning('Failed to read %s: %s', label, e)
        return cached['count'] if cached else fallback

    _count_cache[cache_key] = {'count': value, 'timestamp': now}
    return value


def _cached_count(cache_key: str, label: str, count: Callable[[], int]) -> int:
    """``count()``, reused for five minutes; on a read failure the last cached value (or 0)."""
    return _cached_value(cache_key, label, count, 0)


def _get_table_item_count(table, cache_key: str) -> int:
    """Get item count using scan with COUNT select for accuracy."""
    return _cached_count(cache_key, table.table_name, lambda: dynamodb_batch.count_all_items(table.scan))


def _market_keyword_texts(market_id: str) -> set[str]:
    """The keyword texts of every Keywords row (any status) of ``market_id``."""
    items = dynamodb_batch.collect_all_items(
        keywords_table.scan,
        ProjectionExpression='#kw, market_id',
        ExpressionAttributeNames={'#kw': 'keyword'},
    )
    return {
        item['keyword'] for item in items
        if isinstance(item.get('keyword'), str) and item['keyword'] and markets.keyword_market_id(item) == market_id
    }


def _market_counts(market_keywords: Callable[[], set[str]], market_id: str) -> dict[str, int]:
    """Every total of the response, counting only ``market_id``'s keywords (cached per market).

    ``market_keywords`` reads the market's keywords at most once per request,
    and only when something is not cached; each total then counts its
    table's partitions of them.
    """
    def rows_of(table, index_name: str | None = None) -> Callable[[], int]:
        return lambda: dynamodb_batch.count_partition_items(table, 'keyword', market_keywords(), index_name=index_name)

    counters: dict[str, tuple[str, Callable[[], int]]] = {
        'total_searches': (SEARCH_RESULTS_TABLE, rows_of(search_results_table)),
        'total_citations': (CITATIONS_TABLE, rows_of(citations_table)),
        'total_crawled': (CRAWLED_CONTENT_TABLE, rows_of(crawled_table, 'KeywordIndex')),
        'unique_keywords': (KEYWORDS_TABLE, lambda: len(market_keywords())),
    }
    return {
        total: _cached_count(f'{total}#market#{market_id}', label, count)
        for total, (label, count) in counters.items()
    }


def _all_counts() -> dict[str, int]:
    return {
        'total_searches': _get_table_item_count(search_results_table, 'search_results'),
        'total_citations': _get_table_item_count(citations_table, 'citations'),
        'total_crawled': _get_table_item_count(crawled_table, 'crawled'),
        'unique_keywords': _get_table_item_count(keywords_table, 'keywords'),
    }


def _market_last_execution(market_keywords: Callable[[], set[str]], market_id: str) -> str | None:
    """The newest run of any of the market's keywords (one ``Limit=1`` read per keyword, in parallel; cached per market)."""
    def newest() -> str | None:
        timestamps = scope_params.map_scope_keywords(
            sorted(market_keywords()),
            lambda keyword: answer_queries.latest_run_timestamp(search_results_table, keyword),
            lambda _keyword: None,
        )
        return max((stamp for stamp in timestamps if stamp), default=None)

    return _cached_value(f'last_execution#market#{market_id}', SEARCH_RESULTS_TABLE, newest, None)


def _latest_provider_execution(provider: str | None) -> str | None:
    """The newest run of ``provider`` (every provider without one), read from the ProviderIndex GSI."""
    providers = [provider] if provider else PROVIDERS
    timestamps = []

    for p in providers:
        try:
            response = search_results_table.query(
                IndexName='ProviderIndex',
                KeyConditionExpression='provider = :provider',
                ExpressionAttributeValues={':provider': p},
                ProjectionExpression='#ts',
                ExpressionAttributeNames={'#ts': 'timestamp'},
                ScanIndexForward=False,
                Limit=1
            )
            items = response.get('Items', [])
            if items:
                timestamps.append(items[0].get('timestamp', ''))
        except (BotoCoreError, ClientError) as e:
            logger.debug('No data for provider %s: %s', p, e)
            continue

    return max(timestamps) if timestamps else None


@api_handler
@validate({
    'provider': optional_provider(),
    MARKET_PARAM: scope_params.SCOPE_QUERY_PARAMS[MARKET_PARAM],
})
def handler(event, context, provider=None, market_id=None):
    """
    GET /api/stats

    Query params (all optional):
        - provider: Filter stats by provider
        - market_id: Count only one market's keywords (a market id, or ``global``); ``last_execution``
          is then the newest run of those keywords (any provider)
    """
    market, market_error = scope_params.market_param({MARKET_PARAM: market_id})
    if market_error:
        return validation_error(market_error, event, MARKET_PARAM)

    if market is None:
        counts = _all_counts()
        last_execution = _latest_provider_execution(provider)
    else:
        market_keywords = functools.cache(lambda: _market_keyword_texts(market))
        counts = _market_counts(market_keywords, market)
        last_execution = _market_last_execution(market_keywords, market)

    return success_response({
        **counts,
        'last_execution': last_execution,
        'timestamp': get_timestamp(),
        **({} if market is None else {MARKET_PARAM: market}),
    }, event)
