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

import os
from typing import Any
from unittest.mock import MagicMock

from testing.dynamodb_stubs import fake_dynamodb_resource, fake_table
from testing.env import setdefault_env
from testing.module_loader import load_handler_module

# Table names the module reads at import time, so it loads without touching AWS.
setdefault_env({
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-search',
    'DYNAMODB_TABLE_CITATIONS': 'test-citations',
    'DYNAMODB_TABLE_CRAWLED_CONTENT': 'test-crawled',
})
_mod = load_handler_module(os.path.dirname(__file__), 'get-citation-gaps.py', 'get_citation_gaps_query_under_test')


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


def _fake_dynamodb(search_items: list[dict], crawled_items: list[dict] | None = None) -> tuple[MagicMock, MagicMock]:
    """Fake boto3 resource: search table returns `search_items`, crawled table returns `crawled_items` (default empty)."""
    search_table = fake_table(query={'Items': search_items})
    resource = fake_dynamodb_resource(by_name={
        'test-search': search_table,
        'test-crawled': fake_table(query={'Items': crawled_items or []}),
    })
    return resource, search_table


def _analyze(monkeypatch, search_items: list[dict], crawled_items: list[dict] | None = None) -> dict:
    """Analyse keyword `kw` over a SearchResults table answering `search_items` (and `crawled_items`)."""
    fake, _ = _fake_dynamodb(search_items, crawled_items)
    monkeypatch.setattr(_mod, 'dynamodb', fake)
    return _mod.analyze_citation_gaps('kw', CONFIG)


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

        result = _analyze(monkeypatch, [newest, older])

        assert result['timestamp'] == '2026-08-19T00:00:00'
        assert [g['url'] for g in result['gaps']] == ['https://new.com/x']


class TestGapSemantics:
    def test_flags_competitor_only_source_as_gap(self, monkeypatch) -> None:
        result = _analyze(monkeypatch, [
            _search_item('2026-08-19T00:00:00', 'openai', ['https://gap.com/page'], [COMPETITOR_BRAND]),
        ])

        assert result['summary']['gap_count'] == 1
        assert result['gaps'][0]['url'] == 'https://gap.com/page'
        assert (result['gaps'][0]['first_party_brands'], result['gaps'][0]['competitor_brands']) == ([], ['Rival Hotel'])

    def test_counts_first_party_mentioned_source_as_covered_not_gap(self, monkeypatch) -> None:
        result = _analyze(monkeypatch, [
            _search_item('2026-08-19T00:00:00', 'openai', ['https://covered.com/page'], [COMPETITOR_BRAND, FIRST_PARTY_BRAND]),
        ])

        assert result['summary']['gap_count'] == 0
        assert result['summary']['covered_count'] == 1


class TestSourceClassification:
    def test_never_reports_a_first_party_domain_as_a_gap_or_covered_source(self, monkeypatch) -> None:
        result = _analyze(monkeypatch, [
            _search_item('2026-08-19T00:00:00', 'openai', ['https://www.mybrand.com/page'], [COMPETITOR_BRAND]),
        ])

        assert result['gaps'] == []
        assert result['covered_sources'] == []
        assert result['summary'] == {'gap_count': 0, 'covered_count': 0, 'high_priority_gaps': 0, 'coverage_rate': 0}

    def test_ignores_sources_that_mention_no_tracked_brand(self, monkeypatch) -> None:
        result = _analyze(monkeypatch, [
            _search_item('2026-08-19T00:00:00', 'openai', ['https://neutral.io/z'], [{'name': 'Nobody', 'classification': 'other'}]),
        ])

        assert result['gaps'] == []
        assert result['covered_sources'] == []

    def test_classifies_unlabelled_brands_by_fuzzy_match_against_the_tracked_brands(self, monkeypatch) -> None:
        result = _analyze(monkeypatch, [
            _search_item('2026-08-19T00:00:00', 'openai', ['https://covered.net/y'], [{'name': 'MyBrand Premium'}]),
            _search_item('2026-08-19T00:00:00', 'gemini', ['https://gap.com/x'], [{'name': 'Rival Garden'}]),
        ])

        assert [source['url'] for source in result['covered_sources']] == ['https://covered.net/y']
        assert result['covered_sources'][0]['first_party_brands'] == ['MyBrand Premium']
        assert [gap['url'] for gap in result['gaps']] == ['https://gap.com/x']
        assert result['gaps'][0]['competitor_brands'] == ['Rival Garden']

    def test_marks_a_gap_high_priority_when_two_providers_cite_it(self, monkeypatch) -> None:
        result = _analyze(monkeypatch, [
            _search_item('2026-08-19T00:00:00', 'openai', ['https://gap.com/x'], [COMPETITOR_BRAND]),
            _search_item('2026-08-19T00:00:00', 'gemini', ['https://gap.com/x'], [COMPETITOR_BRAND]),
        ])

        assert result['gaps'][0]['priority'] == 'high'
        assert result['gaps'][0]['provider_count'] == 2
        assert result['summary']['high_priority_gaps'] == 1

    def test_marks_a_gap_medium_priority_when_one_provider_cites_it(self, monkeypatch) -> None:
        result = _analyze(monkeypatch, [
            _search_item('2026-08-19T00:00:00', 'openai', ['https://gap.com/x', 'https://gap.com/x'], [COMPETITOR_BRAND]),
        ])

        assert result['gaps'][0]['priority'] == 'medium'
        assert result['gaps'][0]['citation_count'] == 2
        assert result['summary']['high_priority_gaps'] == 0

    def test_merges_the_latest_crawled_content_into_the_gap(self, monkeypatch) -> None:
        crawled_row = {
            'normalized_url': 'https://gap.com/x', 'title': 'Best hotels', 'seo_analysis': {'score': 71},
            'domain_authority': 42, 'crawled_at': '2026-08-18T00:00:00',
        }
        result = _analyze(
            monkeypatch,
            [_search_item('2026-08-19T00:00:00', 'openai', ['https://gap.com/x'], [COMPETITOR_BRAND])],
            [crawled_row],
        )

        gap = result['gaps'][0]
        assert (gap['title'], gap['domain_authority']) == ('Best hotels', 42)
        assert gap['seo_analysis'] == {'score': 71}
        assert gap['last_crawled'] == '2026-08-18T00:00:00'

    def test_summarises_gaps_per_domain_with_the_most_gaps_first(self, monkeypatch) -> None:
        result = _analyze(monkeypatch, [
            _search_item(
                '2026-08-19T00:00:00', 'openai',
                ['https://gap.com/a', 'https://gap.com/b', 'https://other.org/c', 'https://gap.com/a'],
                [COMPETITOR_BRAND],
            ),
        ])

        assert result['domain_summary'] == [
            {'domain': 'gap.com', 'gap_count': 2, 'total_citations': 3},
            {'domain': 'other.org', 'gap_count': 1, 'total_citations': 1},
        ]


class TestAllKeywordsOrchestration:
    @staticmethod
    def _fake_keywords_dynamodb(keywords: list[str]) -> MagicMock:
        return fake_dynamodb_resource(
            fake_table(query={'Items': [{'id': k, 'keyword': k, 'status': 'active'} for k in keywords]})
        )

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
