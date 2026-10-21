"""
Volume tests for GET /api/stats: a large tenant's totals come back inside the request.

The response is about 200 bytes; the risk was the read. Before
``shared.bounded_counts`` every total was a ``Select='COUNT'`` scan, which
still reads every item: for a tenant with 1,000 keywords, 8 providers and a
year of daily runs (~2.9 million SearchResults rows with their answer text,
tens of GB) that is tens of thousands of sequential 1 MB pages, minutes past
API Gateway's 29 s (504). With ``market_id`` each keyword partition was
counted to its end the same way.

These tests feed the handler such a tenant and check the totals are
estimates read within a bounded number of calls, flagged as approximate.
"""

from __future__ import annotations

import itertools
import os
from collections.abc import Mapping
from typing import Any
from unittest.mock import MagicMock, patch

from shared.bounded_counts import Deadline
from testing.dynamodb_stubs import described, fake_table
from testing.env import STATS_ENV
from testing.events import api_gateway_event, parse_response
from testing.handler_fixtures import handler_fixture
from testing.response_size import assert_within_page_budget
from testing.search_results_fixtures import key_parts

stats_module = handler_fixture(os.path.dirname(__file__), 'get-stats.py', 'get_stats_volume_under_test', env=STATS_ENV)

_GIB = 1024 ** 3
_KEYWORDS = [f'vuelos baratos destino {index:04d}' for index in range(1_000)]
_ROWS_PER_PAGE = 40


def _large_table(size_bytes: int, item_count: int) -> MagicMock:
    """A table ``DescribeTable`` reports as ``size_bytes`` holding ``item_count`` items, whose scans never end."""
    return described(fake_table(scan={'Count': 400, 'LastEvaluatedKey': {'id': 'more'}}, query={'Items': []}), size_bytes, item_count)


def _endless_partitions() -> MagicMock:
    """A table whose every keyword partition answers full ``COUNT`` pages forever, and a newest run per keyword."""
    def query(**kwargs: Any) -> Mapping[str, Any]:
        if kwargs.get('Select') == 'COUNT':
            return {'Count': _ROWS_PER_PAGE, 'LastEvaluatedKey': {'keyword': key_parts(kwargs['KeyConditionExpression'])[0]}}
        return {'Items': [{'timestamp': '2026-10-01T08:00:00.000000Z'}]}

    table = fake_table()
    table.query.side_effect = query
    return table


def _ticking_deadline(seconds: float) -> Deadline:
    """A deadline whose clock advances 10 ms each time it is checked, so the budget runs out deterministically."""
    ticks = itertools.count()
    return Deadline(seconds, lambda: next(ticks) * 0.01)


def _get(module: Any, tables: Mapping[str, MagicMock], query: Mapping[str, str] | None = None) -> dict[str, Any]:
    with patch.multiple(module, _count_cache={}, Deadline=_ticking_deadline, **tables):
        return module.handler(api_gateway_event('GET', '/api/stats', query=query), None)


def _large_tenant() -> dict[str, MagicMock]:
    return {
        'search_results_table': _large_table(40 * _GIB, 2_920_000),
        'citations_table': _large_table(2 * _GIB, 900_000),
        'crawled_table': _large_table(30 * _GIB, 400_000),
        'keywords_table': _large_table(200 * 1024, 1_000),
    }


class TestUnscopedTotals:
    def test_stays_within_page_budget_when_the_tables_hold_a_large_tenant(self, stats_module):
        response = _get(stats_module, _large_tenant())

        assert_within_page_budget(response)

    def test_reports_the_described_item_counts_of_tables_too_large_to_scan(self, stats_module):
        _, body = parse_response(_get(stats_module, _large_tenant()))

        assert [body[total] for total in ('total_searches', 'total_citations', 'total_crawled')] == [2_920_000, 900_000, 400_000]
        assert body['counts_approximate'] is True

    def test_scans_none_of_the_large_tables(self, stats_module):
        tables = _large_tenant()

        _get(stats_module, tables)

        assert [tables[name].scan.call_count for name in ('search_results_table', 'citations_table', 'crawled_table')] == [0, 0, 0]

    def test_stops_an_exact_count_the_time_budget_cuts_short(self, stats_module):
        tables = _large_tenant()

        _get(stats_module, tables)

        assert 0 < tables['keywords_table'].scan.call_count < 1_000


def _market_tenant() -> dict[str, MagicMock]:
    rows = [{'keyword': keyword, 'market_id': 'cl-es'} for keyword in _KEYWORDS]
    keywords = fake_table(scan={'Items': rows})
    return {
        'search_results_table': _endless_partitions(),
        'citations_table': _endless_partitions(),
        'crawled_table': _endless_partitions(),
        'keywords_table': keywords,
    }


class TestMarketTotals:
    def test_stays_within_page_budget_when_a_market_has_a_thousand_endless_partitions(self, stats_module):
        response = _get(stats_module, _market_tenant(), {'market_id': 'cl-es'})

        assert_within_page_budget(response)

    def test_flags_market_totals_the_time_budget_cut_short_as_approximate(self, stats_module):
        _, body = parse_response(_get(stats_module, _market_tenant(), {'market_id': 'cl-es'}))

        assert (body['counts_approximate'], body['unique_keywords']) == (True, 1_000)

    def test_reads_a_bounded_number_of_count_pages(self, stats_module):
        tables = _market_tenant()

        _get(stats_module, tables, {'market_id': 'cl-es'})

        count_pages = sum(
            1 for call in tables['search_results_table'].query.call_args_list if call.kwargs.get('Select') == 'COUNT'
        )
        assert count_pages < 2_000
