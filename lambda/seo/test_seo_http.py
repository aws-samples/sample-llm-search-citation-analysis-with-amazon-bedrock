"""The SEO API's shared plumbing (``seo_http``): error codes, markets, request lists."""

from __future__ import annotations

import pytest
from seo_http import (
    CachePolicy,
    InvalidKeywordError,
    MarketRequest,
    UnknownMarketError,
    brand_config,
    keyword_id_list,
    keyword_list,
    market_request,
    resolve_market,
    seo_errors,
    with_error_code,
)

from shared.api_response import api_response, forbidden_response, validation_error
from shared.dataforseo_client import DataForSeoError
from shared.dataforseo_locations import UnsupportedMarketError
from testing.seo_fixtures import GLOBAL_CODES, json_body, seo_event

EVENT = seo_event('POST', '/api/seo/serp')


def raising(error: Exception):
    @seo_errors
    def route(event, context):
        raise error

    return route


class TestDataForSeoErrors:
    @pytest.mark.parametrize(('code', 'status'), [
        ('NOT_CONFIGURED', 503), ('AUTH_FAILED', 502), ('RATE_LIMITED', 429), ('UPSTREAM_UNAVAILABLE', 502),
        ('BILLING_ISSUE', 502), ('VALIDATION_ERROR', 400), ('INTERNAL_ERROR', 502),
    ])
    def test_answers_the_status_of_each_code(self, code, status):
        response = raising(DataForSeoError(code, 'provider text'))(EVENT, {})

        assert (response['statusCode'], json_body(response)['code']) == (status, code)

    def test_answers_an_unknown_code_as_an_internal_error(self):
        response = raising(DataForSeoError('SOMETHING_NEW', 'provider text'))(EVENT, {})

        assert (response['statusCode'], json_body(response)['code']) == (502, 'INTERNAL_ERROR')

    def test_never_returns_the_provider_message(self):
        response = raising(DataForSeoError('AUTH_FAILED', 'secret detail 40100'))(EVENT, {})

        assert json_body(response)['error'] == 'DataForSEO rejected the login'


class TestMarketErrors:
    def test_answers_an_unsupported_market_with_its_code(self):
        response = raising(UnsupportedMarketError('XX'))(EVENT, {})

        assert (response['statusCode'], json_body(response)['code'], json_body(response)['field']) == (
            400, 'UNSUPPORTED_MARKET', 'market_id',
        )

    def test_answers_an_unknown_market_as_a_validation_error(self):
        response = raising(UnknownMarketError('zz-zz'))(EVENT, {})

        assert (response['statusCode'], json_body(response)['code']) == (400, 'VALIDATION_ERROR')


class TestWithErrorCode:
    def test_adds_validation_error_to_a_validate_refusal(self):
        assert json_body(with_error_code(validation_error('Missing required field: keyword', EVENT, 'keyword'))) == {
            'error': 'Missing required field: keyword', 'field': 'keyword', 'code': 'VALIDATION_ERROR',
        }

    def test_adds_forbidden_to_a_group_refusal(self):
        assert json_body(with_error_code(forbidden_response('Forbidden', EVENT)))['code'] == 'FORBIDDEN'

    def test_keeps_a_code_already_given(self):
        response = api_response(400, {'error': 'x', 'code': 'UNSUPPORTED_MARKET'}, EVENT)

        assert with_error_code(response) is response

    def test_leaves_a_success_untouched(self):
        response = api_response(200, {'rows': []}, EVENT)

        assert with_error_code(response) is response


class TestResolveMarket:
    def test_reads_an_absent_market_as_global_without_reading_the_table(self, seo_boundary):
        assert (resolve_market(None), seo_boundary.brand_config_table.get_item.call_count) == (('global', None), 0)

    def test_reads_global_as_the_global_market(self):
        assert resolve_market('global') == ('global', None)

    def test_finds_a_configured_market(self):
        market_id, market = resolve_market('cl-es')

        assert (market_id, market.country if market else None) == ('cl-es', 'CL')

    def test_refuses_a_market_that_is_not_configured(self):
        with pytest.raises(UnknownMarketError, match='br-pt'):
            resolve_market('br-pt')


class TestMarketRequest:
    def test_normalizes_the_keyword_and_resolves_the_codes(self, seo_boundary):
        request = market_request('  Cheap FLIGHTS', 'cl-es')

        assert (request, seo_boundary.market_codes.call_args.args[0].market_id) == (
            MarketRequest(keyword='cheap flights', market_id='cl-es', codes=GLOBAL_CODES), 'cl-es',
        )

    def test_refuses_a_keyword_without_an_identity_before_reading_the_market(self, seo_boundary):
        with pytest.raises(InvalidKeywordError):
            market_request('\ud800', 'cl-es')
        assert seo_boundary.brand_config_table.get_item.call_count == 0

    def test_answers_an_invalid_keyword_on_its_field(self):
        response = raising(InvalidKeywordError('\ud800'))(EVENT, {})

        assert (response['statusCode'], json_body(response)['field']) == (400, 'keyword')


class TestBrandConfig:
    def test_reads_the_default_item(self):
        assert brand_config()['first_party_domains'] == ['example.com']

    def test_is_empty_before_a_brand_config_is_saved(self, seo_boundary):
        seo_boundary.brand_config_table.get_item.side_effect = None
        seo_boundary.brand_config_table.get_item.return_value = {}

        assert brand_config() == {}


class TestCachePolicy:
    def test_reads_its_namespace_and_version(self, seo_boundary):
        CachePolicy('serp', 2, 60).get({'keyword': 'x'})

        assert seo_boundary.get_cached.call_args.args == ('serp', 2, {'keyword': 'x'})

    def test_writes_with_its_ttl(self, seo_boundary):
        CachePolicy('serp', 2, 60).put({'keyword': 'x'}, {'items': []})

        assert seo_boundary.put_cached.call_args.args == ('serp', 2, {'keyword': 'x'}, {'items': []}, 60)


class TestKeywordList:
    def test_normalizes_and_deduplicates_keywords(self):
        assert keyword_list(['Cheap Flights ', 'cheap flights', 'Hotels'], 'keywords', 700) == (['cheap flights', 'hotels'], None)

    def test_refuses_an_empty_list(self):
        assert keyword_list([], 'keywords', 700) == (None, 'keywords must contain at least one entry')

    def test_refuses_more_than_the_limit(self):
        assert keyword_list(['a', 'b', 'c'], 'keywords', 2) == (None, 'keywords accepts at most 2 entries')

    def test_refuses_a_keyword_over_200_characters(self):
        assert keyword_list(['x' * 201], 'keywords', 700)[0] is None

    def test_refuses_a_blank_keyword(self):
        assert keyword_list(['  '], 'keywords', 700)[0] is None

    def test_refuses_a_value_that_is_not_a_list(self):
        assert keyword_list('cheap flights', 'keywords', 700) == (None, 'keywords must be an array of strings')


class TestKeywordIdList:
    def test_trims_and_deduplicates_ids(self):
        assert keyword_id_list([' kw-1', 'kw-1', 'kw-2'], 'keyword_ids', 500) == (['kw-1', 'kw-2'], None)

    def test_refuses_an_id_over_64_characters(self):
        assert keyword_id_list(['k' * 65], 'keyword_ids', 500)[0] is None
