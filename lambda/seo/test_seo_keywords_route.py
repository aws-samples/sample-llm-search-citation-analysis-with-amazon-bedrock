"""``POST /api/seo/keywords/research`` (``seo-keywords.py``): validation, markets, cache and cost estimate."""

from __future__ import annotations

from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from shared.dataforseo_client import DataForSeoError, remaining_deadline_s
from shared.dataforseo_keywords import KeywordRow, MonthlySearch, ResearchResult
from shared.dataforseo_locations import UnsupportedMarketError
from shared.utils import keyword_id
from testing.events import parse_response
from testing.handler_fixtures import handler_fixture
from testing.seo_fixtures import ADS_CODES, GLOBAL_CODES, SEO_DIR, SEO_ENV, FakeMetricsTable, labs_price, seo_event

keywords_module = handler_fixture(SEO_DIR, 'seo-keywords.py', 'seo_keywords_under_test', env=SEO_ENV)

ROW = KeywordRow(
    keyword='cheap flights to acme', search_volume=880, trend=(MonthlySearch(year=2026, month=9, search_volume=900),),
    keyword_difficulty=33, cpc=0.8, competition=0.4, intent='commercial',
)
RESULT = ResearchResult(rows=(ROW,), source='blended', used_fallback=False, cost_usd=0.042)
ROW_JSON = {
    'keyword': 'cheap flights to acme', 'search_volume': 880, 'trend': [{'year': 2026, 'month': 9, 'search_volume': 900}],
    'keyword_difficulty': 33, 'cpc': 0.8, 'competition': 0.4, 'intent': 'commercial',
}
CACHED = {'source': 'suggestions', 'used_fallback': True, 'rows': [ROW_JSON], 'fetched_at': '2026-10-01T10:00:00Z'}


class Research:
    """One research request, with the provider stubbed and the cache and market codes from ``seo_boundary``."""

    def __init__(self, module, boundary, body, *, cached=None, result: ResearchResult | Exception = RESULT,
                 codes=GLOBAL_CODES, codes_error=None, store_error: Exception | None = None, context=None):
        self.deadline_seen: float | None = None
        self.research = MagicMock(side_effect=self._answer(result))
        self.get_cached, self.put_cached = boundary.get_cached, boundary.put_cached
        self.get_cached.return_value = cached
        boundary.market_codes.configure_mock(return_value=codes, side_effect=codes_error)
        self.metrics = FakeMetricsTable(error=store_error)
        with patch.multiple(module, research_keywords=self.research, labs_usd=labs_price,
                            metrics_table=MagicMock(return_value=self.metrics)):
            event = seo_event('POST', '/api/seo/keywords/research', body=body)
            self.status, self.body = parse_response(module.handler(event, context if context is not None else {}))

    def _answer(self, result: ResearchResult | Exception):
        def answer(*_args, **_kwargs) -> ResearchResult:
            self.deadline_seen = remaining_deadline_s()
            if isinstance(result, Exception):
                raise result
            return result
        return answer

    @property
    def stored_items(self) -> list[dict]:
        return self.metrics.items


@pytest.fixture
def research(keywords_module, seo_boundary):
    """``research(body, **stubs)``: one request through ``seo-keywords.py``."""
    return lambda body, **stubs: Research(keywords_module, seo_boundary, body, **stubs)


@pytest.fixture
def ads_research(research):
    """A fresh research in the Google-Ads-only Chile market."""
    return research({'keyword': 'x', 'market_id': 'cl-es'}, codes=ADS_CODES)


class TestFreshResearch:
    def test_answers_the_rows_of_a_fresh_research(self, research):
        call = research({'keyword': 'cheap flights'})

        assert (call.status, call.body['rows'], call.body['cached']) == (200, [ROW_JSON], False)

    def test_describes_the_market_and_data_source(self, research):
        call = research({'keyword': 'cheap flights'})

        assert {key: call.body[key] for key in ('market_id', 'location_code', 'language_code', 'data_source')} == {
            'market_id': 'global', 'location_code': 2840, 'language_code': 'en', 'data_source': 'labs',
        }

    def test_researches_the_normalized_seed(self, research):
        call = research({'keyword': '  Cheap FLIGHTS '})

        assert (call.research.call_args.args[0], call.body['keyword']) == ('cheap flights', 'cheap flights')

    def test_passes_every_option_to_the_provider(self, research):
        call = research({'keyword': 'x', 'mode': 'ideas', 'limit': 300, 'group_keywords': True, 'clickstream': True})

        assert call.research.call_args.kwargs == {'mode': 'ideas', 'limit': 300, 'group_keywords': True, 'clickstream': True}

    def test_caches_a_result_for_24_hours_under_the_kw_research_namespace(self, research):
        call = research({'keyword': 'cheap flights'})

        namespace, version, params, payload, ttl = call.put_cached.call_args.args
        assert (namespace, version, params['seed'], payload['rows'], ttl) == ('kw-research', 1, 'cheap flights', [ROW_JSON], 86_400)

    def test_caches_an_empty_result_for_one_hour_when_research_finds_no_rows(self, research):
        call = research({'keyword': 'x'}, result=ResearchResult(rows=(), source='blended', used_fallback=True, cost_usd=0.04))

        _namespace, _version, _params, payload, ttl = call.put_cached.call_args.args
        assert (call.body['rows'], payload['rows'], ttl) == ([], [], 3_600)


class TestPersistedResearchMetrics:
    def test_stores_each_fresh_row_as_a_keyword_metric_of_the_market(self, research):
        call = research({'keyword': 'cheap flights'})

        assert call.stored_items == [{
            'keyword_id': keyword_id('cheap flights to acme'), 'market_id': 'global', 'keyword': 'cheap flights to acme',
            'monthly_searches': [{'year': 2026, 'month': 9, 'search_volume': 900}], 'source': 'labs',
            'fetched_at': call.body['fetched_at'], 'search_volume': 880, 'keyword_difficulty': 33,
            'cpc': Decimal('0.8'), 'competition': Decimal('0.4'), 'intent': 'commercial',
        }]

    def test_stores_google_ads_rows_with_the_google_ads_source(self, ads_research):
        assert [(item['market_id'], item['source']) for item in ads_research.stored_items] == [('cl-es', 'google_ads')]

    def test_stores_nothing_when_research_is_served_from_cache(self, research):
        call = research({'keyword': 'cheap flights'}, cached=CACHED)

        assert call.stored_items == []

    def test_answers_the_rows_when_storing_the_metrics_fails(self, research):
        call = research({'keyword': 'cheap flights'}, store_error=ClientError({'Error': {'Code': 'Throttling'}}, 'BatchWriteItem'))

        assert (call.status, call.body['rows']) == (200, [ROW_JSON])


def test_research_runs_under_the_lambda_deadline(research):
    call = research({'keyword': 'cheap flights'}, context=SimpleNamespace(get_remaining_time_in_millis=lambda: 20_000))

    assert call.deadline_seen == pytest.approx(18.0, abs=0.5)


class TestCachedResearch:
    def test_serves_a_cached_result_without_a_provider_call(self, research):
        call = research({'keyword': 'cheap flights'}, cached=CACHED)

        assert (call.body['cached'], call.body['source'], call.research.call_count) == (True, 'suggestions', 0)

    def test_keys_the_cache_on_seed_market_and_options(self, research):
        call = research({'keyword': 'Cheap Flights', 'limit': 500}, cached=CACHED)

        assert call.get_cached.call_args.args == ('kw-research', 1, {
            'seed': 'cheap flights', 'location_code': 2840, 'language_code': 'en', 'mode': 'auto', 'limit': 500,
            'group_keywords': False, 'clickstream': False,
        })

    def test_serves_a_cached_empty_result_without_a_provider_call(self, research):
        call = research({'keyword': 'cheap flights'}, cached={**CACHED, 'rows': []})

        assert (call.body['cached'], call.body['rows'], call.research.call_count) == (True, [], 0)

    def test_estimates_no_cost_when_research_is_served_from_cache(self, research):
        call = research({'keyword': 'cheap flights'}, cached=CACHED)

        assert call.body['estimated_cost_usd'] == 0.0

    def test_treats_a_cached_entry_without_a_rows_list_as_a_miss(self, research):
        call = research({'keyword': 'cheap flights'}, cached={**CACHED, 'rows': None})

        assert (call.body['cached'], call.research.call_count) == (False, 1)


class TestGoogleAdsMarket:
    def test_researches_auto_without_clickstream_or_grouping(self, research):
        call = research({'keyword': 'x', 'mode': 'ideas', 'clickstream': True, 'group_keywords': True}, codes=ADS_CODES)

        assert call.research.call_args.kwargs == {'mode': 'auto', 'limit': 150, 'group_keywords': False, 'clickstream': False}

    def test_estimates_one_google_ads_task(self, ads_research):
        assert (ads_research.body['estimated_cost_usd'], ads_research.body['data_source']) == (0.09, 'google_ads')


class TestEstimatedCost:
    @pytest.mark.parametrize(('body', 'expected'), [
        ({'mode': 'auto', 'limit': 150}, round(2 * (0.012 + 0.00012 * 75), 6)),
        ({'mode': 'auto', 'limit': 300, 'clickstream': True}, round(4 * (0.012 + 0.00012 * 150), 6)),
        ({'mode': 'related', 'limit': 500}, round(0.012 + 0.00012 * 500, 6)),
    ])
    def test_prices_auto_as_two_labs_calls_at_half_the_limit(self, research, body, expected):
        call = research({'keyword': 'x', **body})

        assert call.body['estimated_cost_usd'] == expected


class TestRefusals:
    @pytest.mark.parametrize(('body', 'field'), [
        ({}, 'keyword'),
        ({'keyword': ' '}, 'keyword'),
        ({'keyword': 'x' * 201}, 'keyword'),
        ({'keyword': 'x', 'limit': 200}, 'limit'),
        ({'keyword': 'x', 'mode': 'similar'}, 'mode'),
        ({'keyword': 'x', 'market_id': 'm' * 33}, 'market_id'),
    ])
    def test_refuses_an_invalid_request_before_any_paid_call(self, research, body, field):
        call = research(body)

        assert (call.status, call.body['code'], call.body['field'], call.research.call_count) == (400, 'VALIDATION_ERROR', field, 0)

    def test_refuses_a_body_that_is_not_an_object(self, research):
        call = research(['cheap flights'])

        assert (call.status, call.body['code']) == (400, 'VALIDATION_ERROR')

    def test_refuses_a_market_that_is_not_configured(self, research):
        call = research({'keyword': 'x', 'market_id': 'br-pt'})

        assert (call.status, call.body['field'], call.research.call_count) == (400, 'market_id', 0)

    def test_refuses_a_market_dataforseo_does_not_serve(self, research):
        call = research({'keyword': 'x', 'market_id': 'cl-es'}, codes_error=UnsupportedMarketError('CL'))

        assert (call.status, call.body['code'], call.research.call_count) == (400, 'UNSUPPORTED_MARKET', 0)

    def test_answers_503_when_dataforseo_is_not_configured(self, research):
        call = research({'keyword': 'x'}, result=DataForSeoError('NOT_CONFIGURED', 'no key'))

        assert (call.status, call.body['code']) == (503, 'NOT_CONFIGURED')
