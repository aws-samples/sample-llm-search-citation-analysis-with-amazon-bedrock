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

import os
from unittest.mock import MagicMock, patch

import pytest

from shared.scope_params import ReportScope
from testing.assertions import present
from testing.events import parse_response
from testing.module_loader import load_handler_module, module_name_for
from testing.report_scope_fixtures import (
    OLD_TS,
    RUN_TS,
    SCOPE_ENV,
    aggregated_brand,
    fail_reads_of,
    load_scoped_handler,
    scoped_report,
)
from testing.report_scope_fixtures import brand as _brand
from testing.report_scope_fixtures import result as _result
from testing.search_results_fixtures import sort_condition

_HERE = os.path.dirname(os.path.abspath(__file__))


def _load(filename: str):
    return load_scoped_handler(_HERE, filename)


# ---------------------------------------------------------------------------
# /visibility
# ---------------------------------------------------------------------------

@pytest.fixture(scope='module')
def visibility():
    return _load('get-visibility-metrics.py')


@pytest.fixture
def visibility_env(visibility):
    with scoped_report(visibility, {'first_party_domains': ['hotel-coruna.com']}) as report:
        yield report


class TestVisibilityScope:
    def test_requires_a_scope(self, visibility_env):
        status, body = parse_response(visibility_env.call(None))

        assert (status, body['field']) == (400, 'keyword')

    def test_rejects_two_scopes(self, visibility_env):
        status, body = parse_response(visibility_env.call({'keyword': 'a', 'group_id': 'coruna'}))

        assert status == 400
        assert 'only one of' in body['error']

    def test_single_keyword_measures_its_latest_run(self, visibility_env):
        body = visibility_env.body({'keyword': 'hotel coruna spa'})

        kpis = body['kpis']
        assert (body['timestamp'], kpis['answers'], kpis['mention_rate'], kpis['share_of_voice']) == (RUN_TS, 2, 100.0, 66.7)

    def test_single_keyword_answers_one_keyword_row(self, visibility_env):
        body = visibility_env.body({'keyword': 'hotel coruna spa'})

        assert [(row['keyword'], row['timestamp'], row['has_data']) for row in body['keywords']] == [('hotel coruna spa', RUN_TS, True)]

    def test_reads_only_the_latest_run_without_the_llm_text(self, visibility_env):
        visibility_env.call({'keyword': 'hotel coruna spa'})

        run_query = visibility_env.tables['search'].query.call_args.kwargs
        assert (*sort_condition(run_query), 'response' in run_query['ProjectionExpression']) == (
            'begins_with', f'{RUN_TS}#', False,
        )

    def test_group_scope_pools_the_answers_of_every_keyword(self, visibility_env):
        body = visibility_env.body({'group_id': 'coruna'})

        kpis = body['kpis']
        assert (body['scope']['kind'], kpis['answers'], kpis['mention_rate'], kpis['keyword_coverage']) == ('group', 3, 66.7, 50.0)

    def test_group_scope_reports_each_keywords_kpis(self, visibility_env):
        body = visibility_env.body({'group_id': 'coruna'})

        rows = {row['keyword']: row for row in body['keywords']}
        assert (rows['hotel coruna spa']['kpis']['mentions'], rows['best hotels galicia']['kpis']['mentions']) == (2, 0)

    def test_group_scope_ranks_brands_across_keywords(self, visibility_env):
        body = visibility_env.body({'group_id': 'coruna'})

        rival = next(brand for brand in body['brands'] if brand['name'] == 'Rival Inn')
        assert (rival['keywords'], rival['classification'], rival['mentions']) == (2, 'competitor', 2)

    def test_group_scope_reports_keywords_without_data(self, visibility_env):
        body = visibility_env.body({'group_id': 'marino'})

        rows = {row['keyword']: row for row in body['keywords']}
        assert (rows['hotel marino beach']['has_data'], rows['hotel marino beach']['kpis']) == (False, None)
        assert (body['keywords_analyzed'], body['keywords_with_data']) == (2, 1)

    def test_keyword_ids_scope_resolves_to_the_selected_keywords(self, visibility_env):
        body = visibility_env.body({'keyword_ids': 'k1'})

        assert body['scope']['kind'] == 'keywords'
        assert [row['keyword'] for row in body['keywords']] == ['hotel coruna spa']

    def test_scope_all_summarises_every_active_keyword(self, visibility_env):
        body = visibility_env.body({'scope': 'all'})

        assert body['scope']['kind'] == 'all'
        assert body['keywords_analyzed'] == 3

    def test_says_whether_owned_domains_are_configured(self, visibility_env):
        assert visibility_env.body({'keyword': 'hotel coruna spa'})['citations_configured'] is True

    def test_keeps_one_personas_answers(self, visibility):
        rows = {'hotel coruna spa': [
            _result('hotel coruna spa', 'openai', [_brand('Hotel Coruna', 'first_party')], query_prompt_id='family'),
            _result('hotel coruna spa', 'gemini', [_brand('Rival Inn', 'competitor')]),
        ]}
        with scoped_report(visibility, {}, search_rows=rows) as report:
            body = report.body({'keyword': 'hotel coruna spa', 'query_prompt_id': 'family'})

        assert (body['kpis']['answers'], body['kpis']['mention_rate']) == (1, 100.0)

    def test_narrows_the_leaderboard_to_the_requested_brand(self, visibility_env):
        body = visibility_env.body({'keyword': 'hotel coruna spa', 'brand': 'rival'})

        assert ([brand['name'] for brand in body['brands']], body['kpis']['mention_rate']) == (['Rival Inn'], 100.0)

    def test_compares_the_latest_run_with_the_previous_one(self, visibility_env):
        change = visibility_env.body({'keyword': 'hotel coruna spa'})['change']

        assert (change['keywords_compared'], change['deltas']['mention_rate'], change['trends']['visibility_score']) == (
            1, 100.0, 'improving',
        )

    def test_has_no_change_for_keywords_analysed_once(self, visibility_env):
        assert visibility_env.body({'keyword': 'best hotels galicia'})['change'] is None


# ---------------------------------------------------------------------------
# /brand-mentions
# ---------------------------------------------------------------------------

@pytest.fixture(scope='module')
def brand_mentions():
    return _load('get-brand-mentions.py')


@pytest.fixture
def brand_mentions_env(brand_mentions):
    with scoped_report(brand_mentions, {'tracked_brands': {}}) as report:
        yield report


class TestBrandMentionsScope:
    @pytest.fixture
    def latest_coruna_hotel_brand(self, brand_mentions_env):
        body = brand_mentions_env.body({'group_id': 'coruna'})
        return aggregated_brand(body, 'Hotel Coruna')

    def test_requires_a_scope(self, brand_mentions_env):
        assert brand_mentions_env.call(None)['statusCode'] == 400

    def test_single_keyword_keeps_per_provider_responses(self, brand_mentions_env):
        body = brand_mentions_env.body({'keyword': 'hotel coruna spa'})

        assert body['keyword'] == 'hotel coruna spa'
        assert [entry['provider'] for entry in body['by_provider']] == ['openai', 'gemini']

    def test_single_keyword_returns_the_requested_historical_run(self, brand_mentions_env):
        body = brand_mentions_env.body({'keyword': 'hotel coruna spa', 'timestamp': OLD_TS})

        assert body['timestamp'] == OLD_TS
        assert [entry['provider'] for entry in body['by_provider']] == ['openai']
        assert body['aggregated']['brands'][0]['total_mentions'] == 5

    def test_single_keyword_uses_every_page_to_select_the_latest_run(self, brand_mentions_env):
        brand_mentions_env.tables['search'].query.side_effect = [
            {
                'Items': [_result('hotel coruna spa', 'openai', [_brand('Old Brand', 'competitor')], timestamp=OLD_TS)],
                'LastEvaluatedKey': {'keyword': 'hotel coruna spa', 'timestamp_provider': f'{OLD_TS}_openai'},
            },
            {'Items': [_result('hotel coruna spa', 'gemini', [_brand('Latest Brand', 'first_party')])]},
        ]

        body = brand_mentions_env.body({'keyword': 'hotel coruna spa'})

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
        brand_mentions_env.tables['search'].query.side_effect = [{
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

        body = brand_mentions_env.body({'keyword': 'hotel coruna spa', **filter_params})

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

    @pytest.mark.parametrize(('filter_params', 'expected_providers'), [
        pytest.param({'query_prompt_id': 'family'}, ['openai'], id='named-persona'),
        pytest.param({'query_prompt_id': 'default'}, ['gemini'], id='row-without-persona-is-default'),
        pytest.param({'provider': 'gemini'}, ['gemini'], id='provider'),
    ])
    def test_single_keyword_keeps_the_latest_run_rows_matching_the_filter(
        self, brand_mentions_env, filter_params, expected_providers,
    ):
        unlabelled = _result('hotel coruna spa', 'gemini', [_brand('Hotel Coruna', 'first_party')])
        del unlabelled['query_prompt_id']
        brand_mentions_env.tables['search'].query.side_effect = [{'Items': [
            _result('hotel coruna spa', 'openai', [_brand('Rival Inn', 'competitor')], query_prompt_id='family'),
            unlabelled,
        ]}]

        body = brand_mentions_env.body({'keyword': 'hotel coruna spa', **filter_params})

        assert [entry['provider'] for entry in body['by_provider']] == expected_providers

    def test_group_scope_aggregates_the_latest_run_of_every_keyword(self, brand_mentions_env):
        body = brand_mentions_env.body({'group_id': 'coruna'})

        assert body['scope']['kind'] == 'group'
        assert body['by_provider'] == []
        assert (body['keywords_analyzed'], body['keywords_with_data']) == (2, 2)
        rival = aggregated_brand(body, 'Rival Inn')
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
        body = brand_mentions_env.body({**scope_params, 'timestamp': OLD_TS})

        rival = aggregated_brand(body, 'Rival Inn')
        assert body['timestamp'] == OLD_TS
        assert body['keywords_with_data'] == 1
        assert rival['total_mentions'] == 5

    def test_available_runs_are_distinct_and_newest_first(self, brand_mentions_env):
        body = brand_mentions_env.body({'group_id': 'coruna'})

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

    def test_appearances_carry_the_sentiment_quote_next_to_the_reason(self, brand_mentions):
        brand = {**_brand('Hotel Coruna', 'first_party', sentiment='negative'),
                 'sentiment_quote': 'Rooms feel dated.', 'sentiment_reason': 'The answer warns about dated rooms.'}
        rows = {'hotel coruna spa': [_result('hotel coruna spa', 'openai', [brand])]}
        with scoped_report(brand_mentions, {'tracked_brands': {}}, search_rows=rows) as report:
            body = report.body({'group_id': 'coruna'})

        appearance = body['aggregated']['brands'][0]['appearances'][0]
        assert (appearance['sentiment_quote'], appearance['sentiment_reason']) == (
            'Rooms feel dated.', 'The answer warns about dated rooms.',
        )

    def test_group_scope_reads_projections_without_the_llm_text(self, brand_mentions_env):
        brand_mentions_env.call({'group_id': 'coruna'})

        for call in brand_mentions_env.tables['search'].query.call_args_list:
            assert 'response' not in call.kwargs['ProjectionExpression']

    def test_group_scope_projects_metadata_for_appearance_models(self, brand_mentions_env):
        brand_mentions_env.call({'group_id': 'coruna'})

        assert all('metadata' in call.kwargs['ProjectionExpression'] for call in brand_mentions_env.tables['search'].query.call_args_list)

    def test_group_scope_applies_the_classification_filter(self, brand_mentions_env):
        body = brand_mentions_env.body({'group_id': 'coruna', 'classification': 'first_party'})

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
    with (
        scoped_report(citations, citation_rows=CITATION_ROWS) as report,
        patch.object(citations, 'citations_table', report.tables['citations']),
        patch.object(citations, '_get_tracked_brands', return_value=[]),
    ):
        yield report


class TestCitationsScope:
    def test_unscoped_request_scans_the_whole_table(self, citations_env):
        body = citations_env.body(None)

        citations_env.tables['citations'].scan.assert_called_once()
        assert body['scope'] is None
        assert body['total_citations'] == 4

    def test_group_scope_queries_one_partition_per_keyword_instead_of_scanning(self, citations_env):
        body = citations_env.body({'group_id': 'coruna'})

        citations_env.tables['citations'].scan.assert_not_called()
        queried = sorted(call.kwargs['KeyConditionExpression'].get_expression()['values'][1] for call in citations_env.tables['citations'].query.call_args_list)
        assert queried == ['best hotels galicia', 'hotel coruna spa']
        assert body['scope']['kind'] == 'group'
        assert [entry['url'] for entry in body['top_urls']] == ['https://a.com/x', 'https://b.com/y']

    def test_group_scope_counts_keywords_per_url_inside_the_scope_only(self, citations_env):
        body = citations_env.body({'group_id': 'coruna'})

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
        with (
            scoped_report(trends, {}) as report,
            patch.object(trends, 'history_since', return_value='2026-01-01T00:00:00.000000Z'),
        ):
            yield report

    def test_group_scope_returns_the_series_of_the_pooled_answers(self, trends_env):
        body = trends_env.body({'group_id': 'coruna'})

        assert [(point['period'], point['keywords_with_data'], point['kpis']['answers']) for point in body['trend_data']] == [
            ('2026-09-10', 1, 1), ('2026-09-18', 2, 3),
        ]

    def test_group_scope_reports_each_keywords_move(self, trends_env):
        body = trends_env.body({'group_id': 'coruna'})

        assert [(row['keyword'], row['kpis']['visibility_score']) for row in body['keyword_trends']] == [
            ('hotel coruna spa', 100.0), ('best hotels galicia', 0.0),
        ]

    def test_group_scope_compares_the_keywords_measured_in_both_periods(self, trends_env):
        body = trends_env.body({'group_id': 'coruna'})

        change = body['change']
        assert (change['keywords_compared'], change['deltas']['visibility_score'], body['overall']['improving_count']) == (1, 100.0, 1)

    def test_describes_the_scope_and_window(self, trends_env):
        body = trends_env.body({'group_id': 'coruna', 'days': '90', 'period': 'week'})

        assert {key: body[key] for key in ('period_type', 'days_analyzed', 'since', 'keywords_analyzed', 'keywords_truncated')} == {
            'period_type': 'week', 'days_analyzed': 90, 'since': '2026-01-01T00:00:00.000000Z',
            'keywords_analyzed': 2, 'keywords_truncated': False,
        }

    def test_reads_each_keyword_from_the_window_start(self, trends_env):
        trends_env.call({'keyword': 'hotel coruna spa'})

        assert sort_condition(trends_env.tables['search'].query.call_args.kwargs) == ('>=', '2026-01-01T00:00:00.000000Z')

    def test_single_keyword_has_the_same_shape(self, trends_env):
        body = trends_env.body({'keyword': 'hotel coruna spa'})

        assert (body['scope']['kind'], [row['keyword'] for row in body['keyword_trends']]) == ('keyword', ['hotel coruna spa'])

    def test_unscoped_request_covers_the_active_keywords(self, trends_env):
        body = trends_env.body(None)

        assert (body['scope']['kind'], body['scope']['keyword_count']) == ('all', 3)

    def test_rejects_two_scopes(self, trends_env):
        assert trends_env.call({'keyword': 'a', 'keyword_ids': 'k1'})['statusCode'] == 400

    def test_defaults_to_thirty_days_per_day(self, trends_env):
        body = trends_env.body({'keyword': 'hotel coruna spa'})

        assert (body['days_analyzed'], body['period_type']) == (30, 'day')

    @pytest.mark.parametrize('params', [{'days': '1'}, {'days': '365'}, {'period': 'month'}, {'period': 'week'}])
    def test_accepts_every_window_and_period_in_range(self, trends_env, params):
        assert trends_env.call({'keyword': 'hotel coruna spa', **params})['statusCode'] == 200

    @pytest.mark.parametrize('params', [{'days': '0'}, {'days': '366'}, {'period': 'fortnight'}])
    def test_rejects_a_window_or_period_out_of_range(self, trends_env, params):
        assert trends_env.call({'keyword': 'hotel coruna spa', **params})['statusCode'] == 400

    def test_reads_a_period_padded_with_spaces_as_that_period(self, trends_env):
        body = trends_env.body({'keyword': 'hotel coruna spa', 'period': ' week '})

        assert body['period_type'] == 'week'

    def test_says_whether_owned_domains_are_configured(self, trends):
        with scoped_report(trends, {'first_party_domains': ['hotel-coruna.com']}) as report:
            body = report.body({'keyword': 'hotel coruna spa'})

        assert body['citations_configured'] is True

    def test_counts_a_keyword_that_failed_to_load_as_without_data(self, trends_env):
        fail_reads_of(trends_env.tables['search'], 'best hotels galicia')
        body = trends_env.body({'group_id': 'coruna'})

        assert ([row['keyword'] for row in body['keyword_trends']], body['keywords_with_data']) == (['hotel coruna spa'], 1)

    def test_caps_an_unscoped_request_at_twenty_keywords(self, trends):
        many = [{'id': f'k{i}', 'keyword': f'kw {i:02}', 'status': 'active'} for i in range(25)]
        with scoped_report(trends, {}, active=many) as report:
            body = report.body(None)

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
    keyword_analysis = MagicMock()
    enrichment = MagicMock()
    with (
        scoped_report(gaps, {'tracked_brands': {}}) as report,
        patch.object(gaps, '_build_citation_gap_result', keyword_analysis),
        patch.object(gaps, '_enrich_sources', enrichment),
    ):
        response = report.call(request.param)
    return response, keyword_analysis, enrichment


class TestCitationGapsScope:
    @staticmethod
    def _analyze(
        gaps, params: dict, summary: dict, keyword_gaps: dict[str, list[dict]] | None = None,
    ) -> tuple[list[str], dict]:
        """Call the handler with `_build_citation_gap_result` recording its keywords.

        Every keyword answers `summary` and its entry of `keyword_gaps` (none
        by default), with source enrichment stubbed out; returns the keywords
        analysed, in call order, and the decoded response body.
        """
        analyzed: list[str] = []

        def record(keyword, _config):
            analyzed.append(keyword)
            return {'summary': summary, 'gaps': (keyword_gaps or {}).get(keyword, [])}

        with (
            scoped_report(gaps, GAPS_CONFIG) as report,
            patch.object(gaps, '_build_citation_gap_result', record),
            patch.object(gaps, '_enrich_sources', MagicMock()),
        ):
            body = report.body(params)
        return analyzed, body

    def test_group_scope_ranks_top_gaps_by_priority_before_citation_count(self, gaps):
        _, body = self._analyze(
            gaps, {'group_id': 'coruna'},
            {'gap_count': 1, 'high_priority_gaps': 0, 'coverage_rate': 0},
            {
                'hotel coruna spa': [{'url': 'https://low.example', 'priority': 'low', 'citation_count': 9}],
                'best hotels galicia': [{'url': 'https://high.example', 'priority': 'high', 'citation_count': 1}],
            },
        )

        assert [gap['url'] for gap in body['top_gaps']] == ['https://high.example', 'https://low.example']

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

        assert parse_response(response) == (200, {'error': 'No first-party brands configured'})

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
        with scoped_report(gaps, GAPS_CONFIG) as report, patch.object(gaps, '_enrich_sources', MagicMock()):
            body = report.body({'group_id': 'marino'})

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
        with scoped_report(overview, {'first_party_domains': ['hotel-coruna.com']}) as report:
            body = report.body({'group_id': 'coruna'})

        assert (seen['scope'].kind, seen['keywords'], seen['owned_domains']) == (
            'group', ['best hotels galicia', 'hotel coruna spa'], ['hotel-coruna.com'],
        )
        assert (body['scope']['kind'], body['keywords_analyzed'], body['citations_configured']) == ('group', 2, True)

    def test_rejects_two_scopes(self, overview):
        with scoped_report(overview) as report:
            assert report.call({'group_id': 'coruna', 'keyword_ids': 'k1'})['statusCode'] == 400


class TestVisibilityGroupSurvivesAFailedKeyword:
    def test_reports_a_keyword_that_failed_to_load_as_without_data(self, visibility_env):
        fail_reads_of(visibility_env.tables['search'], 'best hotels galicia')
        body = visibility_env.body({'group_id': 'coruna'})

        assert {row['keyword']: row['has_data'] for row in body['keywords']} == {
            'best hotels galicia': False,
            'hotel coruna spa': True,
        }


@pytest.mark.parametrize('filename', ['get-historical-trends.py', 'get-visibility-metrics.py'])
def test_reads_through_the_pooled_scope_resource(filename):
    sentinel = MagicMock(name='pooled-dynamodb')
    with patch('shared.scope_params.scoped_dynamodb_resource', return_value=sentinel), patch.dict(os.environ, SCOPE_ENV):
        module = load_handler_module(_HERE, filename, module_name_for(filename, '_pooled'))

    assert module.dynamodb is sentinel
