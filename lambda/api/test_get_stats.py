"""
Characterization tests for get-stats.py (GET /api/stats).

The handler had no tests. These pin the count-only scans behind each total and
their five-minute cache, the ``ProviderIndex`` reads that find the newest run
per provider, the ``provider`` filter, and the response shape.

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

from botocore.exceptions import ClientError

from shared.config import PROVIDERS
from testing.dynamodb_stubs import fake_table
from testing.events import api_gateway_event, parse_response
from testing.handler_fixtures import handler_fixture

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


def _throttled(operation: str) -> ClientError:
    return ClientError({'Error': {'Code': 'ProvisionedThroughputExceededException', 'Message': 'throttled'}}, operation)


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
        table.scan.side_effect = _throttled('Scan')

        status, body = _get_stats(stats_module, _tables() | {'citations_table': table})

        assert (status, body['total_citations']) == (200, 0)


class TestCountCache:
    def test_reuses_a_count_read_less_than_five_minutes_ago(self, stats_module):
        table = fake_table(scan={'Count': 12})

        with patch.object(stats_module, '_count_cache', {}):
            counts = [stats_module._get_table_item_count(table, 'search_results') for _ in range(2)]

        assert counts == [12, 12]
        table.scan.assert_called_once_with(Select='COUNT')

    def test_rereads_a_count_cached_more_than_five_minutes_ago(self, stats_module):
        table = fake_table(scan={'Count': 12})
        expired = time.time() - stats_module._count_cache_ttl - 1

        with patch.object(stats_module, '_count_cache', {'search_results': {'count': 1, 'timestamp': expired}}):
            count = stats_module._get_table_item_count(table, 'search_results')

        assert count == 12
        table.scan.assert_called_once_with(Select='COUNT')

    def test_falls_back_to_the_expired_count_when_the_scan_fails(self, stats_module):
        table = fake_table()
        table.scan.side_effect = _throttled('Scan')
        expired = time.time() - stats_module._count_cache_ttl - 1

        with patch.object(stats_module, '_count_cache', {'search_results': {'count': 9, 'timestamp': expired}}):
            count = stats_module._get_table_item_count(table, 'search_results')

        assert count == 9


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
        search = _search_table(0, {'openai': _throttled('Query'), 'gemini': _newest(_LATEST)})

        status, body = _get_stats(stats_module, _tables(search))

        assert (status, body['last_execution']) == (200, _LATEST)
