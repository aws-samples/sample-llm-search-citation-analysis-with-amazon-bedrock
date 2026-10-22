"""
Get Stats API Lambda

Returns overall dashboard statistics.

Counts finish inside the request by design (``shared.bounded_counts``): a
``Select='COUNT'`` read still reads every item, so a table larger than
``EXACT_COUNT_MAX_BYTES`` reports ``DescribeTable``'s ``ItemCount``
(refreshed by DynamoDB about every six hours) instead of being scanned, and a
count the ``COUNT_TIME_BUDGET_SECONDS`` budget cuts short is estimated.
``counts_approximate`` tells the reader when any total is such an estimate.
The four counts run in parallel and are cached for five minutes per
container.

With ``market_id`` (one market id, or ``global`` for the keywords without
one) every total counts only that market's keywords: the Keywords rows the
market carries (any status, like the unfiltered count), and the SearchResults,
Citations and CrawledContent rows of those keyword texts. A row whose keyword
text no Keywords row carries any more (a deleted keyword) belongs to no
market, so it is in the unfiltered totals only. ``last_execution`` is the
newest run of the market's keywords (any provider) with ``market_id``, and
the newest run across every market (of ``provider``, when given) without.
"""

import concurrent.futures
import logging
import sys
import threading
import time
from collections.abc import Callable

from botocore.exceptions import BotoCoreError, ClientError

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared import answer_queries, bounded_counts, dynamodb_batch, markets, scope_params
from shared.api_response import success_response, validation_error
from shared.bounded_counts import Count, Deadline
from shared.config import PROVIDERS
from shared.decorators import api_handler, optional_provider, validate
from shared.env_vars import resolve_table_env
from shared.search_results import search_results_table_name
from shared.utils import get_timestamp

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Enough pooled connections for the parallel partition counts of a market.
dynamodb = scope_params.scoped_dynamodb_resource()

# Fail-fast: Required environment variables (audit #12 canonical naming).
SEARCH_RESULTS_TABLE = search_results_table_name()
CITATIONS_TABLE = resolve_table_env('DYNAMODB_TABLE_CITATIONS')
CRAWLED_CONTENT_TABLE = resolve_table_env('DYNAMODB_TABLE_CRAWLED_CONTENT')
KEYWORDS_TABLE = resolve_table_env('DYNAMODB_TABLE_KEYWORDS')

search_results_table = dynamodb.Table(SEARCH_RESULTS_TABLE)
citations_table = dynamodb.Table(CITATIONS_TABLE)
crawled_table = dynamodb.Table(CRAWLED_CONTENT_TABLE)
keywords_table = dynamodb.Table(KEYWORDS_TABLE)

# Cache for table item counts and last executions, per container.
_count_cache = {}
_count_cache_ttl = 300  # 5 minutes

MARKET_PARAM = scope_params.MARKET_PARAM

# A total that could not be read and was never cached: shown as 0, flagged as not exact.
_UNKNOWN_COUNT = Count(0, approximate=True)


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


def _cached_count(cache_key: str, label: str, count: Callable[[], Count]) -> Count:
    """``count()``, reused for five minutes; on a read failure the last cached value (or an unknown 0)."""
    return _cached_value(cache_key, label, count, _UNKNOWN_COUNT)


def _get_table_item_count(table, cache_key: str, deadline: Deadline | None = None) -> Count:
    """The table's item count: exact for a small table, ``DescribeTable``'s estimate for a large one."""
    budget = deadline or Deadline(bounded_counts.COUNT_TIME_BUDGET_SECONDS)
    return _cached_count(cache_key, table.table_name, lambda: bounded_counts.table_count(table, budget))


def _in_parallel(counters: dict[str, Callable[[], Count]]) -> dict[str, Count]:
    """Every counter's result, all run at once, keyed like ``counters``."""
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(counters)) as pool:
        futures = {total: pool.submit(counter) for total, counter in counters.items()}
        return {total: future.result() for total, future in futures.items()}


def _read_once[ValueT](read: Callable[[], ValueT]) -> Callable[[], ValueT]:
    """``read``, called at most once successfully even when several threads ask for it at the same time."""
    lock = threading.Lock()
    results: list[ValueT] = []

    def once() -> ValueT:
        with lock:
            if not results:
                results.append(read())
            return results[0]

    return once


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


def _market_counts(market_keywords: Callable[[], set[str]], market_id: str, deadline: Deadline) -> dict[str, Count]:
    """Every total of the response, counting only ``market_id``'s keywords (cached per market).

    ``market_keywords`` reads the market's keywords at most once per request,
    and only when something is not cached; each total then counts its
    table's partitions of them, in parallel, until ``deadline``.
    """
    def rows_of(table, index_name: str | None = None) -> Callable[[], Count]:
        return lambda: bounded_counts.partition_count(table, 'keyword', market_keywords(), deadline, index_name=index_name)

    counters: dict[str, tuple[str, Callable[[], Count]]] = {
        'total_searches': (SEARCH_RESULTS_TABLE, rows_of(search_results_table)),
        'total_citations': (CITATIONS_TABLE, rows_of(citations_table)),
        'total_crawled': (CRAWLED_CONTENT_TABLE, rows_of(crawled_table, 'KeywordIndex')),
        'unique_keywords': (KEYWORDS_TABLE, lambda: Count(len(market_keywords()))),
    }
    return _in_parallel({
        total: (lambda total=total, label=label, count=count: _cached_count(f'{total}#market#{market_id}', label, count))
        for total, (label, count) in counters.items()
    })


def _all_counts(deadline: Deadline) -> dict[str, Count]:
    tables = {
        'total_searches': (search_results_table, 'search_results'),
        'total_citations': (citations_table, 'citations'),
        'total_crawled': (crawled_table, 'crawled'),
        'unique_keywords': (keywords_table, 'keywords'),
    }
    return _in_parallel({
        total: (lambda table=table, key=key: _get_table_item_count(table, key, deadline))
        for total, (table, key) in tables.items()
    })


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
    # Any provider has a last run, so the filter takes the search providers too (unlike answer-based endpoints).
    'provider': {**optional_provider(), 'choices': PROVIDERS},
    MARKET_PARAM: scope_params.SCOPE_QUERY_PARAMS[MARKET_PARAM],
})
def handler(event, context, provider=None, market_id=None):
    """
    GET /api/stats

    Query params (all optional):
        - provider: Filter stats by provider
        - market_id: Count only one market's keywords (a market id, or ``global``); ``last_execution``
          is then the newest run of those keywords (any provider)

    ``counts_approximate`` is true when any total is an estimate (a large
    table's ``DescribeTable`` count, or a count the time budget cut short).
    """
    market, market_error = scope_params.market_param({MARKET_PARAM: market_id})
    if market_error:
        return validation_error(market_error, event, MARKET_PARAM)

    deadline = Deadline(bounded_counts.COUNT_TIME_BUDGET_SECONDS)
    if market is None:
        counts = _all_counts(deadline)
        last_execution = _latest_provider_execution(provider)
    else:
        market_keywords = _read_once(lambda: _market_keyword_texts(market))
        counts = _market_counts(market_keywords, market, deadline)
        last_execution = _market_last_execution(market_keywords, market)

    return success_response({
        **{total: count.value for total, count in counts.items()},
        'counts_approximate': any(count.approximate for count in counts.values()),
        'last_execution': last_execution,
        'timestamp': get_timestamp(),
        **({} if market is None else {MARKET_PARAM: market}),
    }, event)
