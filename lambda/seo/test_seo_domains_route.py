"""Domain Overview routes and SEO recommendations (``seo-domains.py``): validation, markets, cache, cost, Admin gate."""

from __future__ import annotations

import json
from contextlib import nullcontext
from dataclasses import replace
from unittest.mock import MagicMock, patch

import pytest
import seo_geo_data
from botocore.exceptions import ClientError

from shared.dataforseo_domain import Page
from shared.dataforseo_domain_scope import ResearchTarget
from shared.dataforseo_pricing import labs_usd
from testing.events import parse_response
from testing.handler_fixtures import handler_fixture
from testing.seo_domain_fixtures import SNAPSHOT_ENV, FakeSnapshots, overview, ranked_keyword, stored_snapshot
from testing.seo_fixtures import ADS_CODES, SEO_DIR, SEO_ENV, seo_event

DOMAINS_ENV = {
    **SEO_ENV, **SNAPSHOT_ENV, 'SEO_DOMAIN_SNAPSHOTS_STATE_MACHINE_ARN': 'arn:aws:states:us-east-1:111111111111:stateMachine:snap',
    'DYNAMODB_TABLE_RECOMMENDATION_STATUS': 'test-recommendation-status',
}
domains_module = handler_fixture(SEO_DIR, 'seo-domains.py', 'seo_domains_under_test', env=DOMAINS_ENV)

PAGE = Page(items=(ranked_keyword(),), total_count=120, has_more=True, cost_usd=0.018)


def call(module, method, path, *, body=None, query=None, groups='Users', **patches):
    with patch.multiple(module, **patches) if patches else nullcontext():
        response = module.handler(seo_event(method, path, body=body, query=query, groups=groups), {})
    return parse_response(response)


def keywords_page(module):
    """The keywords answer for example.com when DataForSEO answers ``PAGE``."""
    _status, body = call(module, 'POST', '/api/seo/domains/keywords', body={'target': 'example.com'},
                         KEYWORDS_LOOKUP=replace(module.KEYWORDS_LOOKUP, fetch=MagicMock(return_value=PAGE)))
    return body


class TestOverview:
    def test_answers_the_domain_wide_figures_with_their_price(self, domains_module):
        status, body = call(domains_module, 'POST', '/api/seo/domains/overview', body={'target': 'www.example.com/blog'},
                            domain_overview=MagicMock(return_value=overview()))

        assert (status, body['hostname'], body['domain_wide'], body['estimated_cost_usd']) == (200, 'example.com', True, 0.01212)

    def test_caches_an_overview_with_data(self, domains_module, seo_boundary):
        call(domains_module, 'POST', '/api/seo/domains/overview', body={'target': 'example.com'},
             domain_overview=MagicMock(return_value=overview()))

        assert seo_boundary.put_cached.call_args.args[0] == 'domain-overview'

    def test_never_caches_an_empty_overview(self, domains_module, seo_boundary):
        call(domains_module, 'POST', '/api/seo/domains/overview', body={'target': 'example.com'},
             domain_overview=MagicMock(return_value=overview(count=0)))

        assert seo_boundary.put_cached.call_count == 0

    def test_serves_a_cached_overview_for_free(self, domains_module, seo_boundary):
        seo_boundary.get_cached.return_value = {'has_data': True, 'organic_keywords': 5, 'fetched_at': 'x'}
        fetch = MagicMock()

        _status, body = call(domains_module, 'POST', '/api/seo/domains/overview', body={'target': 'example.com'}, domain_overview=fetch)

        assert (body['cached'], body['estimated_cost_usd'], fetch.call_count) == (True, 0.0, 0)

    def test_refuses_a_target_dataforseo_would_bill_and_fail(self, domains_module):
        status, body = call(domains_module, 'POST', '/api/seo/domains/overview', body={'target': 'my_site.com'})

        assert (status, body['code'], body['field']) == (400, 'VALIDATION_ERROR', 'target')

    def test_refuses_a_google_ads_only_market(self, domains_module, seo_boundary):
        seo_boundary.market_codes.return_value = ADS_CODES

        status, body = call(domains_module, 'POST', '/api/seo/domains/overview', body={'target': 'example.com', 'market_id': 'cl-es'})

        assert (status, body['code']) == (400, 'UNSUPPORTED_MARKET')


class TestKeywords:
    def test_passes_the_offset_of_the_page(self, domains_module):
        fetch = MagicMock(return_value=PAGE)

        call(domains_module, 'POST', '/api/seo/domains/keywords', body={'target': 'example.com', 'page': 3, 'page_size': 100},
             KEYWORDS_LOOKUP=replace(domains_module.KEYWORDS_LOOKUP, fetch=fetch))

        assert (fetch.call_args.kwargs['offset'], fetch.call_args.kwargs['limit']) == (200, 100)

    def test_answers_the_rows_and_paging(self, domains_module):
        body = keywords_page(domains_module)

        assert (body['items'][0]['keyword'], body['total_count'], body['has_more'], body['estimated_cost_usd']) == (
            'cheap flights', 120, True, 0.018,
        )

    def test_answers_the_intent_of_each_row(self, domains_module):
        assert keywords_page(domains_module)['items'][0]['intent'] == 'commercial'

    def test_keyword_cache_is_version_2_so_rows_cached_without_intent_are_refetched(self, domains_module):
        assert (domains_module.KEYWORDS_CACHE.namespace, domains_module.KEYWORDS_CACHE.version) == ('domain-keywords', 2)

    def test_refuses_more_than_eight_filter_conditions(self, domains_module):
        filters = {'include': 'a,b,c,d,e,f,g,h,i'}

        status, body = call(domains_module, 'POST', '/api/seo/domains/keywords', body={'target': 'example.com', 'filters': filters})

        assert (status, body['field'], body['error']) == (400, 'filters', 'Too many filter conditions (9 of 8 max)')

    def test_refuses_an_unknown_filter(self, domains_module):
        status, body = call(domains_module, 'POST', '/api/seo/domains/keywords', body={'target': 'example.com', 'filters': {'min_vol': 1}})

        assert (status, body['error']) == (400, 'Unknown filter: min_vol')

    def test_refuses_a_page_size_of_200(self, domains_module):
        status, body = call(domains_module, 'POST', '/api/seo/domains/keywords', body={'target': 'example.com', 'page_size': 200})

        assert (status, body['field']) == (400, 'page_size')


class TestPagesAndCompetitors:
    def test_scopes_pages_to_the_subfolder_of_a_path_input(self, domains_module):
        fetch = MagicMock(return_value=Page(items=(), total_count=0, has_more=False, cost_usd=0.018))

        call(domains_module, 'POST', '/api/seo/domains/pages', body={'target': 'example.com/blog/'},
             PAGES_LOOKUP=replace(domains_module.PAGES_LOOKUP, fetch=fetch))

        assert fetch.call_args.args[0] == ResearchTarget(scope='subfolder', hostname='example.com', path='/blog')

    def test_sorts_competitors_by_visibility_with_unknown_last(self, domains_module):
        rows = [MagicMock(), MagicMock()]
        fetch = MagicMock(return_value=(rows, 0.018))
        as_json = MagicMock(side_effect=[{'domain': 'a.example', 'visibility': None}, {'domain': 'b.example', 'visibility': 0.2}])

        _status, body = call(domains_module, 'POST', '/api/seo/domains/competitors', body={'keywords': ['cheap flights']},
                             serp_competitors=fetch, competitor_json=as_json)

        assert [item['domain'] for item in body['items']] == ['b.example', 'a.example']

    def test_answers_a_cached_only_competitors_miss_409_not_cached_without_calling_labs(self, domains_module, seo_boundary):
        fetch = MagicMock(return_value=([], 0.018))

        status, body = call(domains_module, 'POST', '/api/seo/domains/competitors',
                            body={'keywords': ['cheap flights'], 'cached_only': True}, serp_competitors=fetch)

        assert (status, body['code'], fetch.call_count) == (409, 'NOT_CACHED', 0)

    def test_refuses_competitors_without_keywords(self, domains_module):
        status, body = call(domains_module, 'POST', '/api/seo/domains/competitors', body={'keywords': []})

        assert (status, body['field']) == (400, 'keywords')


class TestSnapshots:
    def test_lists_a_domain_snapshots_labelled_as_estimates(self, domains_module):
        table = FakeSnapshots([stored_snapshot()])

        _status, body = call(domains_module, 'GET', '/api/seo/domains/snapshots', query={'domain': 'example.com'},
                             snapshots_table=MagicMock(return_value=table))

        assert (body['estimated'], body['snapshots'][0]['estimated_traffic']) == (True, 8451)

    def test_refuses_a_user_who_is_not_an_admin(self, domains_module):
        status, body = call(domains_module, 'POST', '/api/seo/domains/snapshots', body={'domain': 'example.com'})

        assert (status, body['code']) == (403, 'FORBIDDEN')

    def test_starts_one_execution_for_an_admin(self, domains_module):
        client = MagicMock()

        status, _body = call(domains_module, 'POST', '/api/seo/domains/snapshots', body={'domain': 'www.example.com'},
                             groups='Admin', step_functions=MagicMock(return_value=client))

        assert (status, json.loads(client.start_execution.call_args.kwargs['input'])) == (
            202, {'targets': [{'domain': 'example.com', 'market_id': 'global'}]},
        )

    def test_answers_409_when_the_hour_already_has_a_snapshot(self, domains_module):
        client = MagicMock()
        client.start_execution.side_effect = ClientError({'Error': {'Code': 'ExecutionAlreadyExists'}}, 'StartExecution')

        status, body = call(domains_module, 'POST', '/api/seo/domains/snapshots', body={'domain': 'example.com'},
                            groups='Admin', step_functions=MagicMock(return_value=client))

        assert (status, body['code']) == (409, 'ALREADY_RUNNING')


class TestInsights:
    ROWS = [{'keyword': 'cheap flights', 'search_volume': 100, 'quadrant': 'ai_gap', 'organic_position': 5}]

    def answer(self, module, statuses):
        data = seo_geo_data.SeoGeoData(market_id='global', group_id=None, rows=self.ROWS, traffic_comparison=[], traffic_snapshot_at=None)
        resource = MagicMock()
        resource.batch_get_item.return_value = {'Responses': {'test-recommendation-status': statuses}}
        return call(module, 'GET', '/api/seo/insights', load_seo_geo=MagicMock(return_value=data),
                    status_resource=MagicMock(return_value=resource))

    def test_marks_an_untracked_recommendation_new(self, domains_module):
        _status, body = self.answer(domains_module, [])

        assert [(item['type'], item['status']) for item in body['recommendations']] == [('ai_gap', 'new')]

    def test_joins_the_stored_status(self, domains_module):
        first = self.answer(domains_module, [])[1]['recommendations'][0]

        _status, body = self.answer(domains_module, [{'recommendation_id': first['id'], 'status': 'done', 'notes': 'shipped'}])

        assert (body['recommendations'][0]['status'], body['recommendations'][0]['notes']) == ('done', 'shipped')


@pytest.mark.parametrize('path', ['/api/seo/domains/overview', '/api/seo/domains/keywords', '/api/seo/domains/pages'])
def test_refuses_a_body_without_a_target(domains_module, path):
    status, body = call(domains_module, 'POST', path, body={})

    assert (status, body['code']) == (400, 'VALIDATION_ERROR')


LOOKUPS = {'/api/seo/domains/keywords': 'KEYWORDS_LOOKUP', '/api/seo/domains/pages': 'PAGES_LOOKUP'}
CHUNK = {'target': 'example.com', 'offset': 2000, 'limit': 1000}


class Export:
    """One request of a paged Domain Overview route with its Labs call stubbed to answer ``PAGE``."""

    def __init__(self, module, path, body) -> None:
        self.fetch = MagicMock(return_value=PAGE)
        lookup = getattr(module, LOOKUPS[path])
        self.status, self.body = call(module, 'POST', path, body=body, **{LOOKUPS[path]: replace(lookup, fetch=self.fetch)})

    @property
    def sent_window(self):
        return self.fetch.call_args.kwargs['offset'], self.fetch.call_args.kwargs['limit']


@pytest.mark.parametrize('path', list(LOOKUPS))
class TestExport:
    def test_asks_labs_for_the_export_window_instead_of_the_page(self, domains_module, path):
        answer = Export(domains_module, path, {**CHUNK, 'page': 3, 'page_size': 100})

        assert answer.sent_window == (2000, 1000)

    def test_starts_the_window_at_row_0_without_an_offset(self, domains_module, path):
        answer = Export(domains_module, path, {'target': 'example.com', 'limit': 300})

        assert answer.sent_window == (0, 300)

    def test_prices_a_fresh_chunk_at_one_labs_call_of_its_rows(self, domains_module, path):
        answer = Export(domains_module, path, CHUNK)

        assert (answer.body['cached'], answer.body['estimated_cost_usd']) == (False, round(labs_usd(1000), 6))

    def test_echoes_the_window_and_the_default_page(self, domains_module, path):
        body = Export(domains_module, path, CHUNK).body

        assert {key: body[key] for key in ('offset', 'limit', 'page', 'page_size')} == {
            'offset': 2000, 'limit': 1000, 'page': 1, 'page_size': 50,
        }

    def test_echoes_a_null_window_on_a_page_answer(self, domains_module, path):
        body = Export(domains_module, path, {'target': 'example.com', 'page': 2}).body

        assert (body['offset'], body['limit'], body['page']) == (None, None, 2)

    def test_reads_offset_alone_as_a_page_request(self, domains_module, path):
        answer = Export(domains_module, path, {'target': 'example.com', 'offset': 500})

        assert (answer.sent_window, answer.body['offset']) == ((0, 50), None)

    def test_carries_the_labs_export_prices_and_twelve_hour_cache_on_every_answer(self, domains_module, path):
        body = Export(domains_module, path, {'target': 'example.com'}).body

        assert body['export'] == {
            'max_rows': 10_000, 'rows_per_request': 1000, 'request_usd': 0.012, 'row_usd': 0.00012, 'cache_hours': 12,
        }

    def test_caches_a_chunk_under_its_offset_and_limit(self, domains_module, seo_boundary, path):
        Export(domains_module, path, CHUNK)

        params = seo_boundary.put_cached.call_args.args[2]
        assert ((params['offset'], params['limit']), 'page' in params) == ((2000, 1000), False)

    def test_keys_the_next_chunk_apart_from_the_first(self, domains_module, seo_boundary, path):
        Export(domains_module, path, CHUNK)
        Export(domains_module, path, {**CHUNK, 'offset': 3000})

        first, second = (entry.args[2] for entry in seo_boundary.put_cached.call_args_list)
        assert first != second

    def test_keeps_the_page_cache_key_of_a_page_answer(self, domains_module, seo_boundary, path):
        Export(domains_module, path, {'target': 'example.com', 'page': 2, 'page_size': 100})

        params = seo_boundary.put_cached.call_args.args[2]
        assert ((params['page'], params['page_size']), 'offset' in params) == ((2, 100), False)

    def test_serves_a_cached_chunk_for_free(self, domains_module, seo_boundary, path):
        seo_boundary.get_cached.return_value = {'items': [], 'total_count': 0, 'has_more': False, 'fetched_at': 'x'}

        answer = Export(domains_module, path, CHUNK)

        assert (answer.body['cached'], answer.body['estimated_cost_usd'], answer.fetch.call_count) == (True, 0.0, 0)

    def test_refuses_a_window_past_10000_rows_on_limit(self, domains_module, path):
        answer = Export(domains_module, path, {**CHUNK, 'offset': 9500, 'limit': 501})

        assert (answer.status, answer.body['code'], answer.body['field'], answer.fetch.call_count) == (
            400, 'VALIDATION_ERROR', 'limit', 0,
        )

    @pytest.mark.parametrize(('field', 'value'), [('limit', 1001), ('limit', 0), ('offset', 10_000), ('offset', -1),
                                                  ('limit', True), ('offset', 2.5)])
    def test_refuses_an_out_of_range_or_non_integer_window_field(self, domains_module, path, field, value):
        answer = Export(domains_module, path, {**CHUNK, field: value})

        assert (answer.status, answer.body['field'], answer.fetch.call_count) == (400, field, 0)


@pytest.mark.parametrize('path', list(LOOKUPS))
class TestCachedOnly:
    def test_answers_a_cached_only_miss_409_not_cached_without_calling_labs(self, domains_module, path):
        answer = Export(domains_module, path, {**CHUNK, 'cached_only': True})

        assert (answer.status, answer.body['code'], answer.fetch.call_count) == (409, 'NOT_CACHED', 0)

    def test_answers_a_cached_only_hit_from_the_cache_for_free(self, domains_module, seo_boundary, path):
        seo_boundary.get_cached.return_value = {'items': [], 'total_count': 0, 'has_more': False, 'fetched_at': 'x'}

        answer = Export(domains_module, path, {**CHUNK, 'cached_only': True})

        assert (answer.status, answer.body['estimated_cost_usd'], answer.fetch.call_count) == (200, 0.0, 0)

    def test_stores_nothing_on_a_cached_only_miss(self, domains_module, seo_boundary, path):
        Export(domains_module, path, {**CHUNK, 'cached_only': True})

        assert seo_boundary.put_cached.call_count == 0
