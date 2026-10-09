"""
Characterization tests for get-stats.py (GET /api/stats).

The handler had no tests. These pin the count-only scans behind each total and
their five-minute cache, the ``ProviderIndex`` reads that find the newest run
per provider, the ``provider`` filter, and the response shape; and the
``market_id`` filter, whose totals count only one market's keyword partitions
and are cached per market.

Every table is a ``MagicMock`` from ``testing.dynamodb_stubs``, swapped in for
the module-level tables the handler opened at import; the count cache is
emptied per test so one test's totals cannot leak into the next.
"""

from __future__ import annotations

import os
import time
from collections.abc import Mapping
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from shared.config import PROVIDERS
from testing.client_errors import throttled
from testing.dynamodb_stubs import fake_table
from testing.events import api_gateway_event, parse_response
from testing.handler_fixtures import handler_fixture
from testing.markets_fixtures import BRAZIL, CHILE
from testing.search_results_fixtures import key_parts

stats_module = handler_fixture(
    os.path.dirname(__file__),
    'get-stats.py',
    'get_stats_under_test',
    env={
        'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-search-results',
        'DYNAMODB_TABLE_CITATIONS': 'test-citations',
        'DYNAMODB_TABLE_CRAWLED_CONTENT': 'test-crawled',
        'DYNAMODB_TABLE_KEYWORDS': 'test-keywords',
        'CORS_ORIGIN_PARAM': '',
    },
)

_OLDER = '2026-05-01T08:00:00Z'
_LATEST = '2026-05-02T08:00:00Z'
_STAMP = '2026-05-03T09:00:00Z'
_NO_ROWS: dict[str, Any] = {'Items': []}


def _newest(timestamp: str) -> dict[str, Any]:
    """The one-row ``ProviderIndex`` page carrying a provider's newest ``timestamp``."""
    return {'Items': [{'timestamp': timestamp}]}


def _search_table(count: int, answers: Mapping[str, Any] | None = None) -> MagicMock:
    """A SearchResults table of ``count`` rows whose ``ProviderIndex`` answers ``answers`` per provider.

    ``answers`` maps a provider to its query response, or to an exception to
    raise; providers left out have no rows. Queries arrive in ``PROVIDERS`` order.
    """
    table = fake_table(scan={'Count': count})
    table.query.side_effect = [(answers or {}).get(provider, _NO_ROWS) for provider in PROVIDERS]
    return table


def _tables(search: MagicMock | None = None, citations: int = 0, crawled: int = 0, keywords: int = 0) -> dict[str, MagicMock]:
    """Every table the handler opened at import, keyed by module attribute: ``search`` plus count-only stubs."""
    return {
        'search_results_table': _search_table(0) if search is None else search,
        'citations_table': fake_table(scan={'Count': citations}),
        'crawled_table': fake_table(scan={'Count': crawled}),
        'keywords_table': fake_table(scan={'Count': keywords}),
    }


def _get_stats(module: Any, tables: Mapping[str, MagicMock], query: Mapping[str, str] | None = None) -> tuple[int, Any]:
    """GET /api/stats over ``tables`` with an empty count cache: ``(status, decoded body)``."""
    with patch.multiple(module, _count_cache={}, **tables), patch.object(module, 'get_timestamp', return_value=_STAMP):
        return parse_response(module.handler(api_gateway_event('GET', '/api/stats', query=query), None))


class TestResponse:
    def test_reports_every_tables_count_the_newest_run_and_the_response_time(self, stats_module):
        tables = _tables(_search_table(12, {'openai': _newest(_LATEST)}), citations=7, crawled=3, keywords=5)

        status, body = _get_stats(stats_module, tables)

        assert (status, body) == (200, {
            'total_searches': 12,
            'total_citations': 7,
            'total_crawled': 3,
            'unique_keywords': 5,
            'last_execution': _LATEST,
            'timestamp': _STAMP,
        })

    def test_reports_no_last_execution_when_no_provider_has_rows(self, stats_module):
        _, body = _get_stats(stats_module, _tables())

        assert body['last_execution'] is None

    def test_rejects_an_unknown_provider_with_400_before_reading(self, stats_module):
        tables = _tables()

        status, body = _get_stats(stats_module, tables, {'provider': 'bing'})

        assert (status, body) == (400, {
            'error': 'Invalid provider. Must be one of: openai, perplexity, gemini, claude', 'field': 'provider',
        })
        tables['search_results_table'].scan.assert_not_called()


class TestTableCounts:
    def test_counts_each_table_with_a_count_only_scan(self, stats_module):
        tables = _tables()

        _get_stats(stats_module, tables)

        for table in tables.values():
            table.scan.assert_called_once_with(Select='COUNT')

    def test_sums_the_counts_of_every_scan_page(self, stats_module):
        table = fake_table()
        table.scan.side_effect = [{'Count': 2, 'LastEvaluatedKey': {'id': 'k-2'}}, {'Count': 3}]

        _, body = _get_stats(stats_module, _tables() | {'keywords_table': table})

        assert body['unique_keywords'] == 5
        assert table.scan.call_args_list[1].kwargs == {'Select': 'COUNT', 'ExclusiveStartKey': {'id': 'k-2'}}

    def test_reports_zero_when_the_scan_fails_with_nothing_cached(self, stats_module):
        table = fake_table()
        table.scan.side_effect = throttled('Scan')

        status, body = _get_stats(stats_module, _tables() | {'citations_table': table})

        assert (status, body['total_citations']) == (200, 0)


def _count_past_an_expired_cache(module: Any, table: MagicMock, *, cached_count: int) -> int:
    """``_get_table_item_count`` of ``table`` while its cached ``cached_count`` is past the five-minute TTL."""
    expired = time.time() - module._count_cache_ttl - 1
    with patch.object(module, '_count_cache', {'search_results': {'count': cached_count, 'timestamp': expired}}):
        return module._get_table_item_count(table, 'search_results')


class TestCountCache:
    def test_reuses_a_count_read_less_than_five_minutes_ago(self, stats_module):
        table = fake_table(scan={'Count': 12})

        with patch.object(stats_module, '_count_cache', {}):
            counts = [stats_module._get_table_item_count(table, 'search_results') for _ in range(2)]

        assert counts == [12, 12]
        table.scan.assert_called_once_with(Select='COUNT')

    def test_rereads_a_count_cached_more_than_five_minutes_ago(self, stats_module):
        table = fake_table(scan={'Count': 12})

        count = _count_past_an_expired_cache(stats_module, table, cached_count=1)

        assert count == 12
        table.scan.assert_called_once_with(Select='COUNT')

    def test_falls_back_to_the_expired_count_when_the_scan_fails(self, stats_module):
        table = fake_table()
        table.scan.side_effect = throttled('Scan')

        assert _count_past_an_expired_cache(stats_module, table, cached_count=9) == 9


class TestLastExecution:
    def test_reads_the_newest_row_of_each_provider_from_the_provider_index(self, stats_module):
        search = _search_table(0)

        _get_stats(stats_module, _tables(search))

        assert [call.kwargs['ExpressionAttributeValues'] for call in search.query.call_args_list] == [
            {':provider': provider} for provider in PROVIDERS
        ]
        assert search.query.call_args_list[0].kwargs == {
            'IndexName': 'ProviderIndex',
            'KeyConditionExpression': 'provider = :provider',
            'ExpressionAttributeValues': {':provider': 'openai'},
            'ProjectionExpression': '#ts',
            'ExpressionAttributeNames': {'#ts': 'timestamp'},
            'ScanIndexForward': False,
            'Limit': 1,
        }

    def test_reports_the_newest_timestamp_across_providers(self, stats_module):
        search = _search_table(0, {'openai': _newest(_OLDER), 'gemini': _newest(_LATEST)})

        _, body = _get_stats(stats_module, _tables(search))

        assert body['last_execution'] == _LATEST

    def test_reads_only_the_requested_provider_when_one_is_given(self, stats_module):
        search = _search_table(0)
        search.query.side_effect = [_newest(_LATEST)]

        _, body = _get_stats(stats_module, _tables(search), {'provider': 'gemini'})

        assert [call.kwargs['ExpressionAttributeValues'] for call in search.query.call_args_list] == [{':provider': 'gemini'}]
        assert body['last_execution'] == _LATEST

    def test_ignores_a_provider_whose_query_fails(self, stats_module):
        search = _search_table(0, {'openai': throttled('Query'), 'gemini': _newest(_LATEST)})

        status, body = _get_stats(stats_module, _tables(search))

        assert (status, body['last_execution']) == (200, _LATEST)


# --- market_id: totals of one market's keywords ---------------------------------

_CHILE_ID = CHILE['market_id']
_BRAZIL_ID = BRAZIL['market_id']
_KEYWORD_ROWS = [
    {'keyword': 'vuelos santiago altiplano air', 'market_id': _CHILE_ID},
    {'keyword': 'altiplano air equipaje', 'market_id': _CHILE_ID},
    {'keyword': 'voos altiplano air sao paulo', 'market_id': _BRAZIL_ID},
    {'keyword': 'altiplano air baggage'},
    {'keyword': 'altiplano air lounge', 'market_id': ''},
]
"""Two Chilean keywords, one Brazilian and two global ones (no ``market_id``, or an empty one)."""

_SEARCHES = {'vuelos santiago altiplano air': 4, 'altiplano air equipaje': 2, 'voos altiplano air sao paulo': 8,
             'altiplano air baggage': 16, 'altiplano air lounge': 32}
_CITATIONS = {'vuelos santiago altiplano air': 3, 'altiplano air equipaje': 1, 'altiplano air baggage': 5}
_CRAWLED = {'vuelos santiago altiplano air': 2, 'voos altiplano air sao paulo': 7, 'altiplano air lounge': 1}


def _partition_counts(
    counts: Mapping[str, int], newest: Mapping[str, Any] | None = None, latest_runs: Mapping[str, str] | None = None,
) -> MagicMock:
    """A table whose ``query`` with ``Select='COUNT'`` answers ``counts[keyword]`` rows per keyword partition.

    ``ProviderIndex`` queries (the newest run per provider) answer ``newest[provider]``, or no rows; a
    keyword's newest-row read (``Limit=1``) answers ``latest_runs[keyword]``, or no rows.
    """
    def query(**kwargs: Any) -> Mapping[str, Any]:
        if kwargs.get('IndexName') == 'ProviderIndex':
            return (newest or {}).get(kwargs['ExpressionAttributeValues'][':provider'], _NO_ROWS)
        keyword = key_parts(kwargs['KeyConditionExpression'])[0]
        if kwargs.get('Select') == 'COUNT':
            return {'Count': counts.get(keyword, 0)}
        stamp = (latest_runs or {}).get(keyword)
        return {'Items': [{'timestamp': stamp}]} if stamp else _NO_ROWS

    table = fake_table()
    table.query.side_effect = query
    return table


# The newest run of each keyword: Chile's latest is older than Brazil's, and both are older than _LATEST.
_CHILE_RUN = '2026-10-01T08:00:00.000000Z'
_LATEST_RUNS = {
    'vuelos santiago altiplano air': _CHILE_RUN,
    'altiplano air equipaje': '2026-09-20T08:00:00.000000Z',
    'voos altiplano air sao paulo': '2026-10-03T08:00:00.000000Z',
}


def _market_tables(keyword_rows: list[dict[str, Any]] | None = None) -> dict[str, MagicMock]:
    """Every table with the market fixtures: Keywords answers ``keyword_rows`` to its scan, the rest count per keyword."""
    return {
        'search_results_table': _partition_counts(_SEARCHES, {'gemini': _newest(_LATEST)}, _LATEST_RUNS),
        'citations_table': _partition_counts(_CITATIONS),
        'crawled_table': _partition_counts(_CRAWLED),
        'keywords_table': fake_table(scan={'Items': _KEYWORD_ROWS if keyword_rows is None else keyword_rows}),
    }


def _get_market_stats(module: Any, tables: Mapping[str, MagicMock], *market_ids: str) -> list[tuple[int, Any]]:
    """GET /api/stats?market_id=<id> once per id, sharing one count cache that starts empty."""
    with patch.multiple(module, _count_cache={}, **tables), patch.object(module, 'get_timestamp', return_value=_STAMP):
        return [
            parse_response(module.handler(api_gateway_event('GET', '/api/stats', query={'market_id': market_id}), None))
            for market_id in market_ids
        ]


def _counted_keywords(table: MagicMock) -> list[str]:
    """The keyword partitions ``table`` was asked to count, sorted."""
    return sorted(
        key_parts(call.kwargs['KeyConditionExpression'])[0]
        for call in table.query.call_args_list if call.kwargs.get('Select') == 'COUNT'
    )


class TestMarketTotals:
    def test_counts_only_the_rows_of_the_markets_keywords_and_echoes_the_market(self, stats_module):
        [(status, body)] = _get_market_stats(stats_module, _market_tables(), _CHILE_ID)

        assert (status, body) == (200, {
            'total_searches': 6,
            'total_citations': 4,
            'total_crawled': 2,
            'unique_keywords': 2,
            'last_execution': _CHILE_RUN,
            'timestamp': _STAMP,
            'market_id': _CHILE_ID,
        })

    def test_global_counts_the_keywords_without_a_market_or_with_an_empty_one(self, stats_module):
        [(_, body)] = _get_market_stats(stats_module, _market_tables(), 'global')

        assert [body[total] for total in ('total_searches', 'total_citations', 'total_crawled', 'unique_keywords')] == [48, 5, 1, 2]

    def test_counts_the_keywords_of_every_status(self, stats_module):
        rows = [
            {'keyword': 'altiplano air equipaje', 'market_id': _CHILE_ID, 'status': 'paused'},
            {'keyword': 'vuelos santiago altiplano air', 'market_id': _CHILE_ID, 'status': 'inactive'},
        ]

        [(_, body)] = _get_market_stats(stats_module, _market_tables(rows), _CHILE_ID)

        assert (body['unique_keywords'], body['total_searches']) == (2, 6)

    def test_counts_each_keyword_partition_of_searches_and_citations_once(self, stats_module):
        tables = _market_tables()

        _get_market_stats(stats_module, tables, _CHILE_ID)

        expected = ['altiplano air equipaje', 'vuelos santiago altiplano air']
        assert (_counted_keywords(tables['search_results_table']), _counted_keywords(tables['citations_table'])) == (expected, expected)

    def test_counts_crawled_pages_through_the_keyword_index(self, stats_module):
        tables = _market_tables()

        _get_market_stats(stats_module, tables, _BRAZIL_ID)

        [crawl_count] = tables['crawled_table'].query.call_args_list
        assert (crawl_count.kwargs['IndexName'], crawl_count.kwargs['Select']) == ('KeywordIndex', 'COUNT')
        assert key_parts(crawl_count.kwargs['KeyConditionExpression'])[0] == 'voos altiplano air sao paulo'

    def test_reads_the_keywords_with_a_projected_scan_instead_of_a_count(self, stats_module):
        tables = _market_tables()

        _get_market_stats(stats_module, tables, _CHILE_ID)

        tables['keywords_table'].scan.assert_called_once_with(
            ProjectionExpression='#kw, market_id', ExpressionAttributeNames={'#kw': 'keyword'},
        )

    def test_sums_every_page_of_a_partition_count(self, stats_module):
        citations = fake_table()
        citations.query.side_effect = [{'Count': 2, 'LastEvaluatedKey': {'keyword': 'k'}}, {'Count': 3}]
        tables = _market_tables([{'keyword': 'altiplano air equipaje', 'market_id': _CHILE_ID}]) | {'citations_table': citations}

        [(_, body)] = _get_market_stats(stats_module, tables, _CHILE_ID)

        assert body['total_citations'] == 5
        assert citations.query.call_args_list[1].kwargs['ExclusiveStartKey'] == {'keyword': 'k'}

    def test_reports_zero_totals_without_partition_reads_for_a_market_no_keyword_carries(self, stats_module):
        tables = _market_tables()

        [(status, body)] = _get_market_stats(stats_module, tables, 'fr-fr')

        assert (status, body['total_searches'], body['unique_keywords']) == (200, 0, 0)
        assert _counted_keywords(tables['search_results_table']) == []

    def test_reports_zero_when_the_keyword_scan_fails_with_nothing_cached(self, stats_module):
        tables = _market_tables()
        tables['keywords_table'].scan.side_effect = throttled('Scan')

        [(status, body)] = _get_market_stats(stats_module, tables, _CHILE_ID)

        assert (status, body['total_searches'], body['unique_keywords']) == (200, 0, 0)

    @pytest.mark.parametrize(('market_id', 'expected'), [
        (_BRAZIL_ID, '2026-10-03T08:00:00.000000Z'),
        ('global', None),
    ], ids=['the newest run of the markets keywords', 'none when its keywords never ran'])
    def test_reports_the_last_execution_of_the_market(self, stats_module, market_id, expected):
        responses = _get_market_stats(stats_module, _market_tables(), market_id)

        assert responses[0][1]['last_execution'] == expected


class TestMarketCountCache:
    def test_reuses_a_markets_counts_within_five_minutes(self, stats_module):
        tables = _market_tables()

        responses = _get_market_stats(stats_module, tables, _CHILE_ID, _CHILE_ID)

        assert [body['total_searches'] for _, body in responses] == [6, 6]
        tables['keywords_table'].scan.assert_called_once_with(
            ProjectionExpression='#kw, market_id', ExpressionAttributeNames={'#kw': 'keyword'},
        )

    def test_keeps_each_markets_counts_apart(self, stats_module):
        responses = _get_market_stats(stats_module, _market_tables(), _CHILE_ID, _BRAZIL_ID, 'global')

        assert [body['total_searches'] for _, body in responses] == [6, 8, 48]

    def test_keeps_a_markets_counts_apart_from_the_unfiltered_ones(self, stats_module):
        tables = _market_tables()
        tables['search_results_table'].scan.return_value = {'Count': 99}

        with patch.multiple(stats_module, _count_cache={}, **tables):
            stats_module.handler(api_gateway_event('GET', '/api/stats', query={'market_id': 'global'}), None)
            _, body = parse_response(stats_module.handler(api_gateway_event('GET', '/api/stats'), None))

        assert (body['total_searches'], 'market_id' in body) == (99, False)


class TestMarketValidation:
    @pytest.mark.parametrize('market_id', ['CL-ES', 'cl es', '-cl', 'x'])
    def test_rejects_a_malformed_market_id_with_400_before_reading(self, stats_module, market_id):
        tables = _market_tables()

        [(status, body)] = _get_market_stats(stats_module, tables, market_id)

        assert (status, body) == (400, {'error': "market_id must be a market id or 'global'", 'field': 'market_id'})
        tables['keywords_table'].scan.assert_not_called()

    def test_treats_a_blank_market_id_as_absent(self, stats_module):
        tables = _tables(keywords=5)

        _, body = _get_stats(stats_module, tables, {'market_id': '  '})

        assert (body['unique_keywords'], 'market_id' in body) == (5, False)
