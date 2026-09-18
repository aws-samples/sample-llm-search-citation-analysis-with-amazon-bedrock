"""
Tests for the parallel fan-out in `get_all_keywords_trends` (audit item 16).

Background — these tests pin the fix for the last N+1 DynamoDB query loop
flagged in the audit. The previous implementation looped over keywords and
called `get_historical_trends` serially, which issued one DynamoDB `query`
per keyword. For the default 20-keyword cap that was 20 sequential round-trips.

The refactor splits `get_historical_trends` into:
  - `_fetch_keyword_items(keyword)` — DynamoDB query only
  - `_build_trend_from_items(...)` — pure-Python aggregation

`get_all_keywords_trends` now fans out phase 1 through a ThreadPoolExecutor
(bounded at `_TRENDS_MAX_WORKERS=10`) and runs phase 2 serially afterwards.

These tests would FAIL if the serial loop were reintroduced.
"""

from __future__ import annotations

import importlib.util
import os
import sys
from unittest.mock import MagicMock, patch

# Load env vars the module reads at import.
os.environ.setdefault('DYNAMODB_TABLE_SEARCH_RESULTS', 'test-search')

_HERE = os.path.dirname(__file__)
_MODULE_PATH = os.path.join(_HERE, 'get-historical-trends.py')

_LAMBDA_DIR = os.path.dirname(_HERE)
if _LAMBDA_DIR not in sys.path:
    sys.path.insert(0, _LAMBDA_DIR)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

_spec = importlib.util.spec_from_file_location(
    'get_historical_trends_under_test', _MODULE_PATH
)
_mod = importlib.util.module_from_spec(_spec)
sys.modules['get_historical_trends_under_test'] = _mod
_spec.loader.exec_module(_mod)


class TestFetchKeywordItems:
    """`_fetch_keyword_items` is the I/O-only helper that gets fanned out."""

    def test_returns_items_from_dynamodb_query(self) -> None:
        fake_table = MagicMock()
        fake_table.query.return_value = {'Items': [{'timestamp': '2026-01-01T00:00:00Z'}]}
        fake_resource = MagicMock()
        fake_resource.Table.return_value = fake_table
        with patch.object(_mod, 'dynamodb', fake_resource):
            items = _mod._fetch_keyword_items('my-keyword')
        assert items == [{'timestamp': '2026-01-01T00:00:00Z'}]

    def test_returns_empty_list_when_query_raises(self) -> None:
        """A single bad keyword must not break the whole dashboard."""
        fake_table = MagicMock()
        fake_table.query.side_effect = Exception('throttled')
        fake_resource = MagicMock()
        fake_resource.Table.return_value = fake_table
        with patch.object(_mod, 'dynamodb', fake_resource):
            items = _mod._fetch_keyword_items('my-keyword')
        assert items == []


class TestBuildTrendFromItems:
    """`_build_trend_from_items` is pure-Python, no I/O. Easy to test."""

    def test_returns_error_for_empty_items(self) -> None:
        result = _mod._build_trend_from_items('kw', [], {}, 'day', 30)
        assert 'error' in result
        assert 'kw' in result['error']

    def test_returns_trend_payload_shape_for_items(self) -> None:
        """Contract check: the returned dict still carries the same keys
        the dashboard consumes. This is the characterization test for the
        extract-method refactor."""
        items = [
            {
                'keyword': 'kw',
                'timestamp': '2026-04-17T12:00:00Z',
                'provider': 'openai',
                'brands': [
                    {'name': 'MyBrand', 'classification': 'first_party',
                     'mention_count': 1, 'rank': 1}
                ],
            }
        ]
        result = _mod._build_trend_from_items('kw', items, {}, 'day', 30)
        assert result['keyword'] == 'kw'
        assert result['period_type'] == 'day'
        assert 'trend_data' in result
        assert 'trend_direction' in result
        assert 'summary' in result


class TestGetAllKeywordsTrendsParallelFanOut:
    """The regression guards for the parallelization."""

    def _fake_keyword_items(self, keyword: str) -> list[dict]:
        """One trend item per keyword, enough to build a non-error trend."""
        return [
            {
                'keyword': keyword,
                'timestamp': '2026-04-17T12:00:00Z',
                'provider': 'openai',
                'brands': [
                    {'name': 'MyBrand', 'classification': 'first_party',
                     'mention_count': 1, 'rank': 1}
                ],
            }
        ]

    def test_fetches_each_keyword_exactly_once(self) -> None:
        """Regression guard: the parallel fan-out must dedupe any accidental
        double-queries. The previous serial loop only called fetch once per
        keyword; we must preserve that."""
        keywords_table = MagicMock()
        keywords_table.query.return_value = {
            'Items': [{'keyword': f'kw{i}'} for i in range(5)]
        }
        search_table = MagicMock()

        def fake_resource_table(name: str):
            if 'KEYWORD' in name.upper() or 'keyword' in name.lower():
                return keywords_table
            return search_table

        fake_resource = MagicMock()
        fake_resource.Table.side_effect = fake_resource_table

        call_counter = {'count': 0}

        def counting_fetch(keyword: str) -> list[dict]:
            call_counter['count'] += 1
            return self._fake_keyword_items(keyword)

        with patch.object(_mod, 'dynamodb', fake_resource), \
             patch.dict(os.environ, {'DYNAMODB_TABLE_KEYWORDS': 'test-keywords'}), \
             patch.object(_mod, '_fetch_keyword_items', side_effect=counting_fetch):
            result = _mod.get_all_keywords_trends({}, 'day', 30)

        # 5 keywords → 5 fetches, no duplication.
        assert call_counter['count'] == 5
        assert result['keywords_analyzed'] == 5

    def test_uses_thread_pool_for_parallel_fetching(self) -> None:
        """Regression guard: if someone reverts to a serial loop, the
        ThreadPoolExecutor would never be constructed. We assert the pool
        is used. This catches the whole class of "accidentally serial"
        regressions."""
        keywords_table = MagicMock()
        keywords_table.query.return_value = {
            'Items': [{'keyword': f'kw{i}'} for i in range(3)]
        }
        fake_resource = MagicMock()
        fake_resource.Table.return_value = keywords_table

        with patch.object(_mod, 'dynamodb', fake_resource), \
             patch.dict(os.environ, {'DYNAMODB_TABLE_KEYWORDS': 'test-keywords'}), \
             patch.object(_mod, '_fetch_keyword_items', side_effect=self._fake_keyword_items), \
             patch.object(_mod.concurrent.futures, 'ThreadPoolExecutor',
                         wraps=_mod.concurrent.futures.ThreadPoolExecutor) as pool_spy:
            _mod.get_all_keywords_trends({}, 'day', 30)

        pool_spy.assert_called_once()

    def test_caps_worker_count_at_max_workers_constant(self) -> None:
        """With more keywords than `_TRENDS_MAX_WORKERS`, the pool size is
        capped — otherwise we'd spawn 20+ threads and overshoot DynamoDB RCU.
        """
        keywords_table = MagicMock()
        keywords_table.query.return_value = {
            'Items': [{'keyword': f'kw{i}'} for i in range(20)]
        }
        fake_resource = MagicMock()
        fake_resource.Table.return_value = keywords_table

        with patch.object(_mod, 'dynamodb', fake_resource), \
             patch.dict(os.environ, {'DYNAMODB_TABLE_KEYWORDS': 'test-keywords'}), \
             patch.object(_mod, '_fetch_keyword_items', side_effect=self._fake_keyword_items), \
             patch.object(_mod.concurrent.futures, 'ThreadPoolExecutor',
                         wraps=_mod.concurrent.futures.ThreadPoolExecutor) as pool_spy:
            _mod.get_all_keywords_trends({}, 'day', 30)

        pool_spy.assert_called_once()
        _, kwargs = pool_spy.call_args
        assert kwargs['max_workers'] == _mod._TRENDS_MAX_WORKERS

    def test_caps_worker_count_at_keyword_count_when_fewer_than_max(self) -> None:
        """With fewer keywords than `_TRENDS_MAX_WORKERS`, size to keyword
        count. No point spinning up 10 threads for 3 items."""
        keywords_table = MagicMock()
        keywords_table.query.return_value = {
            'Items': [{'keyword': f'kw{i}'} for i in range(3)]
        }
        fake_resource = MagicMock()
        fake_resource.Table.return_value = keywords_table

        with patch.object(_mod, 'dynamodb', fake_resource), \
             patch.dict(os.environ, {'DYNAMODB_TABLE_KEYWORDS': 'test-keywords'}), \
             patch.object(_mod, '_fetch_keyword_items', side_effect=self._fake_keyword_items), \
             patch.object(_mod.concurrent.futures, 'ThreadPoolExecutor',
                         wraps=_mod.concurrent.futures.ThreadPoolExecutor) as pool_spy:
            _mod.get_all_keywords_trends({}, 'day', 30)

        _, kwargs = pool_spy.call_args
        assert kwargs['max_workers'] == 3

    def test_returns_empty_payload_when_no_keywords(self) -> None:
        """Empty keyword set must not spin up the pool or fail."""
        keywords_table = MagicMock()
        keywords_table.query.return_value = {'Items': []}
        fake_resource = MagicMock()
        fake_resource.Table.return_value = keywords_table

        with patch.object(_mod, 'dynamodb', fake_resource), \
             patch.dict(os.environ, {'DYNAMODB_TABLE_KEYWORDS': 'test-keywords'}), \
             patch.object(_mod, '_fetch_keyword_items') as mock_fetch:
            result = _mod.get_all_keywords_trends({}, 'day', 30)

        mock_fetch.assert_not_called()
        assert result['keywords_analyzed'] == 0
        assert result['keyword_trends'] == []
        assert result['overall']['avg_score'] == 0

    def test_preserves_all_keyword_results_despite_async_order(self) -> None:
        """`as_completed` returns futures in completion order, which is
        non-deterministic. The output must still cover every input keyword
        (sorting by current_score is applied at the end)."""
        keywords_table = MagicMock()
        keywords_table.query.return_value = {
            'Items': [{'keyword': f'kw{i}'} for i in range(5)]
        }
        fake_resource = MagicMock()
        fake_resource.Table.return_value = keywords_table

        with patch.object(_mod, 'dynamodb', fake_resource), \
             patch.dict(os.environ, {'DYNAMODB_TABLE_KEYWORDS': 'test-keywords'}), \
             patch.object(_mod, '_fetch_keyword_items', side_effect=self._fake_keyword_items):
            result = _mod.get_all_keywords_trends({}, 'day', 30)

        returned_keywords = {t['keyword'] for t in result['keyword_trends']}
        assert returned_keywords == {f'kw{i}' for i in range(5)}

    def test_caps_fan_out_at_twenty_keywords(self) -> None:
        """Dashboard breadth cap — unchanged from the serial implementation."""
        keywords_table = MagicMock()
        keywords_table.query.return_value = {
            'Items': [{'keyword': f'kw{i}'} for i in range(50)]
        }
        fake_resource = MagicMock()
        fake_resource.Table.return_value = keywords_table

        call_counter = {'count': 0}

        def counting_fetch(keyword: str) -> list[dict]:
            call_counter['count'] += 1
            return self._fake_keyword_items(keyword)

        with patch.object(_mod, 'dynamodb', fake_resource), \
             patch.dict(os.environ, {'DYNAMODB_TABLE_KEYWORDS': 'test-keywords'}), \
             patch.object(_mod, '_fetch_keyword_items', side_effect=counting_fetch):
            _mod.get_all_keywords_trends({}, 'day', 30)

        assert call_counter['count'] == 20

    def test_individual_keyword_errors_dont_break_the_batch(self) -> None:
        """If `_fetch_keyword_items` returns [] for one keyword (its own
        try/except caught the error), the others still produce trends."""
        keywords_table = MagicMock()
        keywords_table.query.return_value = {
            'Items': [{'keyword': f'kw{i}'} for i in range(3)]
        }
        fake_resource = MagicMock()
        fake_resource.Table.return_value = keywords_table

        def mixed_fetch(keyword: str) -> list[dict]:
            if keyword == 'kw1':
                return []  # Simulate the error-caught case
            return self._fake_keyword_items(keyword)

        with patch.object(_mod, 'dynamodb', fake_resource), \
             patch.dict(os.environ, {'DYNAMODB_TABLE_KEYWORDS': 'test-keywords'}), \
             patch.object(_mod, '_fetch_keyword_items', side_effect=mixed_fetch):
            result = _mod.get_all_keywords_trends({}, 'day', 30)

        # 2 succeeded (kw0, kw2), 1 returned error payload (kw1) and was
        # filtered out. The dashboard reports the 2 successful.
        assert result['keywords_analyzed'] == 2
