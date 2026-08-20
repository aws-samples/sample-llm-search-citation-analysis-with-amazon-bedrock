"""
Regression tests for the citation-gaps query shape and orchestration.

Background — these tests pin the fix for the 2026-08-19 E2E finding:
    GET /api/citation-gaps took ~60s. analyze_citation_gaps re-read each
    keyword's ENTIRE SearchResults history (every run x provider x persona,
    each item carrying the full LLM response text) with an unbounded
    ascending query, then discarded everything but the latest run. Past
    DynamoDB's 1MB page limit the "latest" run was silently computed from
    the OLDEST page (stale results). The all-keywords path then repeated
    this sequentially for every keyword, in nondeterministic set order.

    The fix queries newest-first with a small Limit and a projection that
    excludes the response text, and fans the per-keyword analyses out to a
    thread pool with deterministic (sorted) keyword selection.

These tests would FAIL if the unbounded ascending query or the sequential
nondeterministic orchestration were reintroduced.
"""

from __future__ import annotations

import importlib.util
import os
import sys
from typing import Any
from unittest.mock import MagicMock

# The module filename has a hyphen, which is not a valid Python identifier.
# Load by file path and bind to a clean module name for pytest.
_HERE = os.path.dirname(__file__)
_MODULE_PATH = os.path.join(_HERE, 'get-citation-gaps.py')

# Mock env vars the module reads at import time so we can load without
# touching AWS.
os.environ.setdefault('DYNAMODB_TABLE_SEARCH_RESULTS', 'test-search')
os.environ.setdefault('DYNAMODB_TABLE_CITATIONS', 'test-citations')
os.environ.setdefault('DYNAMODB_TABLE_CRAWLED_CONTENT', 'test-crawled')

# Put lambda/ on the path so `from shared...` imports in the module under
# test resolve to the layer copies.
_LAMBDA_DIR = os.path.dirname(_HERE)
if _LAMBDA_DIR not in sys.path:
    sys.path.insert(0, _LAMBDA_DIR)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

_spec = importlib.util.spec_from_file_location('get_citation_gaps_query_under_test', _MODULE_PATH)
_mod = importlib.util.module_from_spec(_spec)
sys.modules['get_citation_gaps_query_under_test'] = _mod
_spec.loader.exec_module(_mod)


CONFIG: dict[str, Any] = {
    'tracked_brands': {
        'first_party': ['MyBrand'],
        'competitors': ['Rival'],
    },
    'first_party_domains': ['mybrand.com'],
}

COMPETITOR_BRAND = {'name': 'Rival Hotel', 'classification': 'competitor'}
FIRST_PARTY_BRAND = {'name': 'MyBrand Resort', 'classification': 'first_party'}


def _search_item(ts: str, provider: str, citations: list[str], brands: list[dict]) -> dict:
    return {'timestamp': ts, 'provider': provider, 'citations': citations, 'brands': brands}


def _fake_dynamodb(search_items: list[dict]) -> tuple[MagicMock, MagicMock]:
    """Fake boto3 resource: search table returns `search_items`, crawled table is empty."""
    search_table = MagicMock()
    search_table.query.return_value = {'Items': search_items}
    crawled_table = MagicMock()
    crawled_table.query.return_value = {'Items': []}
    tables = {'test-search': search_table, 'test-crawled': crawled_table}
    resource = MagicMock()
    resource.Table.side_effect = lambda name: tables.get(name, MagicMock())
    return resource, search_table


class TestLatestRunQueryShape:
    def test_queries_newest_first_with_bounded_projected_read(self, monkeypatch) -> None:
        item = _search_item('2026-08-19T00:00:00', 'openai', ['https://a.com/x'], [COMPETITOR_BRAND])
        fake, search_table = _fake_dynamodb([item])
        monkeypatch.setattr(_mod, 'dynamodb', fake)

        _mod.analyze_citation_gaps('kw', CONFIG)

        kwargs = search_table.query.call_args.kwargs
        assert kwargs['ScanIndexForward'] is False
        assert kwargs['Limit'] == _mod.LATEST_RUN_ITEM_LIMIT
        assert kwargs['ProjectionExpression'] == '#ts, provider, citations, brands'
        assert kwargs['ExpressionAttributeNames'] == {'#ts': 'timestamp'}

    def test_keeps_only_latest_run_when_window_spans_multiple_runs(self, monkeypatch) -> None:
        newest = _search_item('2026-08-19T00:00:00', 'openai', ['https://new.com/x'], [COMPETITOR_BRAND])
        older = _search_item('2026-08-01T00:00:00', 'openai', ['https://old.com/x'], [COMPETITOR_BRAND])
        fake, _ = _fake_dynamodb([newest, older])
        monkeypatch.setattr(_mod, 'dynamodb', fake)

        result = _mod.analyze_citation_gaps('kw', CONFIG)

        assert result['timestamp'] == '2026-08-19T00:00:00'
        assert [g['url'] for g in result['gaps']] == ['https://new.com/x']


class TestGapSemantics:
    def test_flags_competitor_only_source_as_gap(self, monkeypatch) -> None:
        item = _search_item('2026-08-19T00:00:00', 'openai', ['https://gap.com/page'], [COMPETITOR_BRAND])
        fake, _ = _fake_dynamodb([item])
        monkeypatch.setattr(_mod, 'dynamodb', fake)

        result = _mod.analyze_citation_gaps('kw', CONFIG)

        assert result['summary']['gap_count'] == 1
        assert result['gaps'][0]['url'] == 'https://gap.com/page'
        assert result['gaps'][0]['gap_type'] == 'competitor_only'

    def test_counts_first_party_mentioned_source_as_covered_not_gap(self, monkeypatch) -> None:
        item = _search_item(
            '2026-08-19T00:00:00', 'openai',
            ['https://covered.com/page'],
            [COMPETITOR_BRAND, FIRST_PARTY_BRAND],
        )
        fake, _ = _fake_dynamodb([item])
        monkeypatch.setattr(_mod, 'dynamodb', fake)

        result = _mod.analyze_citation_gaps('kw', CONFIG)

        assert result['summary']['gap_count'] == 0
        assert result['summary']['covered_count'] == 1


class TestAllKeywordsOrchestration:
    @staticmethod
    def _fake_keywords_dynamodb(keywords: list[str]) -> MagicMock:
        keywords_table = MagicMock()
        keywords_table.scan.return_value = {'Items': [{'keyword': k} for k in keywords]}
        resource = MagicMock()
        resource.Table.return_value = keywords_table
        return resource

    def test_analyzes_keywords_in_sorted_order_when_more_exist_than_limit(self, monkeypatch) -> None:
        monkeypatch.setenv('DYNAMODB_TABLE_KEYWORDS', 'test-keywords')
        monkeypatch.setattr(_mod, 'dynamodb', self._fake_keywords_dynamodb(['zeta', 'alpha', 'mid']))
        analyzed: list[str] = []

        def record(kw: str, _config: dict) -> dict:
            analyzed.append(kw)
            return {'summary': {'gap_count': 0, 'high_priority_gaps': 0, 'coverage_rate': 0}, 'gaps': []}

        monkeypatch.setattr(_mod, 'analyze_citation_gaps', record)

        _mod.analyze_all_keywords_gaps(CONFIG, limit=2)

        assert sorted(analyzed) == ['alpha', 'mid']

    def test_associates_each_summary_with_its_own_keyword(self, monkeypatch) -> None:
        monkeypatch.setenv('DYNAMODB_TABLE_KEYWORDS', 'test-keywords')
        monkeypatch.setattr(_mod, 'dynamodb', self._fake_keywords_dynamodb(['kw-a', 'kw-b']))
        gap_counts = {'kw-a': 3, 'kw-b': 7}

        def per_keyword(kw: str, _config: dict) -> dict:
            return {
                'summary': {'gap_count': gap_counts[kw], 'high_priority_gaps': 0, 'coverage_rate': 0},
                'gaps': [],
            }

        monkeypatch.setattr(_mod, 'analyze_citation_gaps', per_keyword)

        result = _mod.analyze_all_keywords_gaps(CONFIG, limit=2)

        by_keyword = {s['keyword']: s['gap_count'] for s in result['keyword_summaries']}
        assert by_keyword == {'kw-a': 3, 'kw-b': 7}
