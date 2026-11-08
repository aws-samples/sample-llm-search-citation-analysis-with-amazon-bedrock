"""Local SEO routes (``seo-local.py``): validation before spend, caching, receipts and job polling."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError

from shared import dataforseo_business as business
from shared import dataforseo_local_serp as local_serp
from shared import seo_spend_limit
from testing.dataforseo_fixtures import install_daily_limit
from testing.events import parse_response
from testing.handler_fixtures import handler_fixture
from testing.local_seo_fixtures import (
    CAFE_CID,
    GRID_REQUEST,
    MemoryCache,
    install_memory_cache,
    projected_business,
    stored_job,
)
from testing.seo_fixtures import SEO_DIR, SEO_ENV, seo_event

LOCAL_ENV = {**SEO_ENV, 'SEO_LOCAL_JOB_STATE_MACHINE_ARN': 'arn:aws:states:eu-west-1:123456789012:stateMachine:local'}
local_module = handler_fixture(SEO_DIR, 'seo-local.py', 'seo_local_under_test', env=LOCAL_ENV)

CACHED_AT = '2026-10-01T10:00:00Z'
NEAR = {'latitude': 40.0, 'longitude': -74.0}


@pytest.fixture
def call(local_module):
    """``call(method, path, body=None, query=None)`` -> ``(status, body)``."""
    def send(method, path, body=None, query=None):
        return parse_response(local_module.handler(seo_event(method, f'/api/seo/local{path}', body=body, query=query), {}))

    return send


@pytest.fixture
def memory(monkeypatch):
    return install_memory_cache(monkeypatch)


@pytest.fixture
def start_execution(local_module, monkeypatch):
    client = MagicMock()
    monkeypatch.setattr(local_module, 'stepfunctions_client', lambda: client)
    return client.start_execution


class TestCategories:
    def test_filters_the_cached_categories_by_substring(self, call, seo_boundary):
        seo_boundary.get_cached.return_value = {'items': [{'category': 'coffee_shop', 'business_count': 9},
                                                          {'category': 'bakery', 'business_count': 4}], 'fetched_at': CACHED_AT}

        assert call('GET', '/categories', query={'query': 'COFFEE'})[1] == {
            'categories': [{'category': 'coffee_shop', 'business_count': 9}], 'total': 1}

    def test_fills_the_cache_from_the_free_list_on_a_miss(self, call, seo_boundary, monkeypatch):
        monkeypatch.setattr(business, 'listing_categories', MagicMock(return_value=[{'category': 'cafe', 'business_count': 1}]))

        call('GET', '/categories')

        assert seo_boundary.put_cached.call_args.args[4] == 7 * 86_400


class TestBusinesses:
    def test_answers_projected_listings_with_their_estimated_cost(self, call, monkeypatch):
        monkeypatch.setattr(business, 'search_listings', MagicMock(return_value=([projected_business()], 0.0192)))

        status, body = call('POST', '/businesses', body={'query': 'cafe', **NEAR})

        assert (status, body['businesses'], body['estimated_cost_usd'], body['cached']) == (200, [projected_business()], 0.0192, False)

    def test_searches_around_the_market_city_without_a_coordinate(self, call, monkeypatch):
        search = MagicMock(return_value=([], 0.0192))
        monkeypatch.setattr(business, 'search_listings', search)

        call('POST', '/businesses', body={'query': 'cafe', 'market_id': 'cl-es'})

        assert (search.call_args.args[0].near.latitude, search.call_args.args[0].near.longitude) == (-33.45, -70.66)

    def test_refuses_a_global_search_without_a_coordinate_before_any_call(self, call, monkeypatch):
        search = MagicMock()
        monkeypatch.setattr(business, 'search_listings', search)

        status, body = call('POST', '/businesses', body={'query': 'cafe'})

        assert (status, body['code'], search.call_count) == (400, 'VALIDATION_ERROR', 0)

    def test_refuses_a_latitude_without_a_longitude(self, call):
        assert call('POST', '/businesses', body={'latitude': 40})[1]['field'] == 'longitude'

    def test_refuses_more_than_ten_categories(self, call):
        assert call('POST', '/businesses', body={**NEAR, 'categories': [f'c{index}' for index in range(11)]})[0] == 400

    def test_costs_nothing_when_served_from_the_cache(self, call, seo_boundary):
        seo_boundary.get_cached.return_value = {'items': [], 'fetched_at': CACHED_AT}

        assert call('POST', '/businesses', body=NEAR)[1]['estimated_cost_usd'] == 0.0

    def test_caches_an_empty_search_for_one_hour(self, call, seo_boundary, monkeypatch):
        monkeypatch.setattr(business, 'search_listings', MagicMock(return_value=([], 0.0192)))

        call('POST', '/businesses', body=NEAR)

        assert seo_boundary.put_cached.call_args.args[4] == 3_600


class TestProfileAndQuestions:
    def test_refuses_two_identifiers(self, call):
        status, body = call('POST', '/profile', body={'cid': '1', 'name': 'Acme'})

        assert (status, body['code']) == (400, 'VALIDATION_ERROR')

    def test_looks_a_profile_up_by_location_code_without_a_coordinate(self, call, monkeypatch):
        lookup = MagicMock(return_value=(None, 0.0054))
        monkeypatch.setattr(business, 'business_profile', lookup)

        call('POST', '/profile', body={'cid': CAFE_CID})

        assert lookup.call_args.args[1:] == (None, 2840, 'en')

    def test_answers_a_null_profile_when_none_matches(self, call, monkeypatch):
        monkeypatch.setattr(business, 'business_profile', MagicMock(return_value=(None, 0.0054)))

        assert call('POST', '/profile', body={'name': 'Nobody'})[1]['profile'] is None

    def test_prices_questions_per_twenty(self, call, monkeypatch):
        monkeypatch.setattr(business, 'business_questions', MagicMock(return_value=([], 0.027)))

        assert call('POST', '/questions', body={'cid': '1', 'depth': 100, **NEAR})[1]['estimated_cost_usd'] == 0.027


class TestLocalSerp:
    ITEMS = [{**projected_business('Other Cafe', cid='9', domain='other.example.net'), 'rank_group': 1, 'rank_absolute': 1},
             {**projected_business(domain='www.example.com'), 'rank_group': 2, 'rank_absolute': 2}]

    @pytest.fixture
    def serp(self, call, monkeypatch):
        monkeypatch.setattr(local_serp, 'local_serp', MagicMock(return_value=(self.ITEMS, None, 0.002)))
        return lambda **body: call('POST', '/serp', body={'keyword': 'coffee', **NEAR, **body})[1]

    def test_finds_the_brand_by_its_own_domain_by_default(self, serp):
        assert serp()['match'] == {'index': 1, 'rank': 2, 'title': 'Acme Cafe', 'cid': CAFE_CID, 'place_id': 'ChIJexample-cafe'}

    def test_finds_a_requested_business_by_cid(self, serp):
        assert serp(cid='9')['match']['rank'] == 1

    def test_has_no_match_when_the_business_is_not_listed(self, serp):
        assert serp(name='Nobody Bakery')['match'] is None

    def test_refuses_a_zoom_outside_4_to_18(self, call):
        assert call('POST', '/serp', body={'keyword': 'coffee', **NEAR, 'zoom': 19})[0] == 400


class TestStartJobDailyLimit:
    """A rank grid's billed tasks are posted by the jobs Lambda, so the router counts them before it starts."""

    def start(self, local_module, limit, grid_size):
        body = {'kind': 'grid', 'keyword': 'coffee', 'cid': CAFE_CID, 'grid_size': grid_size, **NEAR}
        event = seo_event('POST', '/api/seo/local/jobs', body=body)
        return parse_response(seo_spend_limit.limited(local_module.handler)(event, {}))

    def test_counts_a_grid_jobs_points_before_it_starts(self, local_module, memory, start_execution, monkeypatch):
        limit = install_daily_limit(monkeypatch, 100)

        status, _body = self.start(local_module, limit, 5)

        assert (status, limit.counter.calls_of('admin@example.com'), start_execution.call_count) == (200, 25, 1)

    def test_refuses_a_grid_past_the_limit_and_starts_nothing(self, local_module, memory, start_execution, monkeypatch):
        limit = install_daily_limit(monkeypatch, 20)

        status, body = self.start(local_module, limit, 5)

        assert (status, body['code'], limit.counter.calls_of('admin@example.com'), start_execution.call_count) == (
            429, 'DAILY_LIMIT', 0, 0)


    def test_gives_the_points_back_when_the_job_cannot_start(self, local_module, memory, start_execution, monkeypatch):
        limit = install_daily_limit(monkeypatch, 100)
        start_execution.side_effect = ClientError({'Error': {'Code': 'ExecutionLimitExceeded'}}, 'StartExecution')

        _status, body = self.start(local_module, limit, 5)

        assert (body['job']['status'], limit.counter.calls_of('admin@example.com')) == ('failed', 0)
        assert [(item['outcome'], item['calls']) for item in limit.audit_items()] == [('http_200', 0)]


class TestStartJob:
    def test_starts_a_grid_job_with_the_derived_zoom(self, call, memory, start_execution):
        body = call('POST', '/jobs', body={'kind': 'grid', 'keyword': 'coffee', 'cid': CAFE_CID, 'spacing_km': 2, **NEAR})[1]

        assert (body['reused'], body['job']['request']['zoom'], start_execution.call_count) == (False, 13, 1)

    def test_estimates_the_grid_cost_as_points_times_the_task_price(self, call, memory, start_execution):
        body = call('POST', '/jobs', body={'kind': 'grid', 'keyword': 'coffee', 'cid': '1', 'grid_size': 5, **NEAR})[1]

        assert body['job']['estimated_cost_usd'] == 0.03

    def test_reuses_the_receipt_of_an_equal_request_within_the_hour(self, call, memory, start_execution):
        request = {'kind': 'reviews', 'cid': CAFE_CID}
        first = call('POST', '/jobs', body=request)[1]

        second = call('POST', '/jobs', body=request)[1]

        assert (second['job_id'], second['reused'], start_execution.call_count) == (first['job_id'], True, 1)

    def test_restarts_collection_of_a_timed_out_job_without_posting(self, call, memory, start_execution):
        first = call('POST', '/jobs', body={'kind': 'updates', 'cid': CAFE_CID})[1]
        memory.put('local-job', 1, {'job_id': first['job_id']}, {**memory.job(first['job_id']), 'status': 'timed_out'}, 0)

        call('POST', '/jobs', body={'kind': 'updates', 'cid': CAFE_CID})

        assert start_execution.call_args.kwargs['name'] == f"{first['job_id']}-2"

    def test_refuses_a_reviews_depth_above_200(self, call, memory, start_execution):
        assert call('POST', '/jobs', body={'kind': 'reviews', 'cid': '1', 'depth': 300})[0] == 400

    def test_refuses_an_updates_depth_above_100(self, call, memory, start_execution):
        assert call('POST', '/jobs', body={'kind': 'updates', 'cid': '1', 'depth': 150})[1]['field'] == 'depth'

    def test_refuses_a_grid_size_other_than_3_5_or_7(self, call, memory, start_execution):
        assert call('POST', '/jobs', body={'kind': 'grid', 'keyword': 'x', 'cid': '1', 'grid_size': 4, **NEAR})[0] == 400

    def test_marks_the_job_failed_when_the_execution_cannot_start(self, call, memory, start_execution):
        start_execution.side_effect = KeyError('arn')

        assert call('POST', '/jobs', body={'kind': 'reviews', 'cid': '1'})[1]['job']['status'] == 'failed'


class TestJobStatus:
    def test_answers_the_job_view(self, call, memory):
        job = stored_job(memory, 'grid', GRID_REQUEST, status='collecting')

        assert call('GET', f"/jobs/{job['job_id']}")[1]['progress'] == {'ready': 0, 'total': 9}

    def test_answers_404_for_an_unknown_job(self, call, memory):
        assert call('GET', f"/jobs/{'0' * 32}") == (404, {'error': 'Job not found or expired', 'code': 'NOT_FOUND'})

    def test_answers_404_for_a_malformed_job_id(self, call, memory):
        assert call('GET', '/jobs/not-an-id')[0] == 404


@pytest.fixture
def seo_cache(seo_boundary):
    """The SEO answer cache as a dict, so a GET twin reads what its POST stored."""
    cache = MemoryCache()
    seo_boundary.get_cached.side_effect = cache.get
    seo_boundary.put_cached.side_effect = cache.put
    return cache


LISTINGS = [
    {**projected_business('Low'), 'rating': 3.9, 'reviews_count': 5},
    {**projected_business('Unrated'), 'rating': None, 'reviews_count': 40},
    {**projected_business('High'), 'rating': 4.8, 'reviews_count': 2},
    {**projected_business('Also high'), 'rating': 4.8, 'reviews_count': 9},
]
LISTINGS_SEARCH = {'query': 'cafe', **NEAR, 'categories': ['coffee_shop'], 'sort_by': 'rating', 'limit': 50}
LISTINGS_QUERY = {'query': 'cafe', 'latitude': '40.0', 'longitude': '-74.0', 'categories': 'coffee_shop',
                  'sort_by': 'rating', 'count': '50'}


class TestListingsOrder:
    def test_rating_sort_lists_the_highest_rating_first_and_unrated_listings_last(self, call, monkeypatch):
        monkeypatch.setattr(business, 'search_listings', MagicMock(return_value=(LISTINGS, 0.0192)))

        body = call('POST', '/businesses', body={**NEAR, 'sort_by': 'rating'})[1]

        assert [row['title'] for row in body['businesses']] == ['High', 'Also high', 'Low', 'Unrated']

    def test_relevance_keeps_the_order_dataforseo_answered(self, call, monkeypatch):
        monkeypatch.setattr(business, 'search_listings', MagicMock(return_value=(LISTINGS, 0.0192)))

        body = call('POST', '/businesses', body=NEAR)[1]

        assert [row['title'] for row in body['businesses']] == ['Low', 'Unrated', 'High', 'Also high']


class TestCachedListings:
    def test_answers_the_listings_a_post_cached_for_the_same_search(self, call, seo_cache, monkeypatch):
        monkeypatch.setattr(business, 'search_listings', MagicMock(return_value=(LISTINGS, 0.0192)))
        posted = call('POST', '/businesses', body=LISTINGS_SEARCH)[1]

        status, body = call('GET', '/businesses', query=LISTINGS_QUERY)

        assert (status, body['businesses'], body['cached'], body['estimated_cost_usd']) == (
            200, posted['businesses'], True, 0.0,
        )

    def test_reads_the_cached_answer_of_a_post_with_an_integer_radius_and_coordinates(self, call, seo_cache, monkeypatch):
        monkeypatch.setattr(business, 'search_listings', MagicMock(return_value=(LISTINGS, 0.0192)))
        call('POST', '/businesses', body={**LISTINGS_SEARCH, 'latitude': 40, 'radius_km': 10})

        status, body = call('GET', '/businesses', query={**LISTINGS_QUERY, 'latitude': '40', 'radius_km': '10'})

        assert (status, body['cached']) == (200, True)

    def test_answers_404_not_cached_without_a_paid_call_when_the_search_is_not_cached(self, call, seo_cache, monkeypatch):
        search = MagicMock()
        monkeypatch.setattr(business, 'search_listings', search)

        status, body = call('GET', '/businesses', query=LISTINGS_QUERY)

        assert (status, body['code'], search.call_count) == (404, 'NOT_CACHED', 0)

    def test_another_result_count_is_another_search_and_not_cached(self, call, seo_cache, monkeypatch):
        monkeypatch.setattr(business, 'search_listings', MagicMock(return_value=(LISTINGS, 0.0192)))
        call('POST', '/businesses', body=LISTINGS_SEARCH)

        assert call('GET', '/businesses', query={**LISTINGS_QUERY, 'count': '20'})[0] == 404


class TestCachedLocalSerp:
    def test_answers_the_results_and_match_a_post_cached(self, call, seo_cache, monkeypatch):
        monkeypatch.setattr(local_serp, 'local_serp', MagicMock(return_value=(TestLocalSerp.ITEMS, None, 0.002)))
        posted = call('POST', '/serp', body={'keyword': 'coffee', **NEAR, 'cid': '9'})[1]

        body = call('GET', '/serp', query={'keyword': 'coffee', 'latitude': '40.0', 'longitude': '-74.0', 'cid': '9'})[1]

        assert (body['items'], body['match'], body['cached']) == (posted['items'], posted['match'], True)

    def test_answers_404_not_cached_without_a_paid_call_when_the_results_are_not_cached(self, call, seo_cache, monkeypatch):
        crawl = MagicMock()
        monkeypatch.setattr(local_serp, 'local_serp', crawl)

        status, body = call('GET', '/serp', query={'keyword': 'coffee', 'latitude': '40.0', 'longitude': '-74.0'})

        assert (status, body['code'], crawl.call_count) == (404, 'NOT_CACHED', 0)
