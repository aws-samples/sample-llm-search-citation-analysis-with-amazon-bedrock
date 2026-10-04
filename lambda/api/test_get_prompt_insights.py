"""
Characterization tests for get-prompt-insights.py.

`analyze_prompt_brand_correlation` had no tests when it was split into helpers
to fit under the ruff complexity ceilings. These pin the behaviour the Prompt
Insights dashboard view relies on: which keywords are queried, how one run's
brand mentions are tallied per side, the winning / neutral / losing /
opportunity rules with their exact scores, the ordering and the top-20 cap of
each bucket, the summary maths, and the `type` / `limit` handling in `handler`.

The DynamoDB tables are `MagicMock` stubs from `testing.dynamodb_stubs`: the
Keywords table answers `scan` with the keyword list, the SearchResults table
answers each keyword's `query` with the rows a test stages for it.
"""

from __future__ import annotations

import os
from collections.abc import Collection
from decimal import Decimal
from types import ModuleType
from typing import Any
from unittest.mock import MagicMock, call, patch

import pytest
from boto3.dynamodb.conditions import Key

from testing.client_errors import throttled
from testing.dynamodb_stubs import fake_dynamodb_resource, fake_table
from testing.events import api_gateway_event, parse_response
from testing.handler_fixtures import handler_fixture

_API_DIR = os.path.dirname(os.path.abspath(__file__))

insights_module = handler_fixture(
    _API_DIR,
    'get-prompt-insights.py',
    'get_prompt_insights_under_test',
    env={
        'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-search-results',
        'DYNAMODB_TABLE_KEYWORDS': 'test-keywords',
        'CORS_ORIGIN_PARAM': '',
    },
)

_EARLIER = '2026-05-01T08:00:00Z'
_LATEST = '2026-05-02T08:00:00Z'
_CONFIG = {'tracked_brands': {'first_party': ['Acme Running'], 'competitors': ['Nike', 'Hoka']}}
_BUCKETS = ('winning_prompts', 'losing_prompts', 'opportunity_prompts')


# --- Fixtures: rows as the SearchResults table returns them ------------------


def _brand(classification: str, rank: int | Decimal | None = None, mentions: int | Decimal = 1) -> dict[str, Any]:
    """One entry of a row's `brands` list; `rank=None` leaves the key out, as unranked mentions arrive."""
    brand: dict[str, Any] = {'classification': classification, 'mention_count': mentions}
    if rank is not None:
        brand['rank'] = rank
    return brand


_FIRST_PARTY_TOP = _brand('first_party', 1)
_COMPETITOR_TOP = _brand('competitor', 1)


def _result(keyword: str, provider: str, brands: list[dict[str, Any]], timestamp: str = _LATEST) -> dict[str, Any]:
    """One SearchResults row: what `provider` answered for `keyword` in the run stamped `timestamp`."""
    return {'keyword': keyword, 'provider': provider, 'timestamp': timestamp, 'brands': brands}


def _run(keyword: str, *brands: dict[str, Any], provider: str = 'openai') -> dict[str, list[dict[str, Any]]]:
    """The latest run of `keyword` answered by a single provider, keyed the way `_analyze` stages rows."""
    return {keyword: [_result(keyword, provider, list(brands))]}


def _answers(keyword: str, **brands_by_provider: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """The latest run of `keyword` with one row per provider, keyed the way `_analyze` stages rows."""
    return {keyword: [_result(keyword, provider, brands) for provider, brands in brands_by_provider.items()]}


def _first_party_wins(keywords: list[str]) -> dict[str, list[dict[str, Any]]]:
    """Every keyword answered by openai with the first-party brand at rank 1."""
    return {keyword: [_result(keyword, 'openai', [_FIRST_PARTY_TOP])] for keyword in keywords}


def _mixed_results() -> dict[str, list[dict[str, Any]]]:
    """One keyword per bucket: a win, a loss and an opportunity."""
    return {
        **_run('best running shoes', _FIRST_PARTY_TOP),
        **_run('trail running shoes', _brand('first_party', 7)),
        **_run('marathon training plan', _COMPETITOR_TOP),
    }


def _two_per_bucket_results() -> dict[str, list[dict[str, Any]]]:
    """Two keywords per bucket, the first of each pair scoring higher."""
    return {
        **_run('best running shoes', _FIRST_PARTY_TOP),
        **_run('trail running shoes', _brand('first_party', 2)),
        **_run('marathon training plan', _brand('first_party', 7)),
        **_run('lightweight racing flats', _brand('first_party', 6)),
        **_run('running shoe reviews', _brand('competitor', 1, mentions=2)),
        **_run('seo audit checklist', _COMPETITOR_TOP),
    }


# --- Stubs and invocation ----------------------------------------------------


def _queried_keyword(**kwargs: Any) -> str:
    """The partition key a `query(KeyConditionExpression=Key('keyword').eq(...))` call asks for."""
    _, keyword = kwargs['KeyConditionExpression'].get_expression()['values']
    return keyword


def _search_table(results_by_keyword: dict[str, list[dict[str, Any]]], failing: Collection[str]) -> MagicMock:
    """A SearchResults table answering each keyword's query with its rows; keywords in `failing` throttle."""
    def query(**kwargs: Any) -> dict[str, Any]:
        keyword = _queried_keyword(**kwargs)
        if keyword in failing:
            raise throttled('Query')
        return {'Items': results_by_keyword.get(keyword, [])}

    table = MagicMock()
    table.query.side_effect = query
    return table


def _dynamodb(
    module: ModuleType,
    keywords: list[str],
    results_by_keyword: dict[str, list[dict[str, Any]]],
    failing: Collection[str] = (),
) -> MagicMock:
    """A resource whose Keywords table lists `keywords` and whose SearchResults table serves `results_by_keyword`."""
    keywords_table = fake_table(scan={'Items': [{'keyword': keyword} for keyword in keywords]})
    return fake_dynamodb_resource(by_name={
        module.KEYWORDS_TABLE: keywords_table,
        module.SEARCH_RESULTS_TABLE: _search_table(results_by_keyword, failing),
    })


def _analyze(
    module: ModuleType,
    results_by_keyword: dict[str, list[dict[str, Any]]],
    *,
    keywords: list[str] | None = None,
    config: dict[str, Any] = _CONFIG,
    failing: Collection[str] = (),
) -> dict[str, Any]:
    """Run the analysis over a Keywords table listing `keywords` (default: the staged keywords, in order)."""
    keywords = list(results_by_keyword) if keywords is None else keywords
    with patch.object(module, 'dynamodb', _dynamodb(module, keywords, results_by_keyword, failing)):
        return module.analyze_prompt_brand_correlation(config)


def _get_insights(
    module: ModuleType,
    results_by_keyword: dict[str, list[dict[str, Any]]],
    query: dict[str, str] | None = None,
    config: dict[str, Any] = _CONFIG,
) -> tuple[int, Any]:
    """GET /api/prompt-insights with `query` against the staged rows: `(status, decoded body)`."""
    event = api_gateway_event('GET', '/api/prompt-insights', query=query)
    with (
        patch.object(module, 'dynamodb', _dynamodb(module, list(results_by_keyword), results_by_keyword)),
        patch.object(module, 'get_brand_config', return_value=config),
    ):
        return parse_response(module.handler(event, None))


def _search_queries(module: ModuleType, keywords: list[str]) -> list[Any]:
    """The SearchResults queries an analysis over a Keywords table listing `keywords` (and no rows) sends."""
    resource = _dynamodb(module, keywords, {})
    with patch.object(module, 'dynamodb', resource):
        module.analyze_prompt_brand_correlation(_CONFIG)
    return resource.Table(module.SEARCH_RESULTS_TABLE).query.call_args_list


def _winning_first_party(module: ModuleType, results_by_keyword: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    """The first-party tally of the top winning prompt of an analysis over the staged rows."""
    return _analyze(module, results_by_keyword)['winning_prompts'][0]['first_party']


def _statuses(result: dict[str, Any]) -> dict[str, list[str]]:
    """The `status` of every prompt, per bucket."""
    return {bucket: [prompt['status'] for prompt in result[bucket]] for bucket in _BUCKETS}


def _only_prompt(result: dict[str, Any], bucket: str) -> dict[str, Any]:
    """The single prompt in `bucket`, asserting the other buckets are empty."""
    assert {name: len(result[name]) for name in _BUCKETS} == {name: int(name == bucket) for name in _BUCKETS}
    return result[bucket][0]


class TestConfigurationGuards:
    @pytest.mark.parametrize('config', [
        {},
        {'tracked_brands': {}},
        {'tracked_brands': {'first_party': [], 'competitors': ['Nike']}},
    ])
    def test_returns_a_first_party_error_when_no_first_party_brand_is_configured(self, insights_module, config):
        result = _analyze(insights_module, _run('best running shoes', _FIRST_PARTY_TOP), config=config)

        assert result == {'error': 'No first-party brands configured'}

    def test_returns_a_keywords_error_when_the_keywords_table_is_empty(self, insights_module):
        result = _analyze(insights_module, {}, keywords=[])

        assert result == {'error': 'No keywords configured'}

    def test_returns_a_keywords_error_when_the_keywords_scan_fails(self, insights_module):
        keywords_table = MagicMock()
        keywords_table.scan.side_effect = throttled('Scan')
        resource = fake_dynamodb_resource(by_name={insights_module.KEYWORDS_TABLE: keywords_table})

        with patch.object(insights_module, 'dynamodb', resource):
            result = insights_module.analyze_prompt_brand_correlation(_CONFIG)

        assert result == {'error': 'No keywords configured'}


class TestFetchingSearchResults:
    def test_queries_each_keyword_for_its_twenty_most_recent_rows(self, insights_module):
        keywords = ['best running shoes', 'trail running shoes']

        assert _search_queries(insights_module, keywords) == [
            call(KeyConditionExpression=Key('keyword').eq(keyword), ScanIndexForward=False, Limit=20)
            for keyword in keywords
        ]

    def test_queries_only_the_first_fifty_keywords(self, insights_module):
        keywords = [f'keyword {index:02d}' for index in range(60)]

        queries = _search_queries(insights_module, keywords)

        assert [_queried_keyword(**query.kwargs) for query in queries] == keywords[:50]

    def test_skips_a_keyword_whose_query_fails_and_analyzes_the_rest(self, insights_module):
        results = {**_run('best running shoes', _FIRST_PARTY_TOP), **_run('trail running shoes', _FIRST_PARTY_TOP)}

        result = _analyze(insights_module, results, failing={'best running shoes'})

        assert [prompt['keyword'] for prompt in result['winning_prompts']] == ['trail running shoes']
        assert result['total_prompts_analyzed'] == 1

    def test_reports_zero_prompts_when_no_keyword_has_search_results(self, insights_module):
        result = _analyze(insights_module, {'best running shoes': []})

        assert result == {
            'total_prompts_analyzed': 0,
            'winning_prompts': [],
            'losing_prompts': [],
            'opportunity_prompts': [],
            'summary': {'winning_count': 0, 'losing_count': 0, 'opportunity_count': 0, 'win_rate': 0},
        }


class TestLatestRunSelection:
    def test_analyzes_only_the_most_recent_run_of_a_keyword(self, insights_module):
        rows = [
            _result('best running shoes', 'openai', [_FIRST_PARTY_TOP], timestamp=_EARLIER),
            _result('best running shoes', 'gemini', [_FIRST_PARTY_TOP], timestamp=_EARLIER),
            _result('best running shoes', 'openai', [_COMPETITOR_TOP]),
        ]

        result = _analyze(insights_module, {'best running shoes': rows})

        prompt = _only_prompt(result, 'opportunity_prompts')
        assert (prompt['timestamp'], prompt['total_providers'], prompt['first_party']['mentions']) == (_LATEST, 1, 0)

    def test_treats_rows_without_a_timestamp_as_absent_from_the_latest_run(self, insights_module):
        row = {'keyword': 'best running shoes', 'provider': 'openai', 'brands': [_FIRST_PARTY_TOP]}

        result = _analyze(insights_module, {'best running shoes': [row]})

        prompt = _only_prompt(result, 'losing_prompts')
        assert (prompt['timestamp'], prompt['total_providers'], prompt['first_party']['mentions']) == ('', 0, 0)


class TestBrandTallies:
    def test_builds_the_full_prompt_record_for_a_first_party_win(self, insights_module):
        result = _analyze(insights_module, _run('best running shoes', _FIRST_PARTY_TOP))

        assert result['winning_prompts'] == [{
            'keyword': 'best running shoes',
            'timestamp': _LATEST,
            'first_party': {'mentions': 1, 'best_rank': 1, 'provider_coverage': 100.0, 'providers': ['openai']},
            'competitors': {'mentions': 0, 'best_rank': None, 'provider_coverage': 0.0, 'providers': []},
            'total_providers': 1,
            'status': 'winning',
            'score': 82.0,
        }]

    def test_builds_the_full_prompt_record_for_a_competitor_only_answer(self, insights_module):
        result = _analyze(
            insights_module, _run('best running shoes', _brand('competitor', 2, mentions=2), provider='perplexity')
        )

        assert result['opportunity_prompts'] == [{
            'keyword': 'best running shoes',
            'timestamp': _LATEST,
            'first_party': {'mentions': 0, 'best_rank': None, 'provider_coverage': 0.0, 'providers': []},
            'competitors': {'mentions': 2, 'best_rank': 2, 'provider_coverage': 100.0, 'providers': ['perplexity']},
            'total_providers': 1,
            'status': 'opportunity',
            'opportunity_score': 60.0,
        }]

    def test_sums_mentions_and_keeps_the_best_rank_across_providers(self, insights_module):
        rows = _answers(
            'best running shoes',
            openai=[_brand('first_party', 3, mentions=2)], gemini=[_FIRST_PARTY_TOP], perplexity=[_COMPETITOR_TOP],
        )

        first_party = _winning_first_party(insights_module, rows)
        assert (first_party['mentions'], first_party['best_rank']) == (3, 1)
        assert sorted(first_party['providers']) == ['gemini', 'openai']

    def test_reports_coverage_as_the_percentage_of_providers_mentioning_each_side(self, insights_module):
        rows = _answers('best running shoes', openai=[_FIRST_PARTY_TOP], gemini=[_FIRST_PARTY_TOP], perplexity=[_COMPETITOR_TOP])

        prompt = _analyze(insights_module, rows)['winning_prompts'][0]
        coverage = (prompt['first_party']['provider_coverage'], prompt['competitors']['provider_coverage'])
        assert (coverage, prompt['total_providers']) == ((66.7, 33.3), 3)

    def test_sums_several_first_party_brands_named_by_one_provider(self, insights_module):
        brands = (_brand('first_party', 2, mentions=2), _brand('first_party', 5, mentions=1))

        first_party = _winning_first_party(insights_module, _run('best running shoes', *brands))

        assert (first_party['mentions'], first_party['best_rank'], first_party['providers']) == (3, 2, ['openai'])

    def test_reads_decimal_ranks_and_mention_counts_as_integers(self, insights_module):
        rows = _run('best running shoes', _brand('first_party', Decimal('2'), Decimal('3')))

        first_party = _winning_first_party(insights_module, rows)

        assert (first_party['mentions'], first_party['best_rank']) == (3, 2)
        assert {type(first_party['mentions']), type(first_party['best_rank'])} == {int}

    def test_ignores_brands_classified_as_other_or_left_unclassified(self, insights_module):
        brands = (_brand('other', 1, mentions=4), {'rank': 1, 'mention_count': 2})

        result = _analyze(insights_module, _run('best running shoes', *brands))

        prompt = _only_prompt(result, 'losing_prompts')
        assert (prompt['first_party']['mentions'], prompt['competitors']['mentions']) == (0, 0)

    def test_counts_a_brand_without_a_mention_count_as_one_mention(self, insights_module):
        result = _analyze(insights_module, _run('best running shoes', {'classification': 'first_party', 'rank': 1}))

        assert result['winning_prompts'][0]['first_party']['mentions'] == 1

    def test_reports_no_best_rank_when_first_party_is_mentioned_without_a_rank(self, insights_module):
        result = _analyze(insights_module, _run('best running shoes', _brand('first_party')))

        prompt = _only_prompt(result, 'losing_prompts')
        assert (prompt['first_party']['mentions'], prompt['first_party']['best_rank']) == (1, None)


class TestPromptClassification:
    @pytest.mark.parametrize(('brands', 'statuses'), [
        *[pytest.param((_brand('first_party', rank),), (['winning'], [], []), id=f'winning-at-rank-{rank}') for rank in (1, 2, 3)],
        *[pytest.param((_brand('first_party', rank),), (['neutral'], [], []), id=f'neutral-at-rank-{rank}') for rank in (4, 5)],
        *[pytest.param((_brand('first_party', rank),), ([], ['losing'], []), id=f'losing-at-rank-{rank}') for rank in (6, 10, 999)],
        pytest.param((_brand('first_party', 8), _COMPETITOR_TOP), ([], ['losing'], []), id='losing-below-fifth-beside-competitors'),
        pytest.param((), ([], ['losing'], []), id='losing-without-a-tracked-brand'),
        pytest.param((_COMPETITOR_TOP, _brand('competitor', 4)), ([], [], ['opportunity']), id='opportunity-competitors-only'),
    ])
    def test_files_the_prompt_in_the_bucket_its_first_party_rank_earns(self, insights_module, brands, statuses):
        result = _analyze(insights_module, _run('best running shoes', *brands))

        assert _statuses(result) == dict(zip(_BUCKETS, statuses, strict=True))

    def test_leaves_a_neutral_prompt_without_a_score(self, insights_module):
        result = _analyze(insights_module, _run('best running shoes', _brand('first_party', 4)))

        prompt = result['winning_prompts'][0]
        assert prompt['status'] == 'neutral'
        assert 'score' not in prompt

    def test_scores_a_win_from_coverage_rank_and_mentions(self, insights_module):
        rows = _answers('best running shoes', openai=[_brand('first_party', 2, mentions=3)], gemini=[_COMPETITOR_TOP])

        result = _analyze(insights_module, rows)

        # 50% coverage -> 25, rank 2 -> 20, 3 mentions -> 6
        assert result['winning_prompts'][0]['score'] == 51.0

    def test_caps_first_party_mentions_at_ten_in_the_winning_score(self, insights_module):
        result = _analyze(insights_module, _run('best running shoes', _brand('first_party', 1, mentions=40)))

        assert result['winning_prompts'][0]['score'] == 100.0

    def test_scores_an_opportunity_from_competitor_coverage_and_mentions(self, insights_module):
        rows = _answers('best running shoes', openai=[_brand('competitor', 1, mentions=4)], gemini=[])

        result = _analyze(insights_module, rows)

        # 50% coverage -> 25, 4 mentions -> 20
        assert result['opportunity_prompts'][0]['opportunity_score'] == 45.0

    def test_caps_competitor_mentions_at_ten_in_the_opportunity_score(self, insights_module):
        result = _analyze(insights_module, _run('best running shoes', _brand('competitor', 1, mentions=40)))

        assert result['opportunity_prompts'][0]['opportunity_score'] == 100.0

    def test_scores_improvement_potential_from_missing_coverage_and_rank_depth(self, insights_module):
        result = _analyze(insights_module, _run('best running shoes', _brand('first_party', 7)))

        # 100 - full coverage (50) - rank 7 of 10 (15)
        assert result['losing_prompts'][0]['improvement_potential'] == 35.0

    def test_reports_full_improvement_potential_when_first_party_is_absent(self, insights_module):
        result = _analyze(insights_module, _run('best running shoes', _brand('other', 1)))

        assert result['losing_prompts'][0]['improvement_potential'] == 100.0

    def test_reports_half_improvement_potential_when_first_party_is_mentioned_without_a_rank(self, insights_module):
        result = _analyze(insights_module, _run('best running shoes', _brand('first_party')))

        assert result['losing_prompts'][0]['improvement_potential'] == 50.0


class TestRankingAndSummary:
    def test_orders_winning_prompts_by_score_descending(self, insights_module):
        results = {
            **_run('best running shoes', _brand('first_party', 3)),
            **_run('trail running shoes', _FIRST_PARTY_TOP),
            **_run('marathon training plan', _brand('first_party', 2)),
        }

        result = _analyze(insights_module, results)

        assert [(prompt['keyword'], prompt['score']) for prompt in result['winning_prompts']] == [
            ('trail running shoes', 82.0),
            ('marathon training plan', 72.0),
            ('best running shoes', 62.0),
        ]

    def test_orders_losing_prompts_by_improvement_potential_descending(self, insights_module):
        results = {
            **_run('best running shoes', _brand('first_party', 7)),
            **_run('trail running shoes'),
            **_run('marathon training plan', _brand('first_party', 6)),
        }

        result = _analyze(insights_module, results)

        assert [(prompt['keyword'], prompt['improvement_potential']) for prompt in result['losing_prompts']] == [
            ('trail running shoes', 100.0),
            ('best running shoes', 35.0),
            ('marathon training plan', 30.0),
        ]

    def test_orders_opportunity_prompts_by_opportunity_score_descending(self, insights_module):
        results = {
            **_run('best running shoes', _brand('competitor', 1, mentions=2)),
            **_run('trail running shoes', _brand('competitor', 1, mentions=10)),
            **_run('marathon training plan', _COMPETITOR_TOP),
        }

        result = _analyze(insights_module, results)

        assert [(prompt['keyword'], prompt['opportunity_score']) for prompt in result['opportunity_prompts']] == [
            ('trail running shoes', 100.0),
            ('best running shoes', 60.0),
            ('marathon training plan', 55.0),
        ]

    def test_places_neutral_prompts_after_scored_wins(self, insights_module):
        results = {**_run('best running shoes', _brand('first_party', 4)), **_run('trail running shoes', _FIRST_PARTY_TOP)}

        result = _analyze(insights_module, results)

        assert [(prompt['keyword'], prompt['status']) for prompt in result['winning_prompts']] == [
            ('trail running shoes', 'winning'),
            ('best running shoes', 'neutral'),
        ]

    def test_keeps_keyword_order_for_prompts_with_equal_scores(self, insights_module):
        keywords = ['seo audit checklist', 'best running shoes', 'marathon training plan']

        result = _analyze(insights_module, _first_party_wins(keywords))

        assert [prompt['keyword'] for prompt in result['winning_prompts']] == keywords

    def test_returns_at_most_twenty_prompts_per_bucket_while_counting_every_prompt(self, insights_module):
        result = _analyze(insights_module, _first_party_wins([f'keyword {index:02d}' for index in range(25)]))

        counts = (len(result['winning_prompts']), result['summary']['winning_count'], result['total_prompts_analyzed'])
        assert counts == (20, 25, 25)

    def test_counts_neutral_prompts_as_wins_in_the_summary(self, insights_module):
        results = {**_mixed_results(), **_run('lightweight racing flats', _brand('first_party', 4))}

        result = _analyze(insights_module, results)

        assert result['summary'] == {'winning_count': 2, 'losing_count': 1, 'opportunity_count': 1, 'win_rate': 50.0}

    def test_rounds_the_win_rate_to_one_decimal(self, insights_module):
        result = _analyze(insights_module, _mixed_results())

        assert result['summary']['win_rate'] == 33.3


class TestHandler:
    def test_returns_every_bucket_and_the_summary_when_no_type_is_given(self, insights_module):
        status, body = _get_insights(insights_module, _mixed_results())

        assert status == 200
        assert sorted(body) == ['losing_prompts', 'opportunity_prompts', 'summary', 'total_prompts_analyzed', 'winning_prompts']

    @pytest.mark.parametrize(('type_param', 'bucket', 'keyword'), [
        ('winning', 'winning_prompts', 'best running shoes'),
        ('losing', 'losing_prompts', 'trail running shoes'),
        ('opportunities', 'opportunity_prompts', 'marathon training plan'),
    ])
    def test_returns_only_the_requested_bucket_and_the_summary_when_a_type_is_given(
        self, insights_module, type_param, bucket, keyword
    ):
        status, body = _get_insights(insights_module, _mixed_results(), query={'type': type_param})

        assert status == 200
        assert sorted(body) == sorted([bucket, 'summary'])
        assert [prompt['keyword'] for prompt in body[bucket]] == [keyword]

    @pytest.fixture
    def limited_body(self, insights_module) -> dict[str, Any]:
        """The body of a `limit=1` request over two prompts per bucket."""
        return _get_insights(insights_module, _two_per_bucket_results(), query={'limit': '1'})[1]

    def test_truncates_every_bucket_to_the_requested_limit(self, limited_body):
        assert {bucket: [prompt['keyword'] for prompt in limited_body[bucket]] for bucket in _BUCKETS} == {
            'winning_prompts': ['best running shoes'],
            'losing_prompts': ['marathon training plan'],
            'opportunity_prompts': ['running shoe reviews'],
        }

    def test_keeps_full_counts_in_the_summary_when_a_limit_truncates_the_buckets(self, limited_body):
        assert limited_body['summary'] == {'winning_count': 2, 'losing_count': 2, 'opportunity_count': 2, 'win_rate': 33.3}

    def test_truncates_the_requested_bucket_when_type_and_limit_are_combined(self, insights_module):
        _, body = _get_insights(insights_module, _two_per_bucket_results(), query={'type': 'losing', 'limit': '1'})

        assert [prompt['keyword'] for prompt in body['losing_prompts']] == ['marathon training plan']

    def test_rejects_an_unknown_type_with_400(self, insights_module):
        status, body = _get_insights(insights_module, _mixed_results(), query={'type': 'neutral'})

        assert (status, body) == (
            400, {'error': 'Invalid type. Must be one of: winning, losing, opportunities, all', 'field': 'type'}
        )

    @pytest.mark.parametrize(('limit', 'message'), [
        ('0', 'limit must be at least 1'),
        ('101', 'limit must be at most 100'),
        ('ten', 'Invalid type for limit: expected int'),
    ])
    def test_rejects_an_invalid_limit_with_400(self, insights_module, limit, message):
        status, body = _get_insights(insights_module, _mixed_results(), query={'limit': limit})

        assert (status, body) == (400, {'error': message, 'field': 'limit'})

    @pytest.mark.parametrize(('config', 'results', 'message'), [
        pytest.param({}, _mixed_results(), 'No first-party brands configured', id='no first-party brand'),
        pytest.param(_CONFIG, {}, 'No keywords configured', id='no keywords'),
    ])
    def test_answers_400_with_the_reason_when_a_prerequisite_is_not_configured(
        self, insights_module, config, results, message
    ):
        status, body = _get_insights(insights_module, results, config=config)

        assert (status, body) == (400, {'error': message})
