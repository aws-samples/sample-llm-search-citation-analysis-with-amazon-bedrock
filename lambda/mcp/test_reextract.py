"""
The brand re-extract tools: their routes, the ``reextract`` spend family (estimate, token, start, daily limit) and stop.
"""

from __future__ import annotations

import json

import pytest
import state
from catalogue import InvalidArguments, build_route, find_operation

from testing.mcp_spend_fixtures import CALLER_SUB, NOW, FakeRouters, confirmation_of, structured_error

FILTERS = {'group_ids': ['grp_borealis'], 'keyword_ids': ['kw_7'], 'since': '2026-09-01', 'until': '2026-09-30',
           'only_outdated': False}
#: What the start and the estimate post for ``FILTERS``.
FILTERS_BODY = dict(FILTERS)
GROUP_FILTER = {'group_ids': ['grp_borealis']}
GROUP_BODY = {'group_ids': ['grp_borealis'], 'only_outdated': True}
ESTIMATE_PATH = '/api/reextract/estimate'
START = ('POST', '/api/reextract')
MODEL = 'global.anthropic.claude-haiku-5-5'
ESTIMATE_ANSWER = {'answers': 1210, 'answers_current': 183, 'keywords': 85, 'estimated_cost_usd': 3.42, 'model': MODEL,
                   'brands_version': 2, 'truncated': False, 'filters': GROUP_BODY}
JOB = {'job_id': 'rx-0a1b2c', 'status': 'running', 'answers_total': 1210, 'answers_done': 0}
RESETS = '2026-10-08T00:00:00Z'
OTHER_ARGUMENTS = 'The confirmation_token was issued for other arguments; call the estimate again with these'
ADMIN_ONLY = ['get_reextract_status', 'estimate_reextract', 'start_reextract', 'stop_reextract']


@pytest.fixture(autouse=True)
def config_router(monkeypatch, api) -> FakeRouters:
    """The config-mgmt router behind a frozen clock: an estimate, a start, the status and a stop."""
    fake = FakeRouters(api.client)
    monkeypatch.setattr(state, 'utc_now', lambda: NOW)
    monkeypatch.setenv('MCP_API_FUNCTIONS', json.dumps({'config-mgmt': 'CitationAnalysis-API-ConfigMgmt'}))
    fake.answer('POST', ESTIMATE_PATH, 200, ESTIMATE_ANSWER)
    fake.answer(*START, 202, {'job': JOB})
    fake.answer('GET', '/api/reextract', 200, {'job': JOB, 'active': True})
    fake.answer('POST', '/api/reextract/rx-0a1b2c/stop', 200, {'job': {**JOB, 'status': 'stopping'}})
    return fake


@pytest.fixture
def tool(rpc, admin):
    """``tool(name, arguments, who=admin)``: the JSON-RPC response of one ``tools/call``."""
    return lambda name, arguments, who=None: rpc('tools/call', {'name': name, 'arguments': arguments}, claims_override=who or admin)


@pytest.fixture
def estimated(tool):
    """``estimated(arguments)``: the tool result of ``estimate_reextract``."""
    return lambda arguments: tool('estimate_reextract', arguments)['result']


@pytest.fixture
def started(tool, estimated):
    """``started(arguments, token=None)``: ``start_reextract`` with ``token``, or with a fresh estimate's."""
    def start(arguments: dict, token: str | None = None) -> dict:
        confirmation = token if token is not None else confirmation_of(estimated(arguments))
        return tool('start_reextract', {**arguments, 'confirmation_token': confirmation})['result']

    return start


@pytest.fixture
def limits(monkeypatch):
    """``limits(reextractsPerDay=1)``: set ``MCP_LIMITS`` for the test."""
    return lambda **values: monkeypatch.setenv('MCP_LIMITS', json.dumps(values))


class TestRoutes:
    def test_status_reads_the_newest_job_from_config_mgmt(self):
        route = build_route(find_operation('get_reextract_status'), {})[1]

        assert (route.router, route.method, route.path, route.body) == ('config-mgmt', 'GET', '/api/reextract', None)

    def test_start_posts_every_filter_to_the_reextract_route(self):
        route = build_route(find_operation('start_reextract'), {**FILTERS, 'confirmation_token': 'abc'})[1]

        assert (route.router, route.method, route.path, route.body) == ('config-mgmt', 'POST', '/api/reextract', FILTERS_BODY)

    def test_sends_only_outdated_true_when_the_call_leaves_it_out(self):
        assert build_route(find_operation('estimate_reextract'), GROUP_FILTER)[1].body == GROUP_BODY

    def test_sends_only_outdated_alone_when_no_filter_is_given(self):
        assert build_route(find_operation('estimate_reextract'), {})[1].body == {'only_outdated': True}

    @pytest.mark.parametrize('day', ['2026/09/01', '20260901', '2026-02-30', '2026-9-1', ''])
    def test_rejects_a_since_that_is_not_a_real_yyyy_mm_dd_day(self, day):
        with pytest.raises(InvalidArguments, match='since must be a date YYYY-MM-DD'):
            build_route(find_operation('estimate_reextract'), {'since': day})

    def test_rejects_an_until_that_is_not_a_string(self):
        with pytest.raises(InvalidArguments, match='until must be of type string'):
            build_route(find_operation('estimate_reextract'), {'until': 20260930})

    def test_stop_posts_to_the_jobs_stop_route(self):
        route = build_route(find_operation('stop_reextract'), {'job_id': 'rx-0a1b2c'})[1]

        assert (route.method, route.path, route.resource, route.path_params) == (
            'POST', '/api/reextract/rx-0a1b2c/stop', '/api/reextract/{id}/stop', {'id': 'rx-0a1b2c'},
        )

    @pytest.mark.parametrize('job_id', ['../alerts', 'rx/1', 'rx 1', '', 'x' * 65])
    def test_stop_rejects_a_job_id_that_is_not_one_path_segment(self, job_id):
        with pytest.raises(InvalidArguments, match='job_id must be an id of letters, digits, - or _'):
            build_route(find_operation('stop_reextract'), {'job_id': job_id})

    @pytest.mark.parametrize('name', ADMIN_ONLY)
    def test_every_reextract_tool_is_for_admins(self, name):
        assert find_operation(name).admin is True

    def test_the_start_tells_the_model_it_spends_bedrock_credit(self):
        assert 'spends Bedrock credit' in find_operation('start_reextract').description


class TestEstimate:
    def test_posts_the_filters_to_the_estimate_route(self, estimated, config_router):
        estimated(FILTERS)

        assert json.loads(config_router.requests('POST', ESTIMATE_PATH)[0]['body']) == FILTERS_BODY

    def test_states_the_answer_count_and_the_bedrock_cost_in_usd(self, estimated):
        summary = estimated(GROUP_FILTER)['content'][0]['text']

        assert summary.startswith(
            f'estimate_reextract: 1210 stored answer(s) of 85 keyword(s) to re-extract with {MODEL}; '
            'estimated Bedrock cost $3.42 USD. Show this to the user; only after they approve, call start_reextract',
        )

    def test_passes_the_api_counts_on_with_a_token(self, estimated):
        data = estimated(GROUP_FILTER)['structuredContent']

        assert (data['answers'], data['answers_current'], data['estimated_cost_usd'], data['can_start']) == (1210, 183, 3.42, True)

    def test_keeps_a_cost_under_one_cent_visible(self, estimated, config_router):
        config_router.answer('POST', ESTIMATE_PATH, 200, {**ESTIMATE_ANSWER, 'estimated_cost_usd': 0.0042})

        assert 'estimated Bedrock cost $0.0042 USD' in estimated(GROUP_FILTER)['content'][0]['text']

    def test_calls_a_count_cut_by_the_deadline_a_lower_bound(self, estimated, config_router):
        config_router.answer('POST', ESTIMATE_PATH, 200, {**ESTIMATE_ANSWER, 'truncated': True})

        assert 'at least 1210 stored answer(s) of at least 85 keyword(s)' in estimated(GROUP_FILTER)['content'][0]['text']

    def test_gives_no_token_when_no_answer_matches(self, estimated, config_router):
        config_router.answer('POST', ESTIMATE_PATH, 200, {**ESTIMATE_ANSWER, 'answers': 0, 'keywords': 0})

        data = estimated(GROUP_FILTER)['structuredContent']

        assert {key: data.get(key) for key in ('can_start', 'reason', 'confirmation_token')} == {
            'can_start': False, 'reason': 'No stored answer matches the filters; nothing to re-extract', 'confirmation_token': None,
        }

    def test_answers_an_api_refusal_as_a_tool_error_with_its_status(self, estimated, config_router):
        config_router.answer('POST', ESTIMATE_PATH, 400, {'error': 'Unknown group id'})

        result = estimated({'group_ids': ['grp_gone']})

        assert (result['isError'], result['structuredContent']) == (True, {'status': 400, 'error': 'Unknown group id'})

    def test_refuses_a_users_member_before_any_api_call(self, tool, member, config_router):
        result = tool('estimate_reextract', GROUP_FILTER, member)['result']

        assert (structured_error(result), config_router.events) == ('This tool is for administrators', [])


class TestStart:
    def test_starts_the_estimated_filters_with_the_token(self, started, config_router):
        result = started(FILTERS)

        assert result['structuredContent'] == {'job': JOB}
        assert json.loads(config_router.requests(*START)[0]['body']) == FILTERS_BODY

    def test_needs_the_confirmation_token_argument(self, tool):
        assert tool('start_reextract', GROUP_FILTER)['error'] == {
            'code': -32602, 'message': 'Missing required argument(s): confirmation_token',
        }

    def test_refuses_an_unknown_token_without_starting(self, started, config_router):
        result = started(GROUP_FILTER, token='made-up')

        assert (result['isError'], config_router.requests(*START)) == (True, [])

    def test_refuses_a_token_estimated_for_other_filters(self, started, estimated, config_router):
        token = confirmation_of(estimated(GROUP_FILTER))

        result = started({**GROUP_FILTER, 'only_outdated': False}, token=token)

        assert (structured_error(result), config_router.requests(*START)) == (OTHER_ARGUMENTS, [])

    def test_gives_the_days_use_back_when_a_job_is_already_running(self, started, config_router):
        config_router.answer(*START, 409, {'error': 'A re-extract is already running', 'job': JOB})

        result = started(GROUP_FILTER)

        assert (result['structuredContent']['status'], state.used_today(CALLER_SUB, 'reextracts')) == (409, 0)

    def test_records_the_estimate_and_the_start_in_the_audit(self, started, state_table):
        started(GROUP_FILTER)

        records = state_table.partition(f'audit#{CALLER_SUB}')
        assert [(record['operation'], record['outcome']) for record in records] == [
            ('estimate_reextract', 'estimated'), ('start_reextract', 'http_202'),
        ]


class TestDailyLimit:
    def test_reports_two_reextracts_a_day_by_default(self, estimated):
        assert estimated(GROUP_FILTER)['structuredContent']['limits'] == {'used_today': 0, 'per_day': 2, 'resets_at': RESETS}

    def test_gives_no_token_once_todays_reextracts_are_used_up(self, started, estimated, limits):
        limits(reextractsPerDay=1)
        started(GROUP_FILTER)

        reason = estimated(GROUP_FILTER)['structuredContent']['reason']

        assert reason == f'Limit reached: 1 re-extract jobs per caller per UTC day (resets {RESETS})'

    def test_refuses_a_start_past_the_limit_with_an_earlier_token(self, started, estimated, limits, config_router):
        limits(reextractsPerDay=1)
        token = confirmation_of(estimated(GROUP_FILTER))
        started(GROUP_FILTER)

        result = started(GROUP_FILTER, token=token)

        assert structured_error(result) == f'Limit reached: 1 re-extract jobs per caller per UTC day (resets {RESETS})'
        assert len(config_router.requests(*START)) == 1

    def test_does_not_draw_on_the_research_and_content_job_limit(self, estimated, limits):
        limits(jobsPerDay=0)

        assert estimated(GROUP_FILTER)['structuredContent']['can_start'] is True


class TestStatusAndStop:
    def test_status_answers_the_newest_job(self, tool):
        assert tool('get_reextract_status', {})['result']['structuredContent'] == {'job': JOB, 'active': True}

    def test_status_is_refused_to_a_users_member(self, tool, member):
        assert structured_error(tool('get_reextract_status', {}, member)['result']) == 'This tool is for administrators'

    def test_stop_answers_the_stopping_job(self, tool):
        result = tool('stop_reextract', {'job_id': 'rx-0a1b2c'})['result']

        assert result['structuredContent']['job']['status'] == 'stopping'

    def test_stop_rejects_a_path_as_the_job_id_without_an_api_call(self, tool, config_router):
        response = tool('stop_reextract', {'job_id': '../alerts'})

        assert (response['error']['code'], config_router.events) == (-32602, [])
