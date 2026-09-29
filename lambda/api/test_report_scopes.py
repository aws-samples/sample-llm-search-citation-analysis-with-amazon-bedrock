"""
Report scopes (2.4.0): the KPI endpoints accept `keyword` | `group_id` |
`keyword_ids` and answer a group summary for the last two.

Covers, per endpoint, the routing between the single-keyword path and the
scoped path, the 400s for a missing / contradictory scope, and the shape of
the group answer built from per-keyword DynamoDB partitions:

- /visibility: every KPI over each keyword's latest run, pooled, with the brand leaderboard and a row per keyword
- /brand-mentions: brands aggregated over every keyword's latest run
- /citations: one Query per keyword instead of a table Scan
- /trends: the KPIs per period, pooled over the scope, next to each keyword's move
- /citation-gaps: fan-out over the scope's keywords
- /reports/overview: scope threaded into trends and recommendations
"""

from __future__ import annotations

import json
import os
from unittest.mock import MagicMock, patch

import pytest

from shared.scope_params import ReportScope
from testing.assertions import present
from testing.module_loader import load_handler_module, module_name_for

_HERE = os.path.dirname(os.path.abspath(__file__))

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
        return load_handler_module(_HERE, filename, module_name_for(filename, '_scopes'))


def _brand(name, classification, mentions=1, rank=1, sentiment='positive'):
    return {'name': name, 'classification': classification, 'mention_count': mentions, 'rank': rank, 'sentiment': sentiment}


def _result(keyword, provider, brands, timestamp=RUN_TS, citations=None, model=None, query_prompt_id='default'):
    return {
        'keyword': keyword, 'timestamp': timestamp, 'timestamp_provider': f'{timestamp}#{provider}#{query_prompt_id}',
        'provider': provider, 'brands': brands, 'response': 'long llm text ' * 50, 'citations': citations or [],
        'metadata': {'model': model or f'{provider}-model'}, 'query_prompt_id': query_prompt_id,
    }


def _key_parts(condition):
    """The partition value and the sort-key condition (or ``None``) of a key condition."""
    expression = condition.get_expression()
    if expression['operator'] == 'AND':
        partition, sort = expression['values']
        return partition.get_expression()['values'][1], sort
    return expression['values'][1], None


def _sort_condition(query_kwargs) -> tuple[str, str]:
    """The operator and value of a query's sort-key condition."""
    sort = present(_key_parts(query_kwargs['KeyConditionExpression'])[1])
    return sort.expression_operator, sort.get_expression()['values'][1]


def _sort_key_matches(row, sort) -> bool:
    if sort is None:
        return True
    value = sort.get_expression()['values'][1]
    if sort.expression_operator == 'begins_with':
        return row['timestamp_provider'].startswith(value)
    if sort.expression_operator == '<':
        return row['timestamp_provider'] < value
    assert sort.expression_operator == '>='
    return row['timestamp_provider'] >= value


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
        keyword, sort = _key_parts(kwargs['KeyConditionExpression'])
        rows = [row for row in search_rows.get(keyword, []) if _sort_key_matches(row, sort)]
        if kwargs.get('ScanIndexForward') is False:
            rows.sort(key=lambda row: row['timestamp_provider'], reverse=True)
        return {'Items': rows[:kwargs['Limit']] if 'Limit' in kwargs else rows}

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


def _fail_reads_of(search_table, keyword: str) -> None:
    """Make every read of ``keyword``'s SearchResults partition raise, keeping the others answering."""
    succeed = search_table.query.side_effect

    def search_query(**kwargs):
        if _key_parts(kwargs['KeyConditionExpression'])[0] == keyword:
            raise PartitionFailure('throttled')
        return succeed(**kwargs)

    search_table.query.side_effect = search_query


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
        patch.object(visibility, 'get_brand_config', return_value={'first_party_domains': ['hotel-coruna.com']}),
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

    def test_single_keyword_measures_its_latest_run(self, visibility_env):
        module, _ = visibility_env

        body = _body(module.handler(_event({'keyword': 'hotel coruna spa'}), None))

        kpis = body['kpis']
        assert (body['timestamp'], kpis['answers'], kpis['mention_rate'], kpis['share_of_voice']) == (RUN_TS, 2, 100.0, 66.7)

    def test_single_keyword_answers_one_keyword_row(self, visibility_env):
        module, _ = visibility_env

        body = _body(module.handler(_event({'keyword': 'hotel coruna spa'}), None))

        assert [(row['keyword'], row['timestamp'], row['has_data']) for row in body['keywords']] == [('hotel coruna spa', RUN_TS, True)]

    def test_reads_only_the_latest_run_without_the_llm_text(self, visibility_env):
        module, tables = visibility_env

        module.handler(_event({'keyword': 'hotel coruna spa'}), None)

        run_query = tables['search'].query.call_args.kwargs
        assert (*_sort_condition(run_query), 'response' in run_query['ProjectionExpression']) == (
            'begins_with', f'{RUN_TS}#', False,
        )

    def test_group_scope_pools_the_answers_of_every_keyword(self, visibility_env):
        module, _ = visibility_env

        body = _body(module.handler(_event({'group_id': 'coruna'}), None))

        kpis = body['kpis']
        assert (body['scope']['kind'], kpis['answers'], kpis['mention_rate'], kpis['keyword_coverage']) == ('group', 3, 66.7, 50.0)

    def test_group_scope_reports_each_keywords_kpis(self, visibility_env):
        module, _ = visibility_env

        body = _body(module.handler(_event({'group_id': 'coruna'}), None))

        rows = {row['keyword']: row for row in body['keywords']}
        assert (rows['hotel coruna spa']['kpis']['mentions'], rows['best hotels galicia']['kpis']['mentions']) == (2, 0)

    def test_group_scope_ranks_brands_across_keywords(self, visibility_env):
        module, _ = visibility_env

        body = _body(module.handler(_event({'group_id': 'coruna'}), None))

        rival = next(brand for brand in body['brands'] if brand['name'] == 'Rival Inn')
        assert (rival['keywords'], rival['classification'], rival['mentions']) == (2, 'competitor', 2)

    def test_group_scope_reports_keywords_without_data(self, visibility_env):
        module, _ = visibility_env

        body = _body(module.handler(_event({'group_id': 'marino'}), None))

        rows = {row['keyword']: row for row in body['keywords']}
        assert (rows['hotel marino beach']['has_data'], rows['hotel marino beach']['kpis']) == (False, None)
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

    def test_says_whether_owned_domains_are_configured(self, visibility_env):
        module, _ = visibility_env

        assert _body(module.handler(_event({'keyword': 'hotel coruna spa'}), None))['citations_configured'] is True

    def test_keeps_one_personas_answers(self, visibility):
        rows = {'hotel coruna spa': [
            _result('hotel coruna spa', 'openai', [_brand('Hotel Coruna', 'first_party')], query_prompt_id='family'),
            _result('hotel coruna spa', 'gemini', [_brand('Rival Inn', 'competitor')]),
        ]}
        resource, _ = _fake_dynamodb(search_rows=rows)
        with patch.object(visibility, 'dynamodb', resource), patch.object(visibility, 'get_brand_config', return_value={}):
            body = _body(visibility.handler(_event({'keyword': 'hotel coruna spa', 'query_prompt_id': 'family'}), None))

        assert (body['kpis']['answers'], body['kpis']['mention_rate']) == (1, 100.0)

    def test_narrows_the_leaderboard_to_the_requested_brand(self, visibility_env):
        module, _ = visibility_env

        body = _body(module.handler(_event({'keyword': 'hotel coruna spa', 'brand': 'rival'}), None))

        assert ([brand['name'] for brand in body['brands']], body['kpis']['mention_rate']) == (['Rival Inn'], 100.0)

    def test_compares_the_latest_run_with_the_previous_one(self, visibility_env):
        module, _ = visibility_env

        change = _body(module.handler(_event({'keyword': 'hotel coruna spa'}), None))['change']

        assert (change['keywords_compared'], change['deltas']['mention_rate'], change['trends']['visibility_score']) == (
            1, 100.0, 'improving',
        )

    def test_has_no_change_for_keywords_analysed_once(self, visibility_env):
        module, _ = visibility_env

        assert _body(module.handler(_event({'keyword': 'best hotels galicia'}), None))['change'] is None


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
    @pytest.fixture
    def latest_coruna_hotel_brand(self, brand_mentions_env):
        module, _ = brand_mentions_env
        body = _body(module.handler(_event({'group_id': 'coruna'}), None))
        return next(brand for brand in body['aggregated']['brands'] if brand['name'] == 'Hotel Coruna')

    def test_requires_a_scope(self, brand_mentions_env):
        module, _ = brand_mentions_env

        assert module.handler(_event(None), None)['statusCode'] == 400

    def test_single_keyword_keeps_per_provider_responses(self, brand_mentions_env):
        module, _ = brand_mentions_env

        body = _body(module.handler(_event({'keyword': 'hotel coruna spa'}), None))

        assert body['keyword'] == 'hotel coruna spa'
        assert [entry['provider'] for entry in body['by_provider']] == ['openai', 'gemini']

    def test_single_keyword_returns_the_requested_historical_run(self, brand_mentions_env):
        module, _ = brand_mentions_env

        body = _body(module.handler(_event({'keyword': 'hotel coruna spa', 'timestamp': OLD_TS}), None))

        assert body['timestamp'] == OLD_TS
        assert [entry['provider'] for entry in body['by_provider']] == ['openai']
        assert body['aggregated']['brands'][0]['total_mentions'] == 5

    def test_single_keyword_uses_every_page_to_select_the_latest_run(self, brand_mentions_env):
        module, tables = brand_mentions_env
        tables['search'].query.side_effect = [
            {
                'Items': [_result('hotel coruna spa', 'openai', [_brand('Old Brand', 'competitor')], timestamp=OLD_TS)],
                'LastEvaluatedKey': {'keyword': 'hotel coruna spa', 'timestamp_provider': f'{OLD_TS}_openai'},
            },
            {'Items': [_result('hotel coruna spa', 'gemini', [_brand('Latest Brand', 'first_party')])]},
        ]

        body = _body(module.handler(_event({'keyword': 'hotel coruna spa'}), None))

        assert body['available_runs'] == [RUN_TS, OLD_TS]
        assert [entry['provider'] for entry in body['by_provider']] == ['gemini']

    @pytest.mark.parametrize(
        'filter_params',
        [
            pytest.param({'provider': 'openai'}, id='provider'),
            pytest.param({'query_prompt_id': 'historical-persona'}, id='persona'),
        ],
    )
    def test_single_keyword_returns_empty_latest_run_when_filter_matches_only_an_older_run(
        self,
        brand_mentions_env,
        filter_params,
    ):
        module, tables = brand_mentions_env
        tables['search'].query.side_effect = [{
            'Items': [
                _result('hotel coruna spa', 'gemini', [_brand('Latest Brand', 'first_party')]),
                _result(
                    'hotel coruna spa',
                    'openai',
                    [_brand('Old Brand', 'competitor')],
                    timestamp=OLD_TS,
                    query_prompt_id='historical-persona',
                ),
            ],
        }]

        body = _body(module.handler(_event({'keyword': 'hotel coruna spa', **filter_params}), None))

        assert {
            'timestamp': body['timestamp'],
            'available_runs': body['available_runs'],
            'by_provider': body['by_provider'],
            'aggregated_brands': body['aggregated']['brands'],
        } == {
            'timestamp': RUN_TS,
            'available_runs': [RUN_TS, OLD_TS],
            'by_provider': [],
            'aggregated_brands': [],
        }

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

    @pytest.mark.parametrize('scope_params', [
        {'group_id': 'coruna'},
        {'keyword_ids': 'k1,k3'},
        {'scope': 'all'},
    ])
    def test_aggregate_scope_returns_only_the_requested_historical_run(self, brand_mentions_env, scope_params):
        module, _ = brand_mentions_env

        body = _body(module.handler(_event({**scope_params, 'timestamp': OLD_TS}), None))

        rival = next(brand for brand in body['aggregated']['brands'] if brand['name'] == 'Rival Inn')
        assert body['timestamp'] == OLD_TS
        assert body['keywords_with_data'] == 1
        assert rival['total_mentions'] == 5

    def test_available_runs_are_distinct_and_newest_first(self, brand_mentions_env):
        module, _ = brand_mentions_env

        body = _body(module.handler(_event({'group_id': 'coruna'}), None))

        assert body['available_runs'] == [RUN_TS, OLD_TS]

    def test_appearances_identify_their_keyword_provider_and_model(self, latest_coruna_hotel_brand):
        assert [
            (appearance['keyword'], appearance['provider'], appearance['model'])
            for appearance in latest_coruna_hotel_brand['appearances']
        ] == [
            ('hotel coruna spa', 'openai', 'openai-model'),
            ('hotel coruna spa', 'gemini', 'gemini-model'),
        ]

    def test_group_scope_counts_distinct_providers_across_keywords(self, latest_coruna_hotel_brand):
        assert latest_coruna_hotel_brand['provider_count'] == 2

    def test_group_scope_reads_projections_without_the_llm_text(self, brand_mentions_env):
        module, tables = brand_mentions_env

        module.handler(_event({'group_id': 'coruna'}), None)

        for call in tables['search'].query.call_args_list:
            assert 'response' not in call.kwargs['ProjectionExpression']

    def test_group_scope_projects_metadata_for_appearance_models(self, brand_mentions_env):
        module, tables = brand_mentions_env

        module.handler(_event({'group_id': 'coruna'}), None)

        assert all('metadata' in call.kwargs['ProjectionExpression'] for call in tables['search'].query.call_args_list)

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


class TestTrendsScopeRouting:
    @pytest.fixture
    def trends_env(self, trends):
        resource, tables = _fake_dynamodb()
        with (
            patch.object(trends, 'dynamodb', resource),
            patch.object(trends, 'get_brand_config', return_value={}),
            patch.object(trends, 'history_since', return_value='2026-01-01T00:00:00.000000Z'),
        ):
            yield trends, tables

    def test_group_scope_returns_the_series_of_the_pooled_answers(self, trends_env):
        module, _ = trends_env

        body = _body(module.handler(_event({'group_id': 'coruna'}), None))

        assert [(point['period'], point['keywords_with_data'], point['kpis']['answers']) for point in body['trend_data']] == [
            ('2026-09-10', 1, 1), ('2026-09-18', 2, 3),
        ]

    def test_group_scope_reports_each_keywords_move(self, trends_env):
        module, _ = trends_env

        body = _body(module.handler(_event({'group_id': 'coruna'}), None))

        assert [(row['keyword'], row['kpis']['visibility_score']) for row in body['keyword_trends']] == [
            ('hotel coruna spa', 100.0), ('best hotels galicia', 0.0),
        ]

    def test_group_scope_compares_the_keywords_measured_in_both_periods(self, trends_env):
        module, _ = trends_env

        body = _body(module.handler(_event({'group_id': 'coruna'}), None))

        change = body['change']
        assert (change['keywords_compared'], change['deltas']['visibility_score'], body['overall']['improving_count']) == (1, 100.0, 1)

    def test_describes_the_scope_and_window(self, trends_env):
        module, _ = trends_env

        body = _body(module.handler(_event({'group_id': 'coruna', 'days': '90', 'period': 'week'}), None))

        assert {key: body[key] for key in ('period_type', 'days_analyzed', 'since', 'keywords_analyzed', 'keywords_truncated')} == {
            'period_type': 'week', 'days_analyzed': 90, 'since': '2026-01-01T00:00:00.000000Z',
            'keywords_analyzed': 2, 'keywords_truncated': False,
        }

    def test_reads_each_keyword_from_the_window_start(self, trends_env):
        module, tables = trends_env

        module.handler(_event({'keyword': 'hotel coruna spa'}), None)

        assert _sort_condition(tables['search'].query.call_args.kwargs) == ('>=', '2026-01-01T00:00:00.000000Z')

    def test_single_keyword_has_the_same_shape(self, trends_env):
        module, _ = trends_env

        body = _body(module.handler(_event({'keyword': 'hotel coruna spa'}), None))

        assert (body['scope']['kind'], [row['keyword'] for row in body['keyword_trends']]) == ('keyword', ['hotel coruna spa'])

    def test_unscoped_request_covers_the_active_keywords(self, trends_env):
        module, _ = trends_env

        body = _body(module.handler(_event(None), None))

        assert (body['scope']['kind'], body['scope']['keyword_count']) == ('all', 3)

    def test_rejects_two_scopes(self, trends_env):
        module, _ = trends_env

        assert module.handler(_event({'keyword': 'a', 'keyword_ids': 'k1'}), None)['statusCode'] == 400

    def test_defaults_to_thirty_days_per_day(self, trends_env):
        module, _ = trends_env

        body = _body(module.handler(_event({'keyword': 'hotel coruna spa'}), None))

        assert (body['days_analyzed'], body['period_type']) == (30, 'day')

    @pytest.mark.parametrize('params', [{'days': '1'}, {'days': '365'}, {'period': 'month'}, {'period': 'week'}])
    def test_accepts_every_window_and_period_in_range(self, trends_env, params):
        module, _ = trends_env

        assert module.handler(_event({'keyword': 'hotel coruna spa', **params}), None)['statusCode'] == 200

    @pytest.mark.parametrize('params', [{'days': '0'}, {'days': '366'}, {'period': 'fortnight'}])
    def test_rejects_a_window_or_period_out_of_range(self, trends_env, params):
        module, _ = trends_env

        assert module.handler(_event({'keyword': 'hotel coruna spa', **params}), None)['statusCode'] == 400

    def test_reads_a_period_padded_with_spaces_as_that_period(self, trends_env):
        module, _ = trends_env

        body = _body(module.handler(_event({'keyword': 'hotel coruna spa', 'period': ' week '}), None))

        assert body['period_type'] == 'week'

    def test_says_whether_owned_domains_are_configured(self, trends):
        resource, _ = _fake_dynamodb()
        with (
            patch.object(trends, 'dynamodb', resource),
            patch.object(trends, 'get_brand_config', return_value={'first_party_domains': ['hotel-coruna.com']}),
        ):
            body = _body(trends.handler(_event({'keyword': 'hotel coruna spa'}), None))

        assert body['citations_configured'] is True

    def test_counts_a_keyword_that_failed_to_load_as_without_data(self, trends_env):
        module, tables = trends_env

        _fail_reads_of(tables['search'], 'best hotels galicia')
        body = _body(module.handler(_event({'group_id': 'coruna'}), None))

        assert ([row['keyword'] for row in body['keyword_trends']], body['keywords_with_data']) == (['hotel coruna spa'], 1)

    def test_reads_through_the_pooled_scope_resource(self):
        sentinel = MagicMock(name='pooled-dynamodb')
        with patch('shared.scope_params.scoped_dynamodb_resource', return_value=sentinel), patch.dict(os.environ, _ENV):
            module = load_handler_module(_HERE, 'get-historical-trends.py', module_name_for('get-historical-trends.py', '_pooled'))

        assert module.dynamodb is sentinel

    def test_caps_an_unscoped_request_at_twenty_keywords(self, trends):
        many = [{'id': f'k{i}', 'keyword': f'kw {i:02}', 'status': 'active'} for i in range(25)]
        resource, _ = _fake_dynamodb(active=many)
        with patch.object(trends, 'dynamodb', resource), patch.object(trends, 'get_brand_config', return_value={}):
            body = _body(trends.handler(_event(None), None))

        assert (body['keywords_analyzed'], body['keywords_truncated']) == (20, True)


# ---------------------------------------------------------------------------
# /citation-gaps
# ---------------------------------------------------------------------------

GAPS_CONFIG = {
    'tracked_brands': {
        'first_party': ['Hotel Coruna'],
        'competitors': ['Rival Inn'],
    },
}


@pytest.fixture(scope='module')
def gaps():
    return _load('get-citation-gaps.py')


@pytest.fixture(params=[
    pytest.param({'scope': 'all'}, id='all-scope'),
    pytest.param({'group_id': 'coruna'}, id='group-scope'),
])
def missing_first_party_aggregate(gaps, request):
    resource, _ = _fake_dynamodb()
    keyword_analysis = MagicMock()
    enrichment = MagicMock()
    with (
        patch.object(gaps, 'dynamodb', resource),
        patch.object(gaps, 'get_brand_config', return_value={'tracked_brands': {}}),
        patch.object(gaps, '_build_citation_gap_result', keyword_analysis),
        patch.object(gaps, '_enrich_sources', enrichment),
    ):
        response = gaps.handler(_event(request.param), None)
    return response, keyword_analysis, enrichment


class TestCitationGapsScope:
    @staticmethod
    def _analyze(gaps, params: dict, summary: dict) -> tuple[list[str], dict]:
        """Call the handler with `_build_citation_gap_result` recording its keywords.

        Every keyword answers `summary`; returns the keywords analysed, in call
        order, and the decoded response body.
        """
        resource, _ = _fake_dynamodb()
        analyzed: list[str] = []

        def record(keyword, _config):
            analyzed.append(keyword)
            return {'summary': summary, 'gaps': []}

        with (
            patch.object(gaps, 'dynamodb', resource),
            patch.object(gaps, 'get_brand_config', return_value=GAPS_CONFIG),
            patch.object(gaps, '_build_citation_gap_result', record),
        ):
            body = _body(gaps.handler(_event(params), None))
        return analyzed, body

    def test_group_scope_analyzes_every_keyword_of_the_group(self, gaps):
        analyzed, body = self._analyze(
            gaps, {'group_id': 'coruna', 'limit': '1'},
            {'gap_count': 1, 'high_priority_gaps': 0, 'coverage_rate': 50},
        )

        assert sorted(analyzed) == ['best hotels galicia', 'hotel coruna spa']
        assert body['scope']['kind'] == 'group'
        assert body['keywords_analyzed'] == 2

    def test_unscoped_request_keeps_the_limit_over_active_keywords(self, gaps):
        analyzed, body = self._analyze(
            gaps, {'limit': '2'},
            {'gap_count': 0, 'high_priority_gaps': 0, 'coverage_rate': 0},
        )

        assert analyzed == ['best hotels galicia', 'hotel coruna spa']
        assert body['scope']['kind'] == 'all'

    def test_returns_missing_first_party_error_when_aggregate_scope_has_no_first_party_brand(
        self,
        missing_first_party_aggregate,
    ):
        response, _, _ = missing_first_party_aggregate

        assert response['statusCode'] == 200
        assert _body(response) == {'error': 'No first-party brands configured'}

    def test_omits_keyword_analysis_when_aggregate_scope_has_no_first_party_brand(
        self,
        missing_first_party_aggregate,
    ):
        _, keyword_analysis, _ = missing_first_party_aggregate

        keyword_analysis.assert_not_called()

    def test_omits_enrichment_when_aggregate_scope_has_no_first_party_brand(
        self,
        missing_first_party_aggregate,
    ):
        _, _, enrichment = missing_first_party_aggregate

        enrichment.assert_not_called()

    def test_keeps_successful_group_summary_when_another_keyword_has_no_data(self, gaps):
        resource, _ = _fake_dynamodb()
        with (
            patch.object(gaps, 'dynamodb', resource),
            patch.object(gaps, 'get_brand_config', return_value=GAPS_CONFIG),
            patch.object(gaps, '_enrich_sources', MagicMock()),
        ):
            body = _body(gaps.handler(_event({'group_id': 'marino'}), None))

        assert body['keyword_summaries'] == [{
            'keyword': 'best hotels galicia',
            'gap_count': 0,
            'high_priority_gaps': 0,
            'coverage_rate': 0,
        }]


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

        def fake_trends(scope: ReportScope | None, period, days, owned_domains):
            report_scope = present(scope)
            seen['scope'] = report_scope
            seen['owned_domains'] = owned_domains
            return {
                'scope': report_scope.describe(), 'keywords_analyzed': len(report_scope.keywords), 'keywords_with_data': 0,
                'citations_configured': bool(owned_domains), 'latest': {}, 'latest_brands': [], 'trend_data': [], 'change': None,
                'keyword_trends': [],
                'overall': {'improving_count': 0, 'declining_count': 0, 'stable_count': 0},
            }

        def fake_recs(config, keywords=None):
            seen['keywords'] = keywords
            return []

        overview._sibling_cache['trends'] = fake_trends
        overview._sibling_cache['recs'] = fake_recs
        with (
            patch.object(overview, 'dynamodb', resource),
            patch.object(overview, 'get_brand_config', return_value={'first_party_domains': ['hotel-coruna.com']}),
        ):
            body = _body(overview.handler(_event({'group_id': 'coruna'}), None))

        assert (seen['scope'].kind, seen['keywords'], seen['owned_domains']) == (
            'group', ['best hotels galicia', 'hotel coruna spa'], ['hotel-coruna.com'],
        )
        assert (body['scope']['kind'], body['keywords_analyzed'], body['citations_configured']) == ('group', 2, True)

    def test_rejects_two_scopes(self, overview):
        resource, _ = _fake_dynamodb()
        with patch.object(overview, 'dynamodb', resource):
            response = overview.handler(_event({'group_id': 'coruna', 'keyword_ids': 'k1'}), None)

        assert response['statusCode'] == 400



class PartitionFailure(Exception):
    """A SearchResults partition that cannot be read."""


class TestVisibilityGroupSurvivesAFailedKeyword:
    def test_reports_a_keyword_that_failed_to_load_as_without_data(self, visibility_env):
        module, tables = visibility_env

        _fail_reads_of(tables['search'], 'best hotels galicia')
        body = _body(module.handler(_event({'group_id': 'coruna'}), None))

        assert {row['keyword']: row['has_data'] for row in body['keywords']} == {
            'best hotels galicia': False,
            'hotel coruna spa': True,
        }

    def test_reads_through_the_pooled_scope_resource(self):
        sentinel = MagicMock(name='pooled-dynamodb')
        with patch('shared.scope_params.scoped_dynamodb_resource', return_value=sentinel), patch.dict(os.environ, _ENV):
            module = load_handler_module(_HERE, 'get-visibility-metrics.py', module_name_for('get-visibility-metrics.py', '_pooled'))

        assert module.dynamodb is sentinel
