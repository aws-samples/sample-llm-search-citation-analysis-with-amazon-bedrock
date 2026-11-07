"""
The ``seo`` spend family over the wire: DataForSEO call counts and prices, tokens, admin jobs, the daily limit.
"""

from __future__ import annotations

import json

import pytest
import state

from testing.mcp_result_fixtures import READ_SCOPE, WRITE_SCOPE
from testing.mcp_spend_fixtures import (
    CALLER_SUB,
    NOW,
    FakeRouters,
    confirmation_of,
    structured_error,
)

SERP = {'lookup': 'serp', 'keyword': 'hotel coruña'}
RANK_RUN = {'job': 'rank_run', 'tracker_id': 'trk-1'}
SNAPSHOT_PATH = '/api/seo/backlinks/snapshots'
ESTIMATE_PATH = '/api/seo/rank-trackers/estimate'
OTHER_ARGUMENTS = 'The confirmation_token was issued for other arguments; call the estimate again with these'
#: Each start and the estimate that confirms it.
ESTIMATE_OF = {
    'run_seo_keywords': 'estimate_seo_keywords', 'run_seo_domain': 'estimate_seo_domain',
    'run_seo_backlinks': 'estimate_seo_backlinks', 'run_seo_local': 'estimate_seo_local',
    'start_seo_job': 'estimate_seo_job',
}
SERP_ANSWER = {'keyword': 'hotel coruña', 'items': [{'position': 1, 'url': 'https://example.com/'}], 'cached': False}


@pytest.fixture(autouse=True)
def seo_router(monkeypatch, api) -> FakeRouters:
    """The SEO router behind a frozen clock: a SERP lookup, a tracker with six keyword-device checks, two tracked domains."""
    monkeypatch.setenv('MCP_API_FUNCTIONS', json.dumps({'seo': 'CitationAnalysis-SeoRouter'}))
    monkeypatch.setattr(state, 'utc_now', lambda: NOW)
    fake = FakeRouters(api.client)
    fake.answer('POST', '/api/seo/serp', 200, SERP_ANSWER)
    fake.answer('POST', ESTIMATE_PATH, 200, {'keyword_count': 3, 'pairs': 6})
    fake.answer('POST', '/api/seo/rank-trackers/trk-1/runs', 202, {'run': {'run_id': 'run-1'}})
    fake.answer('GET', SNAPSHOT_PATH, 200, {'domains': [{'domain': 'example.com'}, {'domain': 'example.org'}]})
    return fake


@pytest.fixture
def call(rpc, member):
    """``call(name, arguments, who=member)``: the ``tools/call`` result of one tool."""
    return lambda name, arguments, who=None: rpc(
        'tools/call', {'name': name, 'arguments': arguments}, claims_override=who or member,
    )['result']


@pytest.fixture
def estimated(call):
    """``estimated(name, arguments, who=member)``: the ``structuredContent`` of an estimate."""
    return lambda name, arguments, who=None: call(name, arguments, who)['structuredContent']


@pytest.fixture
def spend(call):
    """``spend(start, arguments, token=None, who=member)``: a start with ``token``, or with a fresh estimate's."""
    def run(name: str, arguments: dict, token: str | None = None, who: dict | None = None) -> dict:
        confirmation = token if token is not None else confirmation_of(call(ESTIMATE_OF[name], arguments, who))
        return call(name, {**arguments, 'confirmation_token': confirmation}, who)

    return run


class TestLookupEstimates:
    def test_counts_one_live_call_priced_by_depth_when_estimating_a_serp(self, estimated):
        data = estimated('estimate_seo_keywords', SERP)

        assert (data['dataforseo_calls'], data['price_per_call']) == (1, 'live Google organic results, $0.0035 at depth 20')

    def test_counts_two_half_size_calls_and_the_fallback_when_researching_in_auto_mode(self, estimated):
        data = estimated('estimate_seo_keywords', {'lookup': 'research', 'keyword': 'hotel coruña'})

        assert data['dataforseo_calls'] == 3
        assert data['price_per_call'].startswith('DataForSEO Labs, up to $0.0210 per call (2 calls')

    def test_doubles_the_row_price_when_research_asks_for_clickstream(self, estimated):
        data = estimated('estimate_seo_keywords', {
            'lookup': 'research', 'keyword': 'hotel', 'mode': 'ideas', 'limit': 300, 'clickstream': True,
        })

        assert (data['dataforseo_calls'], data['price_per_call'].split(';')[0]) == (1, 'DataForSEO Labs, up to $0.0960')

    def test_counts_summary_and_history_when_estimating_a_backlinks_overview(self, estimated):
        data = estimated('estimate_seo_backlinks', {'lookup': 'overview', 'target': 'example.com'})

        assert data['dataforseo_calls'] == 2

    def test_prices_a_local_finder_search_per_ten_results(self, estimated):
        data = estimated('estimate_seo_local', {'lookup': 'serp', 'keyword': 'hotel', 'search_type': 'local_finder',
                                                'depth': 40})

        assert data['price_per_call'] == 'live local_finder results, $0.0080'

    def test_reports_calls_and_price_per_call_but_no_dollar_total(self, estimated):
        data = estimated('estimate_seo_domain', {'lookup': 'overview', 'target': 'example.com'})

        assert sorted(data) == ['can_start', 'confirmation_token', 'dataforseo_calls', 'expires_at', 'limits',
                                'notes', 'price_per_call']

    def test_calls_no_api_when_estimating_a_lookup(self, seo_router, estimated):
        estimated('estimate_seo_keywords', SERP)

        assert seo_router.events == []

    def test_shows_the_seo_daily_limit_in_the_estimate(self, estimated):
        assert estimated('estimate_seo_keywords', SERP)['limits'] == {
            'used_today': 0, 'per_day': 50, 'resets_at': '2026-10-08T00:00:00Z',
        }


class TestLookupStarts:
    def test_replays_the_estimated_serp_request_to_the_seo_router(self, seo_router, spend):
        spend('run_seo_keywords', {**SERP, 'depth': 50})

        assert json.loads(seo_router.requests('POST', '/api/seo/serp')[0]['body']) == {'keyword': 'hotel coruña', 'depth': 50}

    def test_answers_the_lookup_result(self, spend):
        assert spend('run_seo_keywords', SERP)['structuredContent'] == SERP_ANSWER

    def test_needs_the_run_scope(self, call, claims):
        result = call('estimate_seo_keywords', SERP, claims(scope=f'openid {READ_SCOPE} {WRITE_SCOPE}'))

        assert structured_error(result).startswith('This tool needs the ')

    def test_refuses_a_keywords_token_for_a_local_lookup(self, call, spend):
        token = confirmation_of(call('estimate_seo_keywords', SERP))

        result = spend('run_seo_local', {'lookup': 'serp', 'keyword': 'hotel coruña'}, token=token)

        assert structured_error(result) == OTHER_ARGUMENTS

    def test_passes_on_only_the_fixed_error_fields_when_dataforseo_fails(self, seo_router, spend):
        seo_router.answer('POST', '/api/seo/serp', 502, {
            'error': 'DataForSEO is unavailable, try again later', 'code': 'UPSTREAM_UNAVAILABLE', 'raw': 'provider text',
        })

        assert spend('run_seo_keywords', SERP)['structuredContent'] == {
            'status': 502, 'error': 'DataForSEO is unavailable, try again later',
        }


class TestDailyLimit:
    def test_refuses_the_second_lookup_when_one_per_day_is_allowed(self, spend, call, monkeypatch):
        monkeypatch.setenv('MCP_LIMITS', json.dumps({'seoCallsPerDay': 1}))
        token = confirmation_of(call('estimate_seo_keywords', SERP))
        spend('run_seo_keywords', SERP)

        result = spend('run_seo_keywords', SERP, token=token)

        assert structured_error(result) == (
            'Limit reached: 1 DataForSEO lookups or SEO jobs per caller per UTC day (resets 2026-10-08T00:00:00Z)'
        )

    def test_counts_each_started_lookup_in_the_seo_counter(self, spend, state_table):
        spend('run_seo_keywords', SERP)

        counter = state_table.partition(f'limit#{CALLER_SUB}')[0]
        assert (counter['sk'], counter['used']) == ('seo_calls#2026-10-07', 1)

    def test_gives_the_use_back_when_the_lookup_failed(self, seo_router, spend, state_table):
        seo_router.answer('POST', '/api/seo/serp', 502, {'error': 'DataForSEO is unavailable, try again later'})
        spend('run_seo_keywords', SERP)

        assert state_table.partition(f'limit#{CALLER_SUB}')[0]['used'] == 0

    def test_gives_no_token_when_todays_seo_calls_are_used_up(self, estimated, monkeypatch):
        monkeypatch.setenv('MCP_LIMITS', json.dumps({'seoCallsPerDay': 0}))

        assert estimated('estimate_seo_keywords', SERP)['can_start'] is False


class TestJobs:
    def test_refuses_a_job_estimate_to_a_users_member(self, call):
        assert structured_error(call('estimate_seo_job', RANK_RUN)) == 'This tool is for administrators'

    def test_counts_the_trackers_keyword_device_checks_from_the_free_estimate(self, estimated, seo_router, admin):
        data = estimated('estimate_seo_job', RANK_RUN, admin)

        assert data['dataforseo_calls'] == 6
        assert json.loads(seo_router.requests('POST', ESTIMATE_PATH)[0]['body']) == {'tracker_id': 'trk-1'}

    def test_blocks_a_rank_run_of_a_tracker_without_keywords(self, estimated, seo_router, admin):
        seo_router.answer('POST', ESTIMATE_PATH, 200, {'keyword_count': 0, 'pairs': 0})

        data = estimated('estimate_seo_job', RANK_RUN, admin)

        assert (data['can_start'], data['reason']) == (False, 'The tracker has no keywords to check')

    def test_answers_the_api_refusal_when_the_tracker_is_unknown(self, seo_router, call, admin):
        seo_router.answer('POST', ESTIMATE_PATH, 404, {'error': 'Rank tracker not found', 'code': 'NOT_FOUND'})

        assert call('estimate_seo_job', RANK_RUN, admin)['structuredContent']['status'] == 404

    def test_starts_the_rank_run_after_the_estimate(self, spend, admin):
        assert spend('start_seo_job', RANK_RUN, who=admin)['structuredContent'] == {'run': {'run_id': 'run-1'}}

    def test_counts_one_summary_per_tracked_domain_for_a_backlinks_snapshot(self, estimated, admin):
        assert estimated('estimate_seo_job', {'job': 'backlinks_snapshot'}, admin)['dataforseo_calls'] == 2

    def test_blocks_a_backlinks_snapshot_without_tracked_domains(self, estimated, seo_router, admin):
        seo_router.answer('GET', SNAPSHOT_PATH, 200, {'domains': []})

        assert estimated('estimate_seo_job', {'job': 'backlinks_snapshot'}, admin)['can_start'] is False

    def test_counts_one_queued_call_per_grid_point(self, estimated, admin):
        data = estimated('estimate_seo_job', {'job': 'rank_grid', 'keyword': 'hotel', 'grid_size': 5}, admin)

        assert data['dataforseo_calls'] == 25

    def test_lets_a_site_audit_start_without_dataforseo_calls(self, estimated, admin):
        data = estimated('estimate_seo_job', {'job': 'site_audit', 'start_url': 'https://example.com/'}, admin)

        assert (data['dataforseo_calls'], data['can_start']) == (0, True)
