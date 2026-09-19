"""
Tests for the ResearchWorker Lambda (keyword research state machine steps).

- plan: one pending step per configured provider; a retry re-runs only the
  steps that did not complete; no provider configured fails the job
- execute_step: writes the provider's result to its own step, turns provider
  errors and unparseable output into a failed step (never an exception), and
  bounds in-process retries
- fail_step: records a crashed step without overwriting a completed one
- finalize: persists the merged result and the status the steps imply
- fail: marks the job and its unfinished steps failed
"""

from __future__ import annotations

import os
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

from shared.ai_clients import WEB_SEARCH_PROVIDERS
from testing.module_loader import load_handler_module_offline

_mod = load_handler_module_offline(os.path.dirname(__file__), 'handler.py', 'research_worker_under_test')

_PERPLEXITY, _OPENAI, _GEMINI = WEB_SEARCH_PROVIDERS


def _table_with(job: dict | None) -> MagicMock:
    table = MagicMock()
    table.get_item.return_value = {'Item': job} if job is not None else {}
    return table


def _expansion_job(**overrides) -> dict:
    return {
        'id': 'job-1', 'type': 'expansion', 'status': 'pending', 'seed_keyword': 'hotel malaga',
        'industry': 'hotels', 'count': 20, 'steps': {}, 'created_at': '2026-09-18T10:00:00Z',
        **overrides,
    }


def _competitor_job(**overrides) -> dict:
    return {
        'id': 'job-2', 'type': 'competitor', 'status': 'pending', 'url': 'https://example.com/rooms',
        'domain': 'example.com', 'steps': {}, 'created_at': '2026-09-18T10:00:00Z',
        **overrides,
    }


def _configured(*providers):
    return MagicMock(return_value=[(provider, object()) for provider in providers])


def _step_writes(table: MagicMock) -> list[dict]:
    """Every step object written through `SET steps.#sid = :step`."""
    return [
        call.kwargs['ExpressionAttributeValues'][':step']
        for call in table.update_item.call_args_list
        if ':step' in call.kwargs.get('ExpressionAttributeValues', {})
    ]


def _execute_step(job: dict, event: dict, *, api_key: str | None = 'sk-test', **collaborators: MagicMock) -> tuple[dict, MagicMock]:
    """Run one ``execute_step`` event against a table holding ``job``; returns ``(result, table)``.

    ``api_key`` is what ``get_api_key`` answers for the step's provider;
    ``collaborators`` stub the provider call itself (``run_web_search=...`` or
    ``fetch_google_signals=...``).
    """
    table = _table_with(job)
    with (
        patch.object(_mod, 'research_table', table),
        patch.object(_mod, 'get_api_key', MagicMock(return_value=api_key)),
        patch.multiple(_mod, **collaborators),
    ):
        result = _mod.handler(event, None)
    return result, table


class TestPlan:
    def test_creates_one_pending_step_per_configured_provider(self):
        table = _table_with(_expansion_job())

        with (
            patch.object(_mod, 'research_table', table),
            patch.object(_mod, 'get_web_search_clients', _configured(_PERPLEXITY, _OPENAI)),
        ):
            result = _mod.handler({'action': 'plan', 'job_id': 'job-1', 'retry': False}, None)

        assert result == {'job_id': 'job-1', 'steps': [
            {'step_id': 'r1-perplexity', 'provider': 'perplexity'},
            {'step_id': 'r1-openai', 'provider': 'openai'},
        ]}

    def test_marks_the_job_running_with_the_step_total_and_execution_arn(self):
        table = _table_with(_expansion_job())

        with (
            patch.object(_mod, 'research_table', table),
            patch.object(_mod, 'get_web_search_clients', _configured(_PERPLEXITY, _OPENAI, _GEMINI)),
        ):
            _mod.handler({'action': 'plan', 'job_id': 'job-1', 'retry': False, 'execution_arn': 'arn:exec'}, None)

        values = table.update_item.call_args.kwargs['ExpressionAttributeValues']
        assert (values[':running'], values[':total'], values[':arn']) == ('running', 3, 'arn:exec')
        assert set(values[':steps']) == {'r1-perplexity', 'r1-openai', 'r1-gemini'}
        assert all(step['status'] == 'pending' for step in values[':steps'].values())

    def test_retry_reruns_only_the_steps_that_did_not_complete(self):
        job = _expansion_job(status='pending', steps={
            'r1-perplexity': {'provider': 'perplexity', 'status': 'failed', 'error_message': '401'},
            'r1-openai': {'provider': 'openai', 'status': 'completed', 'keywords': [{'keyword': 'x'}]},
            'r1-gemini': {'provider': 'gemini', 'status': 'running'},
        })
        table = _table_with(job)

        with (
            patch.object(_mod, 'research_table', table),
            patch.object(_mod, 'get_web_search_clients', _configured(_PERPLEXITY, _OPENAI, _GEMINI)),
        ):
            result = _mod.handler({'action': 'plan', 'job_id': 'job-1', 'retry': True}, None)

        assert result['steps'] == [
            {'step_id': 'r1-perplexity', 'provider': 'perplexity'},
            {'step_id': 'r1-gemini', 'provider': 'gemini'},
        ]

    def test_retry_resets_only_the_rerun_steps_and_keeps_completed_results(self):
        job = _expansion_job(steps={
            'r1-perplexity': {'provider': 'perplexity', 'status': 'failed', 'error_message': '401'},
            'r1-openai': {'provider': 'openai', 'status': 'completed', 'keywords': [{'keyword': 'x'}]},
        })
        table = _table_with(job)

        with (
            patch.object(_mod, 'research_table', table),
            patch.object(_mod, 'get_web_search_clients', _configured(_PERPLEXITY, _OPENAI)),
        ):
            _mod.handler({'action': 'plan', 'job_id': 'job-1', 'retry': True}, None)

        call = table.update_item.call_args.kwargs
        assert 'steps = :steps' not in call['UpdateExpression']
        assert call['ExpressionAttributeNames']['#st0'] == 'r1-perplexity'
        assert call['ExpressionAttributeValues'][':st0'] == {'provider': 'perplexity', 'status': 'pending'}
        assert call['ExpressionAttributeValues'][':total'] == 2

    def test_retry_of_a_job_without_planned_steps_plans_it_fresh(self):
        table = _table_with(_expansion_job(status='failed', steps={}))

        with (
            patch.object(_mod, 'research_table', table),
            patch.object(_mod, 'get_web_search_clients', _configured(_OPENAI)),
        ):
            result = _mod.handler({'action': 'plan', 'job_id': 'job-1', 'retry': True}, None)

        assert result['steps'] == [{'step_id': 'r1-openai', 'provider': 'openai'}]

    def test_raises_when_no_provider_is_configured(self):
        with (
            patch.object(_mod, 'research_table', _table_with(_expansion_job())),
            patch.object(_mod, 'get_web_search_clients', MagicMock(return_value=[])),
            pytest.raises(_mod.NoProviderConfiguredError),
        ):
            _mod.handler({'action': 'plan', 'job_id': 'job-1', 'retry': False}, None)

    def test_raises_when_the_job_row_is_missing(self):
        with (
            patch.object(_mod, 'research_table', _table_with(None)),
            patch.object(_mod, 'get_web_search_clients', _configured(_OPENAI)),
            pytest.raises(_mod.ResearchJobNotFoundError),
        ):
            _mod.handler({'action': 'plan', 'job_id': 'missing', 'retry': False}, None)

    def test_competitor_plan_scrapes_the_page_once_and_stores_it_on_the_job(self):
        table = _table_with(_competitor_job())
        page = {'success': True, 'title': 'Rooms', 'domain': 'example.com'}

        with (
            patch.object(_mod, 'research_table', table),
            patch.object(_mod, 'get_web_search_clients', _configured(_OPENAI)),
            patch.object(_mod, 'fetch_page_seo_elements', MagicMock(return_value=page)) as fetch,
        ):
            _mod.handler({'action': 'plan', 'job_id': 'job-2', 'retry': False}, None)

        fetch.assert_called_once_with('https://example.com/rooms')
        assert table.update_item.call_args.kwargs['ExpressionAttributeValues'][':page'] == page

    def test_competitor_retry_reuses_the_stored_page_data(self):
        table = _table_with(_competitor_job(page_data={'success': False}, steps={'r1-openai': {'provider': 'openai', 'status': 'failed'}}))

        with (
            patch.object(_mod, 'research_table', table),
            patch.object(_mod, 'get_web_search_clients', _configured(_OPENAI)),
            patch.object(_mod, 'fetch_page_seo_elements', MagicMock()) as fetch,
        ):
            _mod.handler({'action': 'plan', 'job_id': 'job-2', 'retry': True}, None)

        fetch.assert_not_called()


class TestExecuteStep:
    def _event(self, provider: str = 'openai', job_id: str = 'job-1') -> dict:
        return {'action': 'execute_step', 'job_id': job_id, 'step_id': f'r1-{provider}', 'provider': provider}

    def test_writes_the_parsed_keywords_to_the_step(self):
        response_text = '[{"keyword": "hotel malaga centro", "intent": "commercial", "relevance": 9.5}]'

        result, table = _execute_step(_expansion_job(), self._event(), run_web_search=MagicMock(return_value=response_text))

        final = _step_writes(table)[-1]
        assert result['status'] == 'completed'
        assert final['status'] == 'completed'
        assert final['keywords'] == [{'keyword': 'hotel malaga centro', 'intent': 'commercial', 'relevance': Decimal('9.5')}]
        assert final['keyword_count'] == 1

    def test_marks_the_step_running_before_calling_the_provider(self):
        _result, table = _execute_step(_expansion_job(), self._event(), run_web_search=MagicMock(return_value='[]'))

        first, last = _step_writes(table)
        assert first['status'] == 'running'
        assert last['status'] == 'completed'

    def test_writes_each_step_under_its_own_key(self):
        _result, table = _execute_step(_expansion_job(), self._event('gemini'), run_web_search=MagicMock(return_value='[]'))

        call = table.update_item.call_args.kwargs
        assert call['UpdateExpression'] == 'SET steps.#sid = :step, updated_at = :ts'
        assert call['ExpressionAttributeNames'] == {'#sid': 'r1-gemini'}

    def test_bounds_in_process_retries_to_the_step_budget(self):
        run = MagicMock(return_value='[]')

        _execute_step(_expansion_job(), self._event(), run_web_search=run)

        assert run.call_args.kwargs['max_retries'] == 2

    def test_asks_the_provider_for_the_requested_count_about_the_seed(self):
        run = MagicMock(return_value='[]')

        _execute_step(_expansion_job(count=30), self._event(), run_web_search=run)

        prompt = run.call_args.args[2]
        assert 'Find 30 related keywords' in prompt
        assert '<seed_keyword>hotel malaga</seed_keyword>' in prompt

    def test_records_a_provider_error_on_the_step_instead_of_raising(self):
        run = MagicMock(side_effect=RuntimeError('401 Unauthorized | invalid_api_key'))

        result, table = _execute_step(_expansion_job(), self._event('perplexity'), run_web_search=run)

        final = _step_writes(table)[-1]
        assert result['status'] == 'failed'
        assert final['status'] == 'failed'
        assert final['error_message'] == '401 Unauthorized | invalid_api_key'

    def test_treats_unparseable_output_as_a_failed_step_not_an_empty_success(self):
        run = MagicMock(return_value='Sorry, I cannot help with that.')

        _result, table = _execute_step(_expansion_job(), self._event(), run_web_search=run)

        final = _step_writes(table)[-1]
        assert final['status'] == 'failed'
        assert 'no parseable' in final['error_message']

    def test_fails_the_step_when_the_provider_key_is_missing(self):
        run = MagicMock()

        _result, table = _execute_step(_expansion_job(), self._event('perplexity'), api_key=None, run_web_search=run)

        run.assert_not_called()
        assert _step_writes(table)[-1]['error_message'] == 'perplexity is not configured'

    def test_keeps_only_entries_that_carry_a_keyword(self):
        response_text = '[{"keyword": "ok"}, {"intent": "none"}, "junk", {"keyword": 7}]'

        _result, table = _execute_step(_expansion_job(), self._event(), run_web_search=MagicMock(return_value=response_text))

        assert _step_writes(table)[-1]['keywords'] == [{'keyword': 'ok'}]

    def test_truncates_the_raw_response_kept_on_the_step(self):
        response_text = '[]' + ' ' * 10_000

        _result, table = _execute_step(_expansion_job(), self._event(), run_web_search=MagicMock(return_value=response_text))

        assert len(_step_writes(table)[-1]['raw_response']) == 5000

    def test_competitor_step_merges_defaults_and_attaches_the_scraped_elements(self):
        page = {'success': True, 'title': 'Rooms', 'meta_description': 'Sea view', 'h1_tags': ['Stay'], 'h2_tags': []}
        response_text = '{"industry": "hospitality", "primary_keywords": [{"keyword": "sea view hotel", "relevance": 8}]}'
        run = MagicMock(return_value=response_text)

        _result, table = _execute_step(_competitor_job(page_data=page), self._event(job_id='job-2'), run_web_search=run)

        analysis = _step_writes(table)[-1]['analysis']
        assert analysis['industry'] == 'hospitality'
        assert analysis['content_gaps'] == []
        assert analysis['seo_elements']['title'] == 'Rooms'
        assert '<page_title>Rooms</page_title>' in run.call_args.args[2]

    def test_competitor_step_counts_keywords_across_categories(self):
        response_text = '{"primary_keywords": [{"keyword": "a"}], "longtail_keywords": [{"keyword": "b"}, {"keyword": "c"}]}'
        run = MagicMock(return_value=response_text)

        _result, table = _execute_step(_competitor_job(page_data={'success': False}), self._event(job_id='job-2'), run_web_search=run)

        assert _step_writes(table)[-1]['keyword_count'] == 3


class TestFailStep:
    def _event(self) -> dict:
        return {
            'action': 'fail_step', 'job_id': 'job-1', 'step_id': 'r1-openai', 'provider': 'openai',
            'error': {'Error': 'States.Timeout', 'Cause': '{"errorMessage": "Task timed out after 300.00 seconds"}'},
        }

    def test_records_the_cause_as_the_step_error(self):
        table = MagicMock()

        with patch.object(_mod, 'research_table', table):
            result = _mod.handler(self._event(), None)

        step = _step_writes(table)[-1]
        assert result['status'] == 'failed'
        assert step['status'] == 'failed'
        assert step['error_message'] == 'Task timed out after 300.00 seconds'

    def test_never_overwrites_a_completed_step(self):
        table = MagicMock()
        table.update_item.side_effect = ClientError(
            {'Error': {'Code': 'ConditionalCheckFailedException', 'Message': 'no'}}, 'UpdateItem'
        )

        with patch.object(_mod, 'research_table', table):
            result = _mod.handler(self._event(), None)

        assert result['status'] == 'completed'
        assert 'ConditionExpression' in table.update_item.call_args.kwargs

    def test_falls_back_to_the_error_name_when_there_is_no_cause(self):
        table = MagicMock()
        event = {**self._event(), 'error': {'Error': 'Lambda.Unknown'}}

        with patch.object(_mod, 'research_table', table):
            _mod.handler(event, None)

        assert _step_writes(table)[-1]['error_message'] == 'Lambda.Unknown'


class TestFinalize:
    def _job(self, **steps) -> dict:
        return _expansion_job(status='running', steps=steps)

    def test_persists_the_merged_keywords_and_completed_status(self):
        table = _table_with(self._job(
            a={'provider': 'openai', 'status': 'completed', 'keywords': [{'keyword': 'x', 'relevance': 8.5}]},
            b={'provider': 'gemini', 'status': 'completed', 'keywords': [{'keyword': 'x', 'relevance': 9}, {'keyword': 'y', 'relevance': 3}]},
        ))

        with patch.object(_mod, 'research_table', table):
            result = _mod.handler({'action': 'finalize', 'job_id': 'job-1'}, None)

        call = table.update_item.call_args.kwargs
        values = call['ExpressionAttributeValues']
        assert result['status'] == 'completed'
        assert values[':s'] == 'completed'
        assert [entry['keyword'] for entry in values[':kw']] == ['x', 'y']
        assert 'REMOVE error_message' in call['UpdateExpression']

    def test_partial_when_a_provider_failed_and_names_it_in_the_error(self):
        table = _table_with(self._job(
            a={'provider': 'openai', 'status': 'completed', 'keywords': [{'keyword': 'x'}]},
            b={'provider': 'perplexity', 'status': 'failed', 'error_message': '401 invalid_api_key'},
        ))

        with patch.object(_mod, 'research_table', table):
            result = _mod.handler({'action': 'finalize', 'job_id': 'job-1'}, None)

        values = table.update_item.call_args.kwargs['ExpressionAttributeValues']
        assert result['status'] == 'partial'
        assert values[':e'] == 'perplexity: 401 invalid_api_key'
        assert (values[':sd'], values[':sf'], values[':kc']) == (2, 1, 1)

    def test_failed_when_no_provider_produced_a_result(self):
        table = _table_with(self._job(
            a={'provider': 'openai', 'status': 'failed', 'error_message': 'timeout'},
        ))

        with patch.object(_mod, 'research_table', table):
            result = _mod.handler({'action': 'finalize', 'job_id': 'job-1'}, None)

        assert result['status'] == 'failed'
        assert table.update_item.call_args.kwargs['ExpressionAttributeValues'][':e'] == 'openai: timeout'

    def test_competitor_finalize_persists_the_merged_analysis(self):
        table = _table_with(_competitor_job(status='running', steps={
            'a': {'provider': 'openai', 'status': 'completed', 'analysis': {'industry': 'hospitality', 'page_focus': 'rooms', 'primary_keywords': [{'keyword': 'sea view'}]}},
        }))

        with patch.object(_mod, 'research_table', table):
            result = _mod.handler({'action': 'finalize', 'job_id': 'job-2'}, None)

        values = table.update_item.call_args.kwargs['ExpressionAttributeValues']
        assert result == {'job_id': 'job-2', 'status': 'completed', 'keyword_count': 1}
        assert (values[':ind'], values[':pf']) == ('hospitality', 'rooms')
        assert values[':a']['primary_keywords'][0]['keyword'] == 'sea view'


class TestFail:
    def _event(self) -> dict:
        return {'action': 'fail', 'job_id': 'job-1', 'error': {'Error': 'NoProviderConfiguredError', 'Cause': '{"errorMessage": "No API keys configured"}'}}

    def test_marks_the_job_failed_with_the_cause(self):
        table = _table_with(_expansion_job(status='pending'))

        with patch.object(_mod, 'research_table', table):
            result = _mod.handler(self._event(), None)

        values = table.update_item.call_args.kwargs['ExpressionAttributeValues']
        assert result['status'] == 'failed'
        assert (values[':s'], values[':e']) == ('failed', 'No API keys configured')

    def test_fails_the_unfinished_steps_but_keeps_completed_ones(self):
        table = _table_with(_expansion_job(status='running', steps={
            'r1-openai': {'provider': 'openai', 'status': 'completed', 'keywords': []},
            'r1-gemini': {'provider': 'gemini', 'status': 'running'},
        }))

        with patch.object(_mod, 'research_table', table):
            _mod.handler(self._event(), None)

        call = table.update_item.call_args.kwargs
        assert list(call['ExpressionAttributeNames'].values()) == ['status', 'r1-gemini']
        assert call['ExpressionAttributeValues'][':st1']['status'] == 'failed'

    def test_leaves_a_job_that_already_finished_alone(self):
        table = _table_with(_expansion_job(status='partial'))

        with patch.object(_mod, 'research_table', table):
            result = _mod.handler(self._event(), None)

        assert result['status'] == 'partial'
        table.update_item.assert_not_called()

    def test_tolerates_a_job_that_no_longer_exists(self):
        with patch.object(_mod, 'research_table', _table_with(None)):
            result = _mod.handler(self._event(), None)

        assert result['status'] == 'failed'


class TestHandler:
    def test_rejects_an_unknown_action(self):
        with pytest.raises(ValueError):
            _mod.handler({'action': 'dance', 'job_id': 'job-1'}, None)



# =============================================================================
# Research agent
# =============================================================================

def _agent_job(**overrides) -> dict:
    return {
        'id': 'job-a', 'type': 'agent', 'status': 'pending', 'round': 0, 'rounds': [], 'steps': {},
        'system_prompt': 'You are a hotel SEO researcher.',
        'config': {
            'seed': 'Hotel Gran Marino', 'country': 'es', 'language': 'es',
            'dimensions': ['destination', 'audience'], 'instruction': '', 'target_count': 60, 'max_rounds': 2, 'group_id': None,
        },
        'created_at': '2026-09-18T10:00:00Z',
        **overrides,
    }


_PLAN_TEXT = '{"strategy": "Destination first", "queries": [{"query": "hoteles coruña centro", "dimension": "destination", "rationale": "core"}, {"query": "hotel familiar coruña", "dimension": "audience", "rationale": "families"}]}'


def _round_one(**evaluation) -> dict:
    """A job that finished round 1 with two completed steps."""
    return _agent_job(status='running', round=1, rounds=[{
        'round': 1, 'planned_at': 't', 'strategy': 'Destination first',
        'queries': [{'query': 'hoteles coruña centro', 'dimension': 'destination', 'rationale': ''}],
        'step_ids': ['r1-q1-perplexity'],
        **({'evaluation': evaluation} if evaluation else {}),
    }], steps={
        'r1-q1-perplexity': {'provider': 'perplexity', 'status': 'completed', 'round': 1, 'query': 'hoteles coruña centro', 'dimension': 'destination',
                             'keywords': [{'keyword': 'hotel coruña centro', 'relevance': 9, 'intent': 'commercial', 'competition': 'high', 'dimension': 'destination'}]},
        'r1-signals-serpapi': {'provider': 'serpapi', 'status': 'completed', 'round': 1, 'queries': [{'query': 'hoteles coruña centro', 'dimension': 'destination'}],
                               'keywords': [{'keyword': 'hoteles baratos coruña', 'relevance': 5, 'intent': '', 'competition': '', 'dimension': 'destination'}]},
    })


class TestAgentPlan:
    def _plan(self, job: dict, *, retry: bool = False, bedrock=None, serpapi_key=None) -> tuple[dict, MagicMock]:
        table = _table_with(job)
        with (
            patch.object(_mod, 'research_table', table),
            patch.object(_mod, 'get_web_search_clients', _configured(_PERPLEXITY, _OPENAI)),
            patch.object(_mod, 'get_api_key', MagicMock(return_value=serpapi_key)),
            patch.object(_mod, 'invoke_bedrock', bedrock or MagicMock(return_value=_PLAN_TEXT)),
        ):
            result = _mod.handler({'action': 'plan', 'job_id': job['id'], 'retry': retry, 'execution_arn': 'arn:exec'}, None)
        return result, table

    def test_first_round_asks_the_planning_model_with_the_job_system_prompt(self):
        bedrock = MagicMock(return_value=_PLAN_TEXT)

        self._plan(_agent_job(), bedrock=bedrock)

        assert bedrock.call_args.args[1] == _mod.ModelRole.RESEARCH_PLANNING
        assert bedrock.call_args.kwargs['system'] == 'You are a hotel SEO researcher.'
        assert 'Hotel / seed: <subject>Hotel Gran Marino</subject>' in bedrock.call_args.args[0]

    def test_first_round_becomes_one_step_per_query_rotating_providers(self):
        result, _table = self._plan(_agent_job())

        assert result == {'job_id': 'job-a', 'retry': False, 'steps': [
            {'step_id': 'r1-q1-perplexity', 'provider': 'perplexity'},
            {'step_id': 'r1-q2-openai', 'provider': 'openai'},
        ]}

    def test_adds_the_signals_step_when_serpapi_is_configured(self):
        result, _table = self._plan(_agent_job(), serpapi_key='serp-key')

        assert result['steps'][-1] == {'step_id': 'r1-signals-serpapi', 'provider': 'serpapi'}

    def test_persists_round_one_with_its_plan_and_pending_steps(self):
        _result, table = self._plan(_agent_job())

        call = table.update_item.call_args.kwargs
        values = call['ExpressionAttributeValues']
        assert values[':rnd'] == 1
        assert values[':round_info'][0]['strategy'] == 'Destination first'
        assert [query['query'] for query in values[':round_info'][0]['queries']] == ['hoteles coruña centro', 'hotel familiar coruña']
        assert values[':steps']['r1-q2-openai'] == {'provider': 'openai', 'status': 'pending', 'round': 1, 'query': 'hotel familiar coruña', 'dimension': 'audience', 'rationale': 'families'}

    def test_appends_the_round_to_the_trace_and_marks_the_job_running(self):
        _result, table = self._plan(_agent_job())

        call = table.update_item.call_args.kwargs
        assert 'rounds = list_append(if_not_exists(rounds, :empty), :round_info)' in call['UpdateExpression']
        assert call['ExpressionAttributeValues'][':running'] == 'running'
        assert call['ExpressionAttributeValues'][':total'] == 2

    def test_fails_the_job_when_the_planner_returns_no_queries(self):
        with pytest.raises(_mod.AgentPlanningError):
            self._plan(_agent_job(), bedrock=MagicMock(return_value='{"queries": []}'))

    def test_second_round_runs_the_queries_the_evaluator_asked_for_without_calling_the_model(self):
        bedrock = MagicMock()
        job = _round_one(decision='continue', next_queries=[{'query': 'hotel coruña con niños', 'dimension': 'audience', 'rationale': 'families'}])

        result, table = self._plan(job, bedrock=bedrock)

        bedrock.assert_not_called()
        assert result['steps'] == [{'step_id': 'r2-q1-perplexity', 'provider': 'perplexity'}]
        call = table.update_item.call_args.kwargs
        assert call['ExpressionAttributeValues'][':rnd'] == 2
        assert call['ExpressionAttributeValues'][':st0']['query'] == 'hotel coruña con niños'
        assert call['ExpressionAttributeValues'][':total'] == 3

    def test_plans_nothing_once_the_round_cap_is_reached(self):
        job = _round_one(decision='continue', next_queries=[{'query': 'x', 'dimension': 'other', 'rationale': ''}])
        job['config']['max_rounds'] = 1

        result, table = self._plan(job)

        assert result == {'job_id': 'job-a', 'steps': [], 'retry': False}
        table.update_item.assert_not_called()

    def test_retry_reruns_only_the_unfinished_steps_and_keeps_their_queries(self):
        job = _round_one()
        job['steps']['r1-signals-serpapi']['status'] = 'failed'
        job['status'] = 'pending'

        result, table = self._plan(job, retry=True)

        assert result['steps'] == [{'step_id': 'r1-signals-serpapi', 'provider': 'serpapi'}]
        values = table.update_item.call_args.kwargs['ExpressionAttributeValues']
        assert values[':st1'] == {'round': 1, 'queries': [{'query': 'hoteles coruña centro', 'dimension': 'destination'}], 'provider': 'serpapi', 'status': 'pending'}

    def test_retry_with_every_step_completed_runs_nothing_so_evaluate_runs_again(self):
        result, _table = self._plan(_round_one(), retry=True)

        assert result['steps'] == []


class TestAgentExecuteStep:
    def _job_with_step(self) -> dict:
        return _agent_job(status='running', round=1, steps={
            'r1-q2-openai': {'provider': 'openai', 'status': 'pending', 'round': 1, 'query': 'hotel familiar coruña', 'dimension': 'audience', 'rationale': 'families'},
            'r1-signals-serpapi': {'provider': 'serpapi', 'status': 'pending', 'round': 1, 'queries': [
                {'query': 'hotel familiar coruña', 'dimension': 'audience'}, {'query': 'hoteles coruña', 'dimension': 'destination'},
            ]},
        })

    def _query_step(self, run: MagicMock) -> tuple[dict, MagicMock]:
        """Execute the planned ``r1-q2-openai`` query step with ``run`` as the provider call."""
        event = {'action': 'execute_step', 'job_id': 'job-a', 'step_id': 'r1-q2-openai', 'provider': 'openai'}
        return _execute_step(self._job_with_step(), event, run_web_search=run)

    def _signals_step(self, signals: MagicMock) -> tuple[dict, MagicMock]:
        """Execute the round's ``r1-signals-serpapi`` step with ``signals`` as ``fetch_google_signals``."""
        event = {'action': 'execute_step', 'job_id': 'job-a', 'step_id': 'r1-signals-serpapi', 'provider': 'serpapi'}
        return _execute_step(self._job_with_step(), event, api_key='serp-key', fetch_google_signals=signals)

    def test_searches_the_planned_query_and_tags_keywords_with_its_dimension(self):
        run = MagicMock(return_value='[{"keyword": "hotel coruña con niños", "intent": "commercial", "competition": "low", "relevance": 8}]')

        result, table = self._query_step(run)

        assert result['status'] == 'completed'
        assert '<query>hotel familiar coruña</query>' in run.call_args.args[2]
        final = _step_writes(table)[-1]
        assert final['keywords'][0]['dimension'] == 'audience'

    def test_every_status_write_keeps_the_planned_query(self):
        _result, table = self._query_step(MagicMock(return_value='[]'))

        running, completed = _step_writes(table)
        assert (running['query'], running['dimension'], running['round'], running['status']) == ('hotel familiar coruña', 'audience', 1, 'running')
        assert (completed['query'], completed['rationale'], completed['status']) == ('hotel familiar coruña', 'families', 'completed')

    def test_signals_step_collects_google_signals_for_every_query_of_the_round(self):
        signals = MagicMock(side_effect=lambda _key, query, **_kw: [{'keyword': f'{query} barato', 'source': 'google autocomplete', 'relevance': 5, 'intent': '', 'competition': ''}])

        result, table = self._signals_step(signals)

        final = _step_writes(table)[-1]
        assert result['status'] == 'completed'
        assert [(entry['keyword'], entry['dimension']) for entry in final['keywords']] == [
            ('hotel familiar coruña barato', 'audience'), ('hoteles coruña barato', 'destination'),
        ]
        assert signals.call_args.kwargs == {'country': 'es', 'language': 'es'}

    def test_signals_step_keeps_the_queries_that_worked_and_records_the_rest_as_warnings(self):
        signals = MagicMock(side_effect=[ValueError('429 rate limited'), [{'keyword': 'hoteles coruña baratos', 'source': 'google autocomplete', 'relevance': 5, 'intent': '', 'competition': ''}]])

        result, table = self._signals_step(signals)

        final = _step_writes(table)[-1]
        assert (result['status'], final['keyword_count']) == ('completed', 1)
        assert final['warnings'] == ['hotel familiar coruña: 429 rate limited']

    def test_signals_step_fails_when_no_query_produced_anything(self):
        result, table = self._signals_step(MagicMock(side_effect=ValueError('401 invalid key')))

        final = _step_writes(table)[-1]
        assert result['status'] == 'failed'
        assert final['error_message'] == 'hotel familiar coruña: 401 invalid key; hoteles coruña: 401 invalid key'


class TestEvaluate:
    def _evaluate(self, job: dict, bedrock=None) -> tuple[dict, MagicMock, MagicMock]:
        table = _table_with(job)
        bedrock = bedrock or MagicMock(return_value='{"decision": "stop", "reason": "saturated", "assessment": "fine", "next_queries": []}')
        with patch.object(_mod, 'research_table', table), patch.object(_mod, 'invoke_bedrock', bedrock):
            result = _mod.handler({'action': 'evaluate', 'job_id': job['id']}, None)
        return result, table, bedrock

    def test_non_agent_jobs_stop_without_touching_the_row_or_the_model(self):
        result, table, bedrock = self._evaluate(_expansion_job(id='job-1', status='running'))

        assert result == {'job_id': 'job-1', 'decision': 'stop', 'retry': False}
        table.update_item.assert_not_called()
        bedrock.assert_not_called()

    def test_asks_the_evaluation_model_with_the_merged_candidates(self):
        result, _table, bedrock = self._evaluate(_round_one())

        assert bedrock.call_args.args[1] == _mod.ModelRole.RESEARCH_EVALUATION
        prompt = bedrock.call_args.args[0]
        assert '<kw>hotel coruña centro</kw>' in prompt
        assert '<kw>hoteles baratos coruña</kw>' in prompt
        assert result == {'job_id': 'job-a', 'decision': 'stop', 'round': 1, 'retry': False}

    def test_continue_persists_the_evaluation_on_the_round(self):
        text = '{"decision": "continue", "reason": "audience is thin", "assessment": "ok", "next_queries": [{"query": "hotel coruña con niños", "dimension": "audience"}]}'

        result, table, _bedrock = self._evaluate(_round_one(), bedrock=MagicMock(return_value=text))

        call = table.update_item.call_args.kwargs
        assert result['decision'] == 'continue'
        assert call['UpdateExpression'] == 'SET rounds[0].evaluation = :ev, updated_at = :ts'
        evaluation = call['ExpressionAttributeValues'][':ev']
        assert (evaluation['decision'], evaluation['reason'], evaluation['candidate_count']) == ('continue', 'audience is thin', 2)
        assert evaluation['next_queries'] == [{'query': 'hotel coruña con niños', 'dimension': 'audience', 'rationale': ''}]

    def test_stops_at_the_round_cap_without_calling_the_model(self):
        job = _round_one()
        job['config']['max_rounds'] = 1

        result, table, bedrock = self._evaluate(job)

        bedrock.assert_not_called()
        assert result['decision'] == 'stop'
        assert table.update_item.call_args.kwargs['ExpressionAttributeValues'][':ev']['reason'] == 'Reached the maximum of 1 round.'

    def test_stops_when_no_candidate_was_found(self):
        job = _round_one()
        for step in job['steps'].values():
            step['status'] = 'failed'

        result, _table, bedrock = self._evaluate(job)

        bedrock.assert_not_called()
        assert result['decision'] == 'stop'

    def test_a_model_failure_degrades_to_stop_with_the_reason_recorded(self):
        class BedrockDown(Exception):
            pass

        result, table, _bedrock = self._evaluate(_round_one(), bedrock=MagicMock(side_effect=BedrockDown('AccessDeniedException')))

        assert result['decision'] == 'stop'
        assert table.update_item.call_args.kwargs['ExpressionAttributeValues'][':ev']['reason'].startswith('The evaluation model failed (AccessDeniedException)')

    def test_an_unparseable_answer_degrades_to_stop(self):
        result, _table, _bedrock = self._evaluate(_round_one(), bedrock=MagicMock(return_value='no json here'))

        assert result['decision'] == 'stop'


class TestAgentFinalize:
    _SELECTION = '[{"keyword": "hotel coruña centro", "dimension": "destination", "intent": "transactional", "competition": "high", "relevance": 9, "rationale": "core demand"}]'

    def _finalize(self, job: dict, bedrock=None) -> tuple[dict, MagicMock, MagicMock]:
        table = _table_with(job)
        bedrock = bedrock or MagicMock(return_value=self._SELECTION)
        with patch.object(_mod, 'research_table', table), patch.object(_mod, 'invoke_bedrock', bedrock):
            result = _mod.handler({'action': 'finalize', 'job_id': job['id']}, None)
        return result, table, bedrock

    def test_persists_the_model_selected_proposal_as_the_job_keywords(self):
        result, table, bedrock = self._finalize(_round_one())

        values = table.update_item.call_args.kwargs['ExpressionAttributeValues']
        assert bedrock.call_args.args[1] == _mod.ModelRole.RESEARCH_PLANNING
        assert result == {'job_id': 'job-a', 'status': 'completed', 'keyword_count': 1}
        assert [entry['keyword'] for entry in values[':kw']] == ['hotel coruña centro']
        assert (values[':kc'], values[':cc'], values[':src']) == (1, 2, 'model')

    def test_selected_keywords_keep_the_providers_that_proposed_them(self):
        _result, table, _bedrock = self._finalize(_round_one())

        proposal = table.update_item.call_args.kwargs['ExpressionAttributeValues'][':kw']
        assert proposal[0]['providers'] == ['perplexity']

    def test_falls_back_to_the_top_candidates_when_the_selection_model_fails(self):
        class BedrockDown(Exception):
            pass

        result, table, _bedrock = self._finalize(_round_one(), bedrock=MagicMock(side_effect=BedrockDown('throttled')))

        values = table.update_item.call_args.kwargs['ExpressionAttributeValues']
        assert result['status'] == 'completed'
        assert [entry['keyword'] for entry in values[':kw']] == ['hotel coruña centro', 'hoteles baratos coruña']
        assert values[':src'] == 'fallback'

    def test_failed_job_without_candidates_skips_the_model(self):
        job = _round_one()
        for step in job['steps'].values():
            step.update({'status': 'failed', 'error_message': 'boom'})

        result, table, bedrock = self._finalize(job)

        bedrock.assert_not_called()
        assert result == {'job_id': 'job-a', 'status': 'failed', 'keyword_count': 0}
        assert table.update_item.call_args.kwargs['ExpressionAttributeValues'][':src'] == 'none'
