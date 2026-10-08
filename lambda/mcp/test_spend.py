"""
The two-step spend operations over the wire: estimates, confirmation tokens, per-caller limits, audit, and starts.
"""

from __future__ import annotations

import json
from datetime import timedelta

import pytest
import state
from spend import RESEARCH_PROVIDERS

from testing.mcp_result_fixtures import READ_SCOPE, RUN_SCOPE, WRITE_SCOPE, text_block
from testing.mcp_spend_fixtures import (
    CALLER_SUB,
    EXECUTION_ARN,
    EXPAND,
    GROUP_ID,
    GROUP_SCOPE,
    NOW,
    SPEND_API_FUNCTIONS,
    TRIGGER,
    FakeRouters,
    confirmation_of,
    execution,
    keyword_page,
    keywords,
    provider,
    setup_deployment,
    structured_error,
)
from testing.mcp_state_fixtures import FakeStateTable, install_fake_table

ALL_SCOPES = f'openid {READ_SCOPE} {WRITE_SCOPE} {RUN_SCOPE}'
USED_TOKEN = 'The confirmation_token is unknown, already used or expired; call the estimate again'
OTHER_ARGUMENTS = 'The confirmation_token was issued for other arguments; call the estimate again with these'
STATUS_PATH = f'/api/executions/{EXECUTION_ARN}'
#: Each start and the estimate that confirms it.
ESTIMATE_OF = {'start_run': 'estimate_run', 'start_research': 'estimate_research', 'generate_content_brief': 'estimate_content_brief'}


@pytest.fixture(autouse=True)
def spend_env(monkeypatch):
    monkeypatch.setenv('MCP_STATE_TABLE', 'test-mcp-state')
    monkeypatch.setenv('MCP_API_FUNCTIONS', json.dumps(SPEND_API_FUNCTIONS))
    monkeypatch.delenv('MCP_LIMITS', raising=False)
    monkeypatch.setattr(state, 'utc_now', lambda: NOW)


@pytest.fixture(autouse=True)
def table(monkeypatch) -> FakeStateTable:
    return install_fake_table(monkeypatch)


@pytest.fixture
def routers(api) -> FakeRouters:
    """The sample deployment with four active keywords in the group."""
    fake = FakeRouters(api.client)
    setup_deployment(fake, keywords(4))
    return fake


@pytest.fixture
def admin(claims):
    return claims(scope=ALL_SCOPES, **{'cognito:groups': 'Admin'})


@pytest.fixture
def member(claims):
    """A ``Users`` member with every scope."""
    return claims(scope=ALL_SCOPES)


@pytest.fixture
def limits(monkeypatch):
    """``limits(runsPerDay=1, ...)``: set ``MCP_LIMITS`` for the test."""
    def set_limits(**values: int) -> None:
        monkeypatch.setenv('MCP_LIMITS', json.dumps(values))

    return set_limits


@pytest.fixture
def call(rpc, admin):
    """``call(name, arguments, who=admin)``: the ``tools/call`` result (or error response) of one tool."""
    def run(name: str, arguments: dict, who: dict | None = None) -> dict:
        response = rpc('tools/call', {'name': name, 'arguments': arguments}, claims_override=who or admin)
        return response.get('result', response)

    return run


@pytest.fixture
def estimate(call):
    """``estimate(name, arguments, who=admin)``: the confirmation token the estimate returned."""
    def run(name: str, arguments: dict, who: dict | None = None) -> str:
        return confirmation_of(call(name, arguments, who))

    return run


@pytest.fixture
def spend(call, estimate):
    """``spend(start, arguments, token=None, who=admin)``: a start with ``token``, or with a fresh estimate's."""
    def run(name: str, arguments: dict, token: str | None = None, who: dict | None = None) -> dict:
        confirmation = token if token is not None else estimate(ESTIMATE_OF[name], arguments, who)
        return call(name, {**arguments, 'confirmation_token': confirmation}, who)

    return run


class TestEstimateRun:
    def test_counts_keywords_times_personas_times_providers(self, call, routers):
        data = call('estimate_run', GROUP_SCOPE)['structuredContent']

        assert (data['keywords'], data['personas'], data['provider_calls']) == (4, 2, 24)

    def test_names_the_engines_and_search_providers_a_run_calls(self, call, routers):
        data = call('estimate_run', GROUP_SCOPE)['structuredContent']

        assert (data['engines'], data['search_providers'], data['serpapi_enabled']) == (['openai', 'perplexity'], ['brave'], False)

    def test_reads_the_groups_active_keywords(self, call, routers):
        call('estimate_run', GROUP_SCOPE)

        assert routers.requests('GET', '/api/keywords')[0]['queryStringParameters'] == {
            'status': 'active', 'limit': '1000', 'group_id': GROUP_ID,
        }

    def test_returns_a_confirmation_token_valid_five_minutes(self, call, routers):
        data = call('estimate_run', GROUP_SCOPE)['structuredContent']

        assert (data['can_start'], data['expires_at']) == (True, '2026-10-07T09:35:00Z')
        assert len(data['confirmation_token']) >= 40

    def test_tells_the_model_to_show_the_estimate_and_wait_before_start_run(self, call, routers):
        summary, _data = text_block(call('estimate_run', GROUP_SCOPE))

        assert summary.startswith('estimate_run: 4 keyword(s) x 2 persona(s) x 3 provider(s) = 24 provider call(s)')
        assert 'only after they approve, call start_run' in summary

    def test_stores_only_a_hash_of_the_token(self, estimate, routers, table):
        token = estimate('estimate_run', GROUP_SCOPE)

        assert token not in json.dumps(list(table.items.values()))

    def test_counts_only_the_listed_keyword_ids_that_are_active(self, call, routers):
        data = call('estimate_run', {'keyword_ids': ['kw_1', 'kw_3', 'kw_gone']})['structuredContent']

        assert data['keywords'] == 2

    def test_follows_keyword_pages_to_the_end(self, call, routers):
        pages = {None: keyword_page(keywords(3), 'next-1'), 'next-1': keyword_page(keywords(2, prefix='b'))}
        routers.answer_with('GET', '/api/keywords', lambda event: (200, pages[event['queryStringParameters'].get('next_token')]))

        assert call('estimate_run', {'all': True})['structuredContent']['keywords'] == 5

    @pytest.mark.parametrize(('market_id', 'count'), [('cl-es', 3), ('global', 2)])
    def test_counts_only_the_keywords_of_the_market(self, call, routers, market_id, count):
        page = keyword_page([*keywords(2), *({**item, 'market_id': 'cl-es'} for item in keywords(3, prefix='cl'))])
        routers.answer_with('GET', '/api/keywords', lambda _event: (200, page))

        assert call('estimate_run', {'all': True, 'market_id': market_id})['structuredContent']['keywords'] == count

    def test_reports_the_runs_left_today(self, call, routers):
        assert call('estimate_run', GROUP_SCOPE)['structuredContent']['limits'] == {
            'used_today': 0, 'per_day': 5, 'resets_at': '2026-10-08T00:00:00Z', 'runs_in_flight_allowed': 1,
        }


class TestEstimateRunBlockers:
    def test_gives_no_token_for_a_scope_without_active_keywords(self, call, routers):
        routers.answer('GET', '/api/keywords', 200, keyword_page([]))

        data = call('estimate_run', GROUP_SCOPE)['structuredContent']

        assert (data['can_start'], data['reason'], 'confirmation_token' in data) == (False, 'No active keywords match the scope', False)

    def test_gives_no_token_above_the_keyword_cap(self, call, routers, limits):
        limits(maxRunKeywords=3)

        data = call('estimate_run', GROUP_SCOPE)['structuredContent']

        assert data['reason'] == '4 keywords exceed the MCP keyword cap of 3 per run; narrow the scope'

    def test_gives_no_token_without_an_enabled_provider(self, call, routers):
        routers.answer('GET', '/api/providers', 200, {'providers': [provider('openai', 'llm', enabled=False)]})

        assert call('estimate_run', GROUP_SCOPE)['structuredContent']['reason'] == 'No AI engine or search provider is enabled with a key'

    def test_gives_no_token_when_todays_runs_are_used_up(self, call, routers, limits):
        limits(runsPerDay=0)

        reason = call('estimate_run', GROUP_SCOPE)['structuredContent']['reason']

        assert reason == 'Limit reached: 0 analysis runs per caller per UTC day (resets 2026-10-08T00:00:00Z)'

    def test_answers_a_failed_api_read_as_a_tool_error_with_its_status(self, call, routers):
        routers.answer('GET', '/api/providers', 500, {'error': 'Provider table unavailable'})

        result = call('estimate_run', GROUP_SCOPE)

        assert (result['isError'], result['structuredContent']) == (True, {'status': 500, 'error': 'Provider table unavailable'})

    def test_refuses_a_users_member_before_any_api_call(self, call, routers, member):
        result = call('estimate_run', GROUP_SCOPE, member)

        assert (result['isError'], routers.events) == (True, [])
        assert result['structuredContent'] == {'error': 'This tool is for administrators'}

    def test_refuses_a_token_without_the_run_scope(self, call, routers, claims):
        result = call('estimate_run', GROUP_SCOPE, claims(scope=f'openid {READ_SCOPE} {WRITE_SCOPE}', **{'cognito:groups': 'Admin'}))

        assert result['structuredContent'] == {'error': f'This tool needs the {RUN_SCOPE} scope'}


class TestOtherEstimates:
    def test_counts_one_call_per_web_search_provider_with_a_key_even_when_disabled_for_runs(self, call, routers, member):
        data = call('estimate_research', EXPAND, member)['structuredContent']

        assert (data['web_search_providers'], data['provider_calls'], data['bedrock_calls']) == (['perplexity', 'openai', 'gemini'], 3, 0)

    def test_estimates_the_agents_upper_bounds_with_google_signals(self, call, routers, member):
        routers.answer('GET', '/api/providers', 200, {'providers': [provider('openai', 'llm'), provider('serpapi', 'search')]})
        arguments = {'kind': 'agent', 'seed': 'hotels in galicia', 'dimensions': ['location'], 'max_rounds': 3}

        data = call('estimate_research', arguments, member)['structuredContent']

        assert (data['provider_calls'], data['bedrock_calls']) == (27, 5)

    def test_gives_no_research_token_without_a_web_search_provider_key(self, call, routers, member):
        routers.answer('GET', '/api/providers', 200, {'providers': [provider('brave', 'search')]})

        reason = call('estimate_research', EXPAND, member)['structuredContent']['reason']

        assert reason == 'No web-search provider (Perplexity, OpenAI, Gemini) has an API key'

    def test_research_needs_the_write_scope(self, call, routers, claims):
        result = call('estimate_research', EXPAND, claims(scope=f'openid {READ_SCOPE} {RUN_SCOPE}'))

        assert result['structuredContent'] == {'error': f'This tool needs the {WRITE_SCOPE} scope'}

    def test_research_providers_match_the_web_search_registry(self):
        from shared.ai_clients import WEB_SEARCH_PROVIDERS

        assert tuple(entry.provider_id for entry in WEB_SEARCH_PROVIDERS) == RESEARCH_PROVIDERS

    def test_estimates_one_bedrock_generation_for_a_content_brief(self, call, routers, member):
        data = call('estimate_content_brief', GROUP_SCOPE, member)['structuredContent']

        assert (data['bedrock_calls'], data['page_fetches'], data['can_start']) == (1, 0, True)

    def test_counts_the_page_fetch_of_an_improve_current_url_brief(self, call, routers, member):
        arguments = {**GROUP_SCOPE, 'content_angle': 'improve_current_url', 'landing_url': 'https://aurora.example/miles'}

        assert call('estimate_content_brief', arguments, member)['structuredContent']['page_fetches'] == 1


class TestStartRun:
    def test_starts_the_estimated_scope_with_the_token(self, spend, routers):
        result = spend('start_run', GROUP_SCOPE)

        assert result['structuredContent']['execution_arn'] == EXECUTION_ARN
        assert json.loads(routers.requests(*TRIGGER)[0]['body']) == {'scope': {'mode': 'groups', 'group_ids': [GROUP_ID]}}

    def test_a_token_starts_at_most_one_run(self, spend, estimate, routers):
        token = estimate('estimate_run', GROUP_SCOPE)
        spend('start_run', GROUP_SCOPE, token=token)

        assert structured_error(spend('start_run', GROUP_SCOPE, token=token)) == USED_TOKEN
        assert len(routers.requests(*TRIGGER)) == 1

    def test_refuses_a_token_estimated_for_another_scope(self, spend, estimate, routers):
        result = spend('start_run', {'all': True}, token=estimate('estimate_run', GROUP_SCOPE))

        assert (structured_error(result), routers.requests(*TRIGGER)) == (OTHER_ARGUMENTS, [])

    def test_refuses_a_token_issued_to_another_user(self, spend, estimate, routers, claims):
        other = claims(scope=ALL_SCOPES, sub='99999999-0000-0000-0000-000000000000', **{'cognito:groups': 'Admin'})

        result = spend('start_run', GROUP_SCOPE, token=estimate('estimate_run', GROUP_SCOPE), who=other)

        assert structured_error(result) == 'The confirmation_token was issued to another user'

    def test_refuses_a_token_older_than_five_minutes(self, spend, estimate, routers, monkeypatch):
        token = estimate('estimate_run', GROUP_SCOPE)
        monkeypatch.setattr(state, 'utc_now', lambda: NOW + timedelta(minutes=5, seconds=1))

        result = spend('start_run', GROUP_SCOPE, token=token)

        assert structured_error(result) == 'The confirmation_token has expired (5 minutes); call the estimate again'

    def test_refuses_an_unknown_token_without_calling_the_trigger(self, spend, routers):
        result = spend('start_run', GROUP_SCOPE, token='made-up')

        assert (result['isError'], routers.requests(*TRIGGER)) == (True, [])

    def test_needs_the_confirmation_token_argument(self, call, routers):
        assert call('start_run', GROUP_SCOPE)['error'] == {'code': -32602, 'message': 'Missing required argument(s): confirmation_token'}

    def test_records_the_started_execution_for_the_in_flight_check(self, spend, routers, table):
        spend('start_run', GROUP_SCOPE)

        assert [run['execution_arn'] for run in table.partition(f'runs#{CALLER_SUB}')] == [EXECUTION_ARN]


class TestStartRunLimits:
    def test_refuses_while_the_previous_run_is_still_running_and_names_it(self, spend, routers):
        spend('start_run', GROUP_SCOPE)
        routers.answer('GET', STATUS_PATH, 200, execution('RUNNING'))

        result = spend('start_run', GROUP_SCOPE)

        assert structured_error(result) == (
            'Limit reached: 1 analysis run(s) in flight per caller; wait until it finishes '
            f'(get_run_status with execution_arn {EXECUTION_ARN})'
        )
        assert len(routers.requests(*TRIGGER)) == 1

    def test_starts_again_once_the_previous_run_succeeded(self, spend, routers):
        spend('start_run', GROUP_SCOPE)
        routers.answer('GET', STATUS_PATH, 200, execution('SUCCEEDED'))

        spend('start_run', GROUP_SCOPE)

        assert len(routers.requests(*TRIGGER)) == 2

    def test_checks_a_finished_run_only_once(self, spend, routers):
        spend('start_run', GROUP_SCOPE)
        routers.answer('GET', STATUS_PATH, 200, execution('FAILED'))
        spend('start_run', GROUP_SCOPE)

        spend('start_run', GROUP_SCOPE)

        assert len(routers.requests('GET', STATUS_PATH)) == 2

    def test_counts_a_run_whose_status_cannot_be_read_as_running(self, spend, routers):
        spend('start_run', GROUP_SCOPE)
        routers.answer('GET', STATUS_PATH, 500, {'error': 'Throttled'})

        assert spend('start_run', GROUP_SCOPE)['isError'] is True

    def test_refuses_beyond_the_runs_per_day_and_names_the_reset(self, spend, estimate, routers, limits):
        limits(runsPerDay=1, runsInFlight=5)
        token = estimate('estimate_run', GROUP_SCOPE)
        spend('start_run', GROUP_SCOPE)

        result = spend('start_run', GROUP_SCOPE, token=token)

        assert structured_error(result) == 'Limit reached: 1 analysis runs per caller per UTC day (resets 2026-10-08T00:00:00Z)'

    def test_gives_the_days_run_back_when_the_api_refuses_to_start(self, spend, routers):
        routers.answer(*TRIGGER, 400, {'error': 'No active keywords match the selected scope'})

        result = spend('start_run', GROUP_SCOPE)

        assert (result['structuredContent']['status'], state.used_today(CALLER_SUB, 'runs')) == (400, 0)

    def test_counts_the_keywords_again_at_start(self, spend, estimate, routers, limits):
        limits(maxRunKeywords=4)
        token = estimate('estimate_run', GROUP_SCOPE)
        routers.answer('GET', '/api/keywords', 200, keyword_page(keywords(5)))

        result = spend('start_run', GROUP_SCOPE, token=token)

        assert structured_error(result) == 'The scope has more than 4 keywords, the MCP keyword cap per run'

    def test_refuses_while_another_start_of_the_caller_holds_the_lock(self, spend, estimate, routers):
        token = estimate('estimate_run', GROUP_SCOPE)
        state.acquire_run_lock(CALLER_SUB)

        result = spend('start_run', GROUP_SCOPE, token=token)

        assert structured_error(result) == 'Another start_run of yours is in progress; try again in a minute'

    def test_releases_the_lock_after_a_start(self, spend, routers):
        spend('start_run', GROUP_SCOPE)

        assert state.acquire_run_lock(CALLER_SUB) is True


class TestAudit:
    def test_logs_a_token_refusal_with_its_reason(self, spend, routers, audit):
        spend('start_run', GROUP_SCOPE, token='made-up')

        line = audit()[-1]
        assert (line['operation'], line['outcome'], line['reason']) == ('start_run', 'token_refused', USED_TOKEN)

    def test_records_spend_calls_in_the_state_table(self, spend, routers, table):
        spend('start_run', GROUP_SCOPE)

        records = table.partition(f'audit#{CALLER_SUB}')
        assert [(record['operation'], record['outcome']) for record in records] == [('estimate_run', 'estimated'), ('start_run', 'http_200')]

    def test_keeps_audit_records_for_365_days(self, call, routers, table):
        call('estimate_run', GROUP_SCOPE)

        assert table.partition(f'audit#{CALLER_SUB}')[0]['ttl'] == int((NOW + timedelta(days=365)).timestamp())

    def test_never_logs_the_confirmation_token(self, spend, estimate, routers, caplog):
        token = estimate('estimate_run', GROUP_SCOPE)
        spend('start_run', GROUP_SCOPE, token=token)

        assert token not in caplog.text


class TestResearchAndContentStarts:
    def test_lets_a_users_member_start_the_estimated_research_job(self, spend, routers, member):
        result = spend('start_research', EXPAND, who=member)

        assert result['structuredContent'] == {'id': 'job_1', 'status': 'pending'}
        assert json.loads(routers.requests('POST', '/api/keyword-research/expand')[0]['body']) == {'seed_keyword': 'boutique hotel galicia'}

    def test_generates_the_estimated_brief(self, spend, routers, member):
        spend('generate_content_brief', GROUP_SCOPE, who=member)

        idea = json.loads(routers.requests('POST', '/api/content-studio/generate')[0]['body'])['idea']
        assert (idea['type'], idea['scope']) == ('group_brief', {'mode': 'groups', 'group_ids': [GROUP_ID]})

    def test_shares_the_daily_job_limit_between_research_and_content(self, spend, estimate, routers, member, limits):
        limits(jobsPerDay=1)
        content_token = estimate('estimate_content_brief', GROUP_SCOPE, member)
        spend('start_research', EXPAND, who=member)

        result = spend('generate_content_brief', GROUP_SCOPE, token=content_token, who=member)

        assert structured_error(result) == 'Limit reached: 1 research or content jobs per caller per UTC day (resets 2026-10-08T00:00:00Z)'

    def test_a_research_token_cannot_generate_content(self, spend, estimate, routers, member):
        token = estimate('estimate_research', EXPAND, member)

        result = spend('generate_content_brief', GROUP_SCOPE, token=token, who=member)

        assert structured_error(result) == OTHER_ARGUMENTS
