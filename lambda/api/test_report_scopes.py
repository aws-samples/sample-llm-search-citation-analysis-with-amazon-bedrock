"""
Report scopes (2.4.0): the KPI endpoints accept `keyword` | `group_id` |
`keyword_ids` and answer a group summary for the last two.

Covers, per endpoint, the routing between the single-keyword path and the
scoped path, the 400s for a missing / contradictory scope, and the shape of
the group answer built from per-keyword DynamoDB partitions:

- /visibility: group summary + per-keyword breakdown + cross-keyword brands
- /brand-mentions: brands aggregated over every keyword's latest run
- /citations: one Query per keyword instead of a table Scan
- /trends: group series (per-bucket mean) next to the per-keyword trends
- /citation-gaps: fan-out over the scope's keywords
- /reports/overview: scope threaded into trends and recommendations
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
from unittest.mock import MagicMock, patch

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_LAMBDA_DIR = os.path.dirname(_HERE)
if _LAMBDA_DIR not in sys.path:
    sys.path.insert(0, _LAMBDA_DIR)
_LAYER_PY = os.path.join(_LAMBDA_DIR, 'layer', 'python')
if os.path.isdir(_LAYER_PY) and _LAYER_PY not in sys.path:
    sys.path.append(_LAYER_PY)

_ENV = {
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-search-results',
    'DYNAMODB_TABLE_CITATIONS': 'test-citations',
    'DYNAMODB_TABLE_CRAWLED_CONTENT': 'test-crawled',
    'DYNAMODB_TABLE_KEYWORDS': 'test-keywords',
    'DYNAMODB_TABLE_BRAND_CONFIG': 'test-brand-config',
    'CORS_ORIGIN_PARAM': '',
}

ACTIVE_KEYWORDS = [
    {'id': 'k1', 'keyword': 'hotel coruna spa', 'status': 'active', 'group_ids': {'coruna'}},
    {'id': 'k2', 'keyword': 'hotel marino beach', 'status': 'active', 'group_ids': {'marino'}},
    {'id': 'k3', 'keyword': 'best hotels galicia', 'status': 'active', 'group_ids': {'coruna', 'marino'}},
]

RUN_TS = '2026-09-18T10:00:00Z'
OLD_TS = '2026-09-10T10:00:00Z'


def _load(filename: str):
    with patch('boto3.resource', MagicMock()), patch.dict(os.environ, _ENV):
        spec = importlib.util.spec_from_file_location(filename.replace('-', '_').removesuffix('.py') + '_scopes', os.path.join(_HERE, filename))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module


def _brand(name, classification, mentions=1, rank=1, sentiment='positive'):
    return {'name': name, 'classification': classification, 'mention_count': mentions, 'rank': rank, 'sentiment': sentiment}


def _result(keyword, provider, brands, timestamp=RUN_TS, citations=None):
    return {
        'keyword': keyword, 'timestamp': timestamp, 'timestamp_provider': f'{timestamp}_{provider}', 'provider': provider,
        'brands': brands, 'response': 'long llm text ' * 50, 'citations': citations or [],
    }


SEARCH_ROWS = {
    'hotel coruna spa': [
        _result('hotel coruna spa', 'openai', [_brand('Hotel Coruna', 'first_party', 2, 1), _brand('Rival Inn', 'competitor', 1, 2)]),
        _result('hotel coruna spa', 'gemini', [_brand('Hotel Coruna', 'first_party', 1, 1)]),
        _result('hotel coruna spa', 'openai', [_brand('Rival Inn', 'competitor', 5, 1)], timestamp=OLD_TS),
    ],
    'best hotels galicia': [
        _result('best hotels galicia', 'openai', [_brand('Rival Inn', 'competitor', 3, 1)]),
    ],
    'hotel marino beach': [],
}


def _fake_dynamodb(search_rows=SEARCH_ROWS, citation_rows=None, active=ACTIVE_KEYWORDS):
    """A boto3 resource whose tables answer from the fixtures above."""
    keywords_table = MagicMock(name='keywords')
    keywords_table.query.return_value = {'Items': active}

    def search_query(**kwargs):
        keyword = kwargs['KeyConditionExpression'].get_expression()['values'][1]
        return {'Items': list(search_rows.get(keyword, []))}

    search_table = MagicMock(name='search')
    search_table.query.side_effect = search_query

    def citations_query(**kwargs):
        condition = kwargs['KeyConditionExpression'].get_expression()
        keyword = condition['values'][1]
        return {'Items': list((citation_rows or {}).get(keyword, []))}

    citations_table = MagicMock(name='citations')
    citations_table.query.side_effect = citations_query
    citations_table.scan.return_value = {'Items': [row for rows in (citation_rows or {}).values() for row in rows]}

    def table_for(name):
        return {
            'test-keywords': keywords_table,
            'test-search-results': search_table,
            'test-citations': citations_table,
        }.get(name, MagicMock(name=name))

    resource = MagicMock()
    resource.Table.side_effect = table_for
    return resource, {'keywords': keywords_table, 'search': search_table, 'citations': citations_table}


def _event(params: dict | None) -> dict:
    return {'httpMethod': 'GET', 'path': '/api/x', 'queryStringParameters': params, 'headers': {}}


def _body(response: dict) -> dict:
    return json.loads(response['body'])


# ---------------------------------------------------------------------------
# /visibility
# ---------------------------------------------------------------------------

@pytest.fixture(scope='module')
def visibility():
    return _load('get-visibility-metrics.py')


@pytest.fixture
def visibility_env(visibility):
    resource, tables = _fake_dynamodb()
    with (
        patch.object(visibility, 'dynamodb', resource),
        patch.object(visibility, 'get_brand_config', return_value={}),
        patch.object(visibility, 'get_enabled_provider_count', return_value=4),
    ):
        yield visibility, tables


class TestVisibilityScope:
    def test_requires_a_scope(self, visibility_env):
        module, _ = visibility_env

        response = module.handler(_event(None), None)

        assert response['statusCode'] == 400
        assert _body(response)['field'] == 'keyword'

    def test_rejects_two_scopes(self, visibility_env):
        module, _ = visibility_env

        response = module.handler(_event({'keyword': 'a', 'group_id': 'coruna'}), None)

        assert response['statusCode'] == 400
        assert 'only one of' in _body(response)['error']

    def test_single_keyword_keeps_the_original_payload(self, visibility_env):
        module, _ = visibility_env

        body = _body(module.handler(_event({'keyword': 'hotel coruna spa'}), None))

        assert body['keyword'] == 'hotel coruna spa'
        assert body['timestamp'] == RUN_TS
        assert [brand['name'] for brand in body['first_party']] == ['Hotel Coruna']
        assert body['summary']['first_party_total_sov'] == 75.0

    def test_single_keyword_reads_a_projection_without_the_llm_text(self, visibility_env):
        module, tables = visibility_env

        module.handler(_event({'keyword': 'hotel coruna spa'}), None)

        kwargs = tables['search'].query.call_args.kwargs
        assert 'response' not in kwargs['ProjectionExpression']
        assert kwargs['ExpressionAttributeNames'] == {'#ts': 'timestamp'}

    def test_group_scope_averages_the_keywords_that_have_data(self, visibility_env):
        module, _ = visibility_env

        body = _body(module.handler(_event({'group_id': 'coruna'}), None))

        assert body['scope']['kind'] == 'group'
        assert (body['keywords_analyzed'], body['keywords_with_data']) == (2, 2)
        rows = {row['keyword']: row for row in body['keywords']}
        assert rows['hotel coruna spa']['first_party_mentioned'] is True
        assert rows['best hotels galicia']['first_party_mentioned'] is False
        assert body['summary']['coverage_rate'] == 50.0
        assert body['summary']['first_party_avg_sov'] == 37.5

    def test_group_scope_ranks_brands_across_keywords(self, visibility_env):
        module, _ = visibility_env

        body = _body(module.handler(_event({'group_id': 'coruna'}), None))

        rival = next(brand for brand in body['brands'] if brand['name'] == 'Rival Inn')
        assert rival['keyword_count'] == 2
        assert rival['classification'] == 'competitor'
        assert [brand['name'] for brand in body['first_party']] == ['Hotel Coruna']

    def test_group_scope_reports_keywords_without_data(self, visibility_env):
        module, _ = visibility_env

        body = _body(module.handler(_event({'group_id': 'marino'}), None))

        rows = {row['keyword']: row for row in body['keywords']}
        assert rows['hotel marino beach']['has_data'] is False
        assert (body['keywords_analyzed'], body['keywords_with_data']) == (2, 1)

    def test_keyword_ids_scope_resolves_to_the_selected_keywords(self, visibility_env):
        module, _ = visibility_env

        body = _body(module.handler(_event({'keyword_ids': 'k1'}), None))

        assert body['scope']['kind'] == 'keywords'
        assert [row['keyword'] for row in body['keywords']] == ['hotel coruna spa']

    def test_scope_all_summarises_every_active_keyword(self, visibility_env):
        module, _ = visibility_env

        body = _body(module.handler(_event({'scope': 'all'}), None))

        assert body['scope']['kind'] == 'all'
        assert body['keywords_analyzed'] == 3


# ---------------------------------------------------------------------------
# /brand-mentions
# ---------------------------------------------------------------------------

@pytest.fixture(scope='module')
def brand_mentions():
    return _load('get-brand-mentions.py')


@pytest.fixture
def brand_mentions_env(brand_mentions):
    resource, tables = _fake_dynamodb()
    with (
        patch.object(brand_mentions, 'dynamodb', resource),
        patch.object(brand_mentions, 'get_brand_config', return_value={'tracked_brands': {}}),
    ):
        yield brand_mentions, tables


class TestBrandMentionsScope:
    def test_requires_a_scope(self, brand_mentions_env):
        module, _ = brand_mentions_env

        assert module.handler(_event(None), None)['statusCode'] == 400

    def test_single_keyword_keeps_per_provider_responses(self, brand_mentions_env):
        module, _ = brand_mentions_env

        body = _body(module.handler(_event({'keyword': 'hotel coruna spa'}), None))

        assert body['keyword'] == 'hotel coruna spa'
        assert [entry['provider'] for entry in body['by_provider']] == ['openai', 'gemini']

    def test_group_scope_aggregates_the_latest_run_of_every_keyword(self, brand_mentions_env):
        module, _ = brand_mentions_env

        body = _body(module.handler(_event({'group_id': 'coruna'}), None))

        assert body['scope']['kind'] == 'group'
        assert body['by_provider'] == []
        assert (body['keywords_analyzed'], body['keywords_with_data']) == (2, 2)
        rival = next(brand for brand in body['aggregated']['brands'] if brand['name'] == 'Rival Inn')
        # 1 mention on coruna's latest run + 3 on galicia; the OLD_TS run (5) is excluded.
        assert rival['total_mentions'] == 4
        assert rival['keyword_count'] == 2
        assert rival['keywords'] == ['best hotels galicia', 'hotel coruna spa']

    def test_group_scope_counts_distinct_providers_across_keywords(self, brand_mentions_env):
        module, _ = brand_mentions_env

        body = _body(module.handler(_event({'group_id': 'coruna'}), None))

        mine = next(brand for brand in body['aggregated']['brands'] if brand['name'] == 'Hotel Coruna')
        assert mine['provider_count'] == 2

    def test_group_scope_reads_projections_without_the_llm_text(self, brand_mentions_env):
        module, tables = brand_mentions_env

        module.handler(_event({'group_id': 'coruna'}), None)

        for call in tables['search'].query.call_args_list:
            assert 'response' not in call.kwargs['ProjectionExpression']

    def test_group_scope_applies_the_classification_filter(self, brand_mentions_env):
        module, _ = brand_mentions_env

        body = _body(module.handler(_event({'group_id': 'coruna', 'classification': 'first_party'}), None))

        assert [brand['name'] for brand in body['aggregated']['brands']] == ['Hotel Coruna']


# ---------------------------------------------------------------------------
# /citations
# ---------------------------------------------------------------------------

CITATION_ROWS = {
    'hotel coruna spa': [
        {'keyword': 'hotel coruna spa', 'normalized_url': 'https://a.com/x', 'url': 'https://a.com/x', 'citation_count': 2, 'providers': ['openai']},
    ],
    'best hotels galicia': [
        {'keyword': 'best hotels galicia', 'normalized_url': 'https://a.com/x', 'url': 'https://a.com/x', 'citation_count': 1, 'providers': ['gemini']},
        {'keyword': 'best hotels galicia', 'normalized_url': 'https://b.com/y', 'url': 'https://b.com/y', 'citation_count': 1, 'providers': ['gemini']},
    ],
    'hotel marino beach': [
        {'keyword': 'hotel marino beach', 'normalized_url': 'https://c.com/z', 'url': 'https://c.com/z', 'citation_count': 9, 'providers': ['openai']},
    ],
}


@pytest.fixture(scope='module')
def citations():
    return _load('get-citations.py')


@pytest.fixture
def citations_env(citations):
    resource, tables = _fake_dynamodb(citation_rows=CITATION_ROWS)
    with (
        patch.object(citations, 'dynamodb', resource),
        patch.object(citations, 'citations_table', tables['citations']),
        patch.object(citations, '_get_tracked_brands', return_value=[]),
    ):
        yield citations, tables


class TestCitationsScope:
    def test_unscoped_request_scans_the_whole_table(self, citations_env):
        module, tables = citations_env

        body = _body(module.handler(_event(None), None))

        tables['citations'].scan.assert_called_once()
        assert body['scope'] is None
        assert body['total_citations'] == 4

    def test_group_scope_queries_one_partition_per_keyword_instead_of_scanning(self, citations_env):
        module, tables = citations_env

        body = _body(module.handler(_event({'group_id': 'coruna'}), None))

        tables['citations'].scan.assert_not_called()
        queried = sorted(call.kwargs['KeyConditionExpression'].get_expression()['values'][1] for call in tables['citations'].query.call_args_list)
        assert queried == ['best hotels galicia', 'hotel coruna spa']
        assert body['scope']['kind'] == 'group'
        assert [entry['url'] for entry in body['top_urls']] == ['https://a.com/x', 'https://b.com/y']

    def test_group_scope_counts_keywords_per_url_inside_the_scope_only(self, citations_env):
        module, _ = citations_env

        body = _body(module.handler(_event({'group_id': 'coruna'}), None))

        top = body['top_urls'][0]
        assert (top['citation_count'], top['keyword_count']) == (3, 2)
        assert 'https://c.com/z' not in [entry['url'] for entry in body['top_urls']]


# ---------------------------------------------------------------------------
# /trends
# ---------------------------------------------------------------------------

@pytest.fixture(scope='module')
def trends():
    return _load('get-historical-trends.py')


class TestTrendsGroupSeries:
    def test_group_series_averages_scores_per_bucket_and_sums_mentions(self, trends):
        series = trends.build_group_series([
            {'trend_data': [
                {'period': '2026-09-17', 'visibility_score': 80.0, 'total_mentions': 2, 'provider_count': 2, 'best_rank': 1, 'analysis_runs': 1},
                {'period': '2026-09-18', 'visibility_score': 60.0, 'total_mentions': 1, 'provider_count': 1, 'best_rank': 2, 'analysis_runs': 1},
            ]},
            {'trend_data': [
                {'period': '2026-09-18', 'visibility_score': 20.0, 'total_mentions': 3, 'provider_count': 3, 'best_rank': None, 'analysis_runs': 2},
            ]},
        ])

        assert series == [
            {'period': '2026-09-17', 'visibility_score': 80.0, 'total_mentions': 2, 'provider_count': 2, 'best_rank': 1, 'analysis_runs': 1, 'keywords_with_data': 1},
            {'period': '2026-09-18', 'visibility_score': 40.0, 'total_mentions': 4, 'provider_count': 3, 'best_rank': 2, 'analysis_runs': 3, 'keywords_with_data': 2},
        ]

    def test_series_summary_matches_the_single_keyword_shape(self, trends):
        summary = trends.summarize_series([
            {'period': '2026-09-17', 'visibility_score': 40.0},
            {'period': '2026-09-18', 'visibility_score': 50.0},
        ])

        assert summary['data_points'] == 2
        assert summary['summary'] == {
            'current_score': 50.0, 'previous_score': 40.0, 'change': 10.0, 'change_percent': 25.0,
            'average_score': 45.0, 'max_score': 50.0, 'min_score': 40.0,
        }

    def test_empty_series_summary_is_all_zero(self, trends):
        summary = trends.summarize_series([])

        assert (summary['data_points'], summary['trend_direction']) == (0, 'stable')
        assert summary['summary']['current_score'] == 0


class TestTrendsScopeRouting:
    @pytest.fixture
    def trends_env(self, trends):
        resource, tables = _fake_dynamodb()
        with (
            patch.object(trends, 'dynamodb', resource),
            patch.object(trends, 'get_brand_config', return_value={'tracked_brands': {'first_party': ['Hotel Coruna']}}),
            patch.object(trends, 'get_enabled_provider_count', return_value=4),
        ):
            yield trends, tables

    def test_group_scope_returns_group_series_and_per_keyword_trends(self, trends_env):
        module, _ = trends_env

        body = _body(module.handler(_event({'group_id': 'coruna', 'days': '365'}), None))

        assert body['scope']['kind'] == 'group'
        assert body['keywords_analyzed'] == 2
        assert body['keywords_truncated'] is False
        assert sorted(entry['keyword'] for entry in body['keyword_trends']) == ['best hotels galicia', 'hotel coruna spa']
        assert body['trend_data'][-1]['keywords_with_data'] == 2
        assert 'trend_direction' in body and 'summary' in body

    def test_single_keyword_is_unchanged(self, trends_env):
        module, _ = trends_env

        body = _body(module.handler(_event({'keyword': 'hotel coruna spa', 'days': '365'}), None))

        assert body['keyword'] == 'hotel coruna spa'
        assert 'keyword_trends' not in body

    def test_unscoped_request_covers_the_active_keywords(self, trends_env):
        module, _ = trends_env

        body = _body(module.handler(_event({'days': '365'}), None))

        assert body['scope']['kind'] == 'all'
        assert body['scope']['keyword_count'] == 3

    def test_rejects_two_scopes(self, trends_env):
        module, _ = trends_env

        assert module.handler(_event({'keyword': 'a', 'keyword_ids': 'k1'}), None)['statusCode'] == 400


# ---------------------------------------------------------------------------
# /citation-gaps
# ---------------------------------------------------------------------------

@pytest.fixture(scope='module')
def gaps():
    return _load('get-citation-gaps.py')


class TestCitationGapsScope:
    def test_group_scope_analyzes_every_keyword_of_the_group(self, gaps):
        resource, _ = _fake_dynamodb()
        analyzed: list[str] = []

        def record(keyword, _config):
            analyzed.append(keyword)
            return {'summary': {'gap_count': 1, 'high_priority_gaps': 0, 'coverage_rate': 50}, 'gaps': []}

        with (
            patch.object(gaps, 'dynamodb', resource),
            patch.object(gaps, 'get_brand_config', return_value={}),
            patch.object(gaps, 'analyze_citation_gaps', record),
        ):
            body = _body(gaps.handler(_event({'group_id': 'coruna', 'limit': '1'}), None))

        assert sorted(analyzed) == ['best hotels galicia', 'hotel coruna spa']
        assert body['scope']['kind'] == 'group'
        assert body['keywords_analyzed'] == 2

    def test_unscoped_request_keeps_the_limit_over_active_keywords(self, gaps):
        resource, _ = _fake_dynamodb()
        analyzed: list[str] = []

        def record(keyword, _config):
            analyzed.append(keyword)
            return {'summary': {'gap_count': 0, 'high_priority_gaps': 0, 'coverage_rate': 0}, 'gaps': []}

        with (
            patch.object(gaps, 'dynamodb', resource),
            patch.object(gaps, 'get_brand_config', return_value={}),
            patch.object(gaps, 'analyze_citation_gaps', record),
        ):
            body = _body(gaps.handler(_event({'limit': '2'}), None))

        assert analyzed == ['best hotels galicia', 'hotel coruna spa']
        assert body['scope']['kind'] == 'all'


# ---------------------------------------------------------------------------
# /reports/overview
# ---------------------------------------------------------------------------

@pytest.fixture(scope='module')
def overview():
    return _load('get-reports-overview.py')


class TestOverviewScope:
    def test_threads_the_scope_into_trends_and_recommendations(self, overview):
        resource, _ = _fake_dynamodb()
        seen: dict = {}

        def fake_trends(config, period='day', days=30, scope=None):
            seen['scope'] = scope
            return {'scope': scope.describe(), 'keywords_analyzed': len(scope.keywords), 'keyword_trends': [], 'overall': {}}

        def fake_recs(config, keywords=None):
            seen['keywords'] = keywords
            return []

        overview._sibling_cache['trends'] = fake_trends
        overview._sibling_cache['recs'] = fake_recs
        with patch.object(overview, 'dynamodb', resource), patch.object(overview, 'get_brand_config', return_value={}):
            body = _body(overview.handler(_event({'group_id': 'coruna'}), None))

        assert seen['scope'].kind == 'group'
        assert seen['keywords'] == ['best hotels galicia', 'hotel coruna spa']
        assert body['scope']['kind'] == 'group'
        assert body['keywords_analyzed'] == 2

    def test_rejects_two_scopes(self, overview):
        resource, _ = _fake_dynamodb()
        with patch.object(overview, 'dynamodb', resource):
            response = overview.handler(_event({'group_id': 'coruna', 'keyword_ids': 'k1'}), None)

        assert response['statusCode'] == 400
