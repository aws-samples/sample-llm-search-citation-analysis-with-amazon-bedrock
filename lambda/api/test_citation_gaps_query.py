"""
Regression tests for the citation-gaps query shape and orchestration.

The endpoint must isolate the latest SearchResults run with a bounded projected
read, classify and rank without crawl enrichment, slice the response, and only
then enrich the deduplicated URLs that can reach the client. The all-keywords
path must do the same after its global top-30 selection so it never recreates a
nested keyword-by-URL query fan-out.
"""

from __future__ import annotations

import os
from typing import Any
from unittest.mock import MagicMock, call

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
    """Fake boto3 resource: search and crawl tables answer the supplied rows."""
    search_table = fake_table(query={'Items': search_items})
    resource = fake_dynamodb_resource(by_name={
        'test-search': search_table,
        'test-crawled': fake_table(query={'Items': crawled_items or []}),
    })
    return resource, search_table


def _analyze(monkeypatch, search_items: list[dict], crawled_items: list[dict] | None = None) -> dict:
    """Analyse keyword ``kw`` over the supplied SearchResults and crawl rows."""
    fake, _ = _fake_dynamodb(search_items, crawled_items)
    monkeypatch.setattr(_mod, 'dynamodb', fake)
    return _mod.analyze_citation_gaps('kw', CONFIG)


def _gap(url: str, *, citation_count: int = 1) -> dict[str, Any]:
    return {
        'url': url,
        'domain': 'shared.example',
        'citation_count': citation_count,
        'providers': ['openai'],
        'provider_count': 1,
        'first_party_brands': [],
        'competitor_brands': ['Rival Hotel'],
        'priority': 'medium',
    }


def _keyword_result(gaps: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        'gaps': gaps,
        'summary': {
            'gap_count': len(gaps),
            'covered_count': 0,
            'high_priority_gaps': 0,
            'coverage_rate': 0,
        },
    }


def _oversized_search_fixture() -> tuple[list[str], list[str], MagicMock]:
    gap_urls = [f'https://gap.example/{index:02d}' for index in range(51)]
    covered_urls = [f'https://covered.example/{index:02d}' for index in range(21)]
    fake, _ = _fake_dynamodb([
        _search_item('2026-08-19T00:00:00', 'openai', gap_urls, [COMPETITOR_BRAND]),
        _search_item('2026-08-19T00:00:00', 'openai', covered_urls, [FIRST_PARTY_BRAND]),
    ])
    return gap_urls, covered_urls, fake


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
        assert [gap['url'] for gap in result['gaps']] == ['https://new.com/x']


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

    def test_ranks_high_priority_source_before_more_cited_medium_source(self, monkeypatch) -> None:
        result = _analyze(monkeypatch, [
            _search_item(
                '2026-08-19T00:00:00',
                'openai',
                ['https://medium.example/x'] * 5 + ['https://high.example/x'],
                [COMPETITOR_BRAND],
            ),
            _search_item('2026-08-19T00:00:00', 'gemini', ['https://high.example/x'], [COMPETITOR_BRAND]),
        ])

        assert [
            (gap['url'], gap['priority'], gap['citation_count']) for gap in result['gaps']
        ] == [
            ('https://high.example/x', 'high', 2),
            ('https://medium.example/x', 'medium', 5),
        ]


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


class TestFinalResponseEnrichment:
    def test_projects_only_consumed_crawl_fields_when_enriching_returned_urls(self, monkeypatch) -> None:
        table = MagicMock()
        resource = MagicMock()
        resource.Table.return_value = table
        latest_per_key = MagicMock(return_value={})
        monkeypatch.setattr(_mod, 'dynamodb', resource)
        monkeypatch.setattr(_mod, 'query_latest_per_key', latest_per_key)

        _mod._batch_crawled_info(['https://gap.example/x'])

        latest_per_key.assert_called_once_with(
            table=table,
            partition_key_name='normalized_url',
            partition_values=['https://gap.example/x'],
            max_workers=10,
            projection_expression='#title, #seo, #authority, #crawled',
            expression_attribute_names={
                '#title': 'title',
                '#seo': 'seo_analysis',
                '#authority': 'domain_authority',
                '#crawled': 'crawled_at',
            },
        )

    def test_returns_every_selected_gap_when_crawl_metadata_is_partially_unavailable(self, monkeypatch) -> None:
        urls = ['https://available.example/x', 'https://failed.example/x']
        fake, _ = _fake_dynamodb([
            _search_item('2026-08-19T00:00:00', 'openai', urls, [COMPETITOR_BRAND]),
        ])
        monkeypatch.setattr(_mod, 'dynamodb', fake)
        monkeypatch.setattr(
            _mod,
            '_batch_crawled_info',
            MagicMock(return_value={urls[0]: {'title': 'Available crawl'}}),
        )

        result = _mod.analyze_citation_gaps('kw', CONFIG)

        assert [gap['url'] for gap in result['gaps']] == urls
        assert result['gaps'][0]['title'] == 'Available crawl'
        assert 'title' not in result['gaps'][1]

    def test_enriches_only_returned_urls_when_candidates_exceed_response_slices(self, monkeypatch) -> None:
        gap_urls, covered_urls, fake = _oversized_search_fixture()
        crawled_info = MagicMock(return_value={})
        monkeypatch.setattr(_mod, 'dynamodb', fake)
        monkeypatch.setattr(_mod, '_batch_crawled_info', crawled_info)

        result = _mod.analyze_citation_gaps('kw', CONFIG)

        crawled_info.assert_called_once_with([*gap_urls[:50], *covered_urls[:20]])
        assert [gap['url'] for gap in result['gaps']] == gap_urls[:50]
        assert [source['url'] for source in result['covered_sources']] == covered_urls[:20]

    def test_preserves_unsliced_summary_counts_when_response_lists_are_truncated(self, monkeypatch) -> None:
        fake = _oversized_search_fixture()[2]
        monkeypatch.setattr(_mod, 'dynamodb', fake)
        monkeypatch.setattr(_mod, '_batch_crawled_info', MagicMock(return_value={}))

        result = _mod.analyze_citation_gaps('kw', CONFIG)

        assert result['summary'] == {
            'gap_count': 51,
            'covered_count': 21,
            'high_priority_gaps': 0,
            'coverage_rate': 29.2,
        }
        assert result['domain_summary'] == [
            {'domain': 'gap.example', 'gap_count': 51, 'total_citations': 51},
        ]


class TestAllKeywordsOrchestration:
    @staticmethod
    def _fake_keywords_dynamodb(keywords: list[str]) -> MagicMock:
        return fake_dynamodb_resource(
            fake_table(query={'Items': [{'id': keyword, 'keyword': keyword, 'status': 'active'} for keyword in keywords]})
        )

    def test_analyzes_keywords_in_sorted_order_when_more_exist_than_limit(self, monkeypatch) -> None:
        monkeypatch.setenv('DYNAMODB_TABLE_KEYWORDS', 'test-keywords')
        monkeypatch.setattr(_mod, 'dynamodb', self._fake_keywords_dynamodb(['zeta', 'alpha', 'mid']))
        analyzed: list[str] = []

        def record(keyword: str, _config: dict) -> dict:
            analyzed.append(keyword)
            return _keyword_result([])

        monkeypatch.setattr(_mod, '_build_citation_gap_result', record)

        _mod.analyze_all_keywords_gaps(CONFIG, limit=2)

        assert sorted(analyzed) == ['alpha', 'mid']

    def test_associates_each_summary_with_its_own_keyword(self, monkeypatch) -> None:
        monkeypatch.setenv('DYNAMODB_TABLE_KEYWORDS', 'test-keywords')
        monkeypatch.setattr(_mod, 'dynamodb', self._fake_keywords_dynamodb(['kw-a', 'kw-b']))
        gap_counts = {'kw-a': 3, 'kw-b': 7}

        def per_keyword(keyword: str, _config: dict) -> dict:
            result = _keyword_result([])
            result['summary']['gap_count'] = gap_counts[keyword]
            return result

        monkeypatch.setattr(_mod, '_build_citation_gap_result', per_keyword)

        result = _mod.analyze_all_keywords_gaps(CONFIG, limit=2)

        by_keyword = {summary['keyword']: summary['gap_count'] for summary in result['keyword_summaries']}
        assert by_keyword == {'kw-a': 3, 'kw-b': 7}

    def test_enriches_only_globally_returned_urls_when_more_than_thirty_qualify(self, monkeypatch) -> None:
        keywords = [f'kw-{index}' for index in range(7)]
        monkeypatch.setenv('DYNAMODB_TABLE_KEYWORDS', 'test-keywords')
        monkeypatch.setattr(_mod, 'dynamodb', self._fake_keywords_dynamodb(keywords))

        def per_keyword(keyword: str, _config: dict) -> dict:
            return _keyword_result([
                _gap(f'https://{keyword}.example/{index}') for index in range(5)
            ])

        crawled_info = MagicMock(return_value={})
        monkeypatch.setattr(_mod, '_build_citation_gap_result', per_keyword)
        monkeypatch.setattr(_mod, '_batch_crawled_info', crawled_info)

        result = _mod.analyze_all_keywords_gaps(CONFIG, limit=7)

        expected_urls = [
            f'https://kw-{keyword_index}.example/{gap_index}'
            for keyword_index in range(6)
            for gap_index in range(5)
        ]
        crawled_info.assert_called_once_with(expected_urls)
        assert [gap['url'] for gap in result['top_gaps']] == expected_urls

    def test_reuses_one_crawl_lookup_for_every_returned_occurrence_when_keywords_share_a_url(self, monkeypatch) -> None:
        shared_url = 'https://shared.example/article'
        monkeypatch.setenv('DYNAMODB_TABLE_KEYWORDS', 'test-keywords')
        monkeypatch.setattr(_mod, 'dynamodb', self._fake_keywords_dynamodb(['beta', 'alpha']))
        monkeypatch.setattr(
            _mod,
            '_build_citation_gap_result',
            lambda _keyword, _config: _keyword_result([_gap(shared_url)]),
        )
        crawled_info = MagicMock(return_value={shared_url: {'title': 'Shared article'}})
        monkeypatch.setattr(_mod, '_batch_crawled_info', crawled_info)

        result = _mod.analyze_all_keywords_gaps(CONFIG, limit=2)

        assert crawled_info.mock_calls == [call([shared_url])]
        assert [gap['keyword'] for gap in result['top_gaps']] == ['alpha', 'beta']
        assert [gap['title'] for gap in result['top_gaps']] == ['Shared article', 'Shared article']
