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

A market's ``last_execution`` is read under the counts' time budget and at
the same time as them, so a market of thousands of keywords answers inside
the request: when the budget ends before every keyword's newest run is read
(or a read fails), ``last_execution`` is the newest of those read and
``last_execution_approximate`` is true. The market's keyword texts come from
a projected Keywords scan capped at ``MARKET_KEYWORD_SCAN_MAX_PAGES`` pages
and the request's deadline; a scan cut short makes every total approximate.
"""

import concurrent.futures
import logging
import sys
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from botocore.exceptions import BotoCoreError, ClientError

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared import (
    answer_queries,
    artifact_registry,
    bounded_counts,
    dynamodb_batch,
    markets,
    scope_params,
    scope_snapshot_serve,
    utils,
)
from shared.api_response import success_response, validation_error
from shared.artifact_stats import NAME as STATS_BUILDER_NAME
from shared.bounded_counts import Count, Deadline
from shared.config import PROVIDERS
from shared.decorators import api_handler, optional_provider, validate
from shared.env_vars import resolve_table_env
from shared.keyword_groups import describe_scope
from shared.kpi_scope_serve import keyword_count_route
from shared.search_results import search_results_table_name
from shared.snapshot_artifacts import (
    SOURCE_LIVE,
    SnapshotArtifacts,
    artifacts_envelope,
    coverage,
    live_envelope,
    with_scope_contract,
)
from shared.utils import get_timestamp

# Enough pooled connections for the parallel partition counts of a market.
dynamodb = scope_params.scoped_dynamodb_resource()

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

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

#: Pages of the projected Keywords scan read for one market's keyword texts.
#: A 1 MB page holds about 2,000 keyword rows, so 50 pages is ~100k keywords;
#: the request's deadline stops the scan sooner when DynamoDB is slow.
MARKET_KEYWORD_SCAN_MAX_PAGES = 50


@dataclass(frozen=True)
class MarketKeywords:
    """The keyword texts of one market, and whether the scan that found them read the whole table."""

    texts: frozenset[str]
    complete: bool = True
    active: frozenset[str] = frozenset()
    """The texts of the market's active keywords: the ones its scope snapshot covers."""


@dataclass(frozen=True)
class LastExecution:
    """The newest run found, and whether some keyword's newest run was not read (budget spent or a read failed)."""

    timestamp: str | None
    approximate: bool = False


# A last execution that could not be read and was never cached.
_UNKNOWN_LAST_EXECUTION = LastExecution(None, approximate=True)

# A market keyword list that could not be read and was never cached: every total from it is an estimate.
_UNREAD_KEYWORDS = MarketKeywords(frozenset(), complete=False)


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


def _market_keyword_texts(market_id: str) -> MarketKeywords:
    """The keyword texts of every Keywords row (any status) of ``market_id``, from a capped, projected scan."""
    items, truncated = dynamodb_batch.collect_capped_items(
        keywords_table.scan,
        MARKET_KEYWORD_SCAN_MAX_PAGES,
        ProjectionExpression='#kw, market_id, #st',
        ExpressionAttributeNames={'#kw': 'keyword', '#st': 'status'},
    )
    rows = [
        item for item in items
        if isinstance(item.get('keyword'), str) and item['keyword'] and markets.keyword_market_id(item) == market_id
    ]
    return MarketKeywords(
        frozenset(item['keyword'] for item in rows), complete=not truncated,
        active=frozenset(item['keyword'] for item in rows if item.get('status') == 'active'),
    )


def _counted(count: Count, keywords: MarketKeywords) -> Count:
    """``count``, flagged as an estimate when the market's keyword list itself was cut short."""
    return count if keywords.complete else Count(count.value, approximate=True)


def _market_counts(market_keywords: Callable[[], MarketKeywords], market_id: str, deadline: Deadline) -> dict[str, Count]:
    """Every total of the response, counting only ``market_id``'s keywords (cached per market).

    ``market_keywords`` reads the market's keywords at most once per request,
    and only when something is not cached; each total then counts its
    table's partitions of them, in parallel, until ``deadline``.
    """
    def rows_of(table, index_name: str | None = None) -> Callable[[], Count]:
        def count() -> Count:
            keywords = market_keywords()
            total = bounded_counts.partition_count(table, 'keyword', keywords.texts, deadline, index_name=index_name)
            return _counted(total, keywords)

        return count

    def keyword_total() -> Count:
        keywords = market_keywords()
        return _counted(Count(len(keywords.texts)), keywords)

    counters: dict[str, tuple[str, Callable[[], Count]]] = {
        'total_searches': (SEARCH_RESULTS_TABLE, rows_of(search_results_table)),
        'total_citations': (CITATIONS_TABLE, rows_of(citations_table)),
        'total_crawled': (CRAWLED_CONTENT_TABLE, rows_of(crawled_table, 'KeywordIndex')),
        'unique_keywords': (KEYWORDS_TABLE, keyword_total),
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


def _market_last_execution(
    market_keywords: Callable[[], MarketKeywords], market_id: str, deadline: Deadline,
) -> LastExecution:
    """The newest run of any of the market's keywords (one ``Limit=1`` read per keyword, in parallel; cached per market).

    A keyword not started before ``deadline`` is not read, nor is one whose
    read fails; either makes the answer approximate.
    """
    def newest_of(keyword: str) -> tuple[str | None, bool]:
        if deadline.stop_reading('the market last-execution lookup'):
            return None, False
        return answer_queries.latest_run_timestamp(search_results_table, keyword), True

    def newest() -> LastExecution:
        keywords = market_keywords()
        reads = scope_params.map_scope_keywords(sorted(keywords.texts), newest_of, lambda _keyword: (None, False))
        return LastExecution(
            max((stamp for stamp, _read in reads if stamp), default=None),
            approximate=not keywords.complete or not all(read for _stamp, read in reads),
        )

    return _cached_value(f'last_execution#market#{market_id}', SEARCH_RESULTS_TABLE, newest, _UNKNOWN_LAST_EXECUTION)


def _market_stats(market_id: str, deadline: Deadline, market_keywords: Callable[[], MarketKeywords] | None = None) -> tuple[dict[str, Count], LastExecution]:
    """The totals and the last execution of ``market_keywords`` (default: every keyword of the market), read at the same time under ``deadline``.

    ``market_id`` keys the per-container cache: pass another key for another keyword set.
    """
    market_keywords = market_keywords or _read_once(lambda: _market_keyword_texts(market_id))
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        last_execution = pool.submit(_market_last_execution, market_keywords, market_id, deadline)
        counts = _market_counts(market_keywords, market_id, deadline)
        return counts, last_execution.result()


@dataclass(frozen=True)
class MarketStats:
    """A market's totals and last execution, and the build they came from (``None``: read live)."""

    counts: dict[str, Count]
    last_execution: LastExecution
    artifacts: SnapshotArtifacts | None = None


def _snapshot_market_stats(market_id: str, every: Callable[[], MarketKeywords], deadline: Deadline) -> MarketStats | None:
    """A large market's totals from its scope snapshot (exact as of the build), or ``None`` to read them live.

    The build covers the market's active keywords; the keywords it does not
    (paused or deleted ones the Keywords table still carries) are counted
    live, so the totals cover every keyword of the market as the live path does.
    ``None`` for a market within the live budget, one whose keyword scan was
    cut short, or one no build holds totals for. The active keywords come from
    the same scan as the totals' keyword list, so no other read is made.
    """
    keywords = every()
    if not keywords.complete or keyword_count_route('all', len(keywords.active)) == SOURCE_LIVE:
        return None
    descriptor = {'mode': 'all', 'market_ids': [market_id]}
    scope = scope_params.ReportScope(
        kind='all', keywords=tuple(sorted(keywords.active, key=str.casefold)), scope=descriptor,
        label=describe_scope(descriptor), market_id=market_id,
    )
    artifacts = scope_snapshot_serve.open_snapshot(scope, utils.get_brand_config().get('updated_at'))
    stored = artifact_registry.serve_view(STATS_BUILDER_NAME, artifacts, {}) if artifacts is not None else None
    if artifacts is None or stored is None:
        return None
    active = frozenset(scope.keywords)
    rest = _read_once(lambda: MarketKeywords(every().texts - active, every().complete))
    counts, last = _market_stats(f'{market_id}#outside-snapshot', deadline, rest)
    totals = {name: Count(count.value + int(stored.get(name) or 0), count.approximate) for name, count in counts.items()}
    stamps = [stamp for stamp in (last.timestamp, stored.get('last_execution')) if stamp]
    return MarketStats(totals, LastExecution(max(stamps, default=None), last.approximate), artifacts)


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


def _stats_body(counts: dict[str, Count], last_execution: str | None, market_fields: dict[str, Any]) -> dict[str, Any]:
    return {
        **{total: count.value for total, count in counts.items()},
        'counts_approximate': any(count.approximate for count in counts.values()),
        'last_execution': last_execution,
        'timestamp': get_timestamp(),
        **market_fields,
    }


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
    With ``market_id``, ``last_execution_approximate`` is true when the time
    budget (or a failed read) left some keyword's newest run unread.
    """
    market, market_error = scope_params.market_param({MARKET_PARAM: market_id})
    if market_error:
        return validation_error(market_error, event, MARKET_PARAM)

    deadline = Deadline(bounded_counts.COUNT_TIME_BUDGET_SECONDS)
    if market is None:
        return success_response(_stats_body(_all_counts(deadline), _latest_provider_execution(provider), {}), event)
    every = _read_once(lambda: _cached_value(f'keywords#market#{market}', KEYWORDS_TABLE, lambda: _market_keyword_texts(market), _UNREAD_KEYWORDS))
    stats = _snapshot_market_stats(market, every, deadline) or MarketStats(*_market_stats(market, deadline, every))
    body = _stats_body(stats.counts, stats.last_execution.timestamp, {
        MARKET_PARAM: market, 'last_execution_approximate': stats.last_execution.approximate,
    })
    keywords = stats.counts['unique_keywords'].value
    envelope = live_envelope() if stats.artifacts is None else artifacts_envelope(stats.artifacts)
    return success_response(with_scope_contract(body, coverage(keywords, keywords), envelope), event)
