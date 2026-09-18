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

import importlib.util
import os
import sys
from decimal import Decimal
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError

_HERE = os.path.dirname(os.path.abspath(__file__))
_LAMBDA_DIR = os.path.dirname(_HERE)
if _LAMBDA_DIR not in sys.path:
    sys.path.insert(0, _LAMBDA_DIR)
# Third-party runtime deps (requests, bs4) live in the built layer, not the
# dev venv. Appended, so `shared` still resolves from source first.
_LAYER_PY = os.path.join(_LAMBDA_DIR, 'layer', 'python')
if os.path.isdir(_LAYER_PY) and _LAYER_PY not in sys.path:
    sys.path.append(_LAYER_PY)

from shared.ai_clients import WEB_SEARCH_PROVIDERS

with patch('boto3.resource', MagicMock()):
    _spec = importlib.util.spec_from_file_location('research_worker_under_test', os.path.join(_HERE, 'handler.py'))
    _mod = importlib.util.module_from_spec(_spec)
    sys.modules['research_worker_under_test'] = _mod
    _spec.loader.exec_module(_mod)

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
    def _event(self, provider: str = 'openai') -> dict:
        return {'action': 'execute_step', 'job_id': 'job-1', 'step_id': f'r1-{provider}', 'provider': provider}

    def test_writes_the_parsed_keywords_to_the_step(self):
        table = _table_with(_expansion_job())
        response_text = '[{"keyword": "hotel malaga centro", "intent": "commercial", "relevance": 9.5}]'

        with (
            patch.object(_mod, 'research_table', table),
            patch.object(_mod, 'get_api_key', MagicMock(return_value='sk-test')),
            patch.object(_mod, 'run_web_search', MagicMock(return_value=response_text)),
        ):
            result = _mod.handler(self._event(), None)

        final = _step_writes(table)[-1]
        assert result['status'] == 'completed'
        assert final['status'] == 'completed'
        assert final['keywords'] == [{'keyword': 'hotel malaga centro', 'intent': 'commercial', 'relevance': Decimal('9.5')}]
        assert final['keyword_count'] == 1

    def test_marks_the_step_running_before_calling_the_provider(self):
        table = _table_with(_expansion_job())

        with (
            patch.object(_mod, 'research_table', table),
            patch.object(_mod, 'get_api_key', MagicMock(return_value='sk-test')),
            patch.object(_mod, 'run_web_search', MagicMock(return_value='[]')),
        ):
            _mod.handler(self._event(), None)

        first, last = _step_writes(table)
        assert first['status'] == 'running'
        assert last['status'] == 'completed'

    def test_writes_each_step_under_its_own_key(self):
        table = _table_with(_expansion_job())

        with (
            patch.object(_mod, 'research_table', table),
            patch.object(_mod, 'get_api_key', MagicMock(return_value='sk-test')),
            patch.object(_mod, 'run_web_search', MagicMock(return_value='[]')),
        ):
            _mod.handler(self._event('gemini'), None)

        call = table.update_item.call_args.kwargs
        assert call['UpdateExpression'] == 'SET steps.#sid = :step, updated_at = :ts'
        assert call['ExpressionAttributeNames'] == {'#sid': 'r1-gemini'}

    def test_bounds_in_process_retries_to_the_step_budget(self):
        run = MagicMock(return_value='[]')

        with (
            patch.object(_mod, 'research_table', _table_with(_expansion_job())),
            patch.object(_mod, 'get_api_key', MagicMock(return_value='sk-test')),
            patch.object(_mod, 'run_web_search', run),
        ):
            _mod.handler(self._event(), None)

        assert run.call_args.kwargs['max_retries'] == 2

    def test_asks_the_provider_for_the_requested_count_about_the_seed(self):
        run = MagicMock(return_value='[]')

        with (
            patch.object(_mod, 'research_table', _table_with(_expansion_job(count=30))),
            patch.object(_mod, 'get_api_key', MagicMock(return_value='sk-test')),
            patch.object(_mod, 'run_web_search', run),
        ):
            _mod.handler(self._event(), None)

        prompt = run.call_args.args[2]
        assert 'Find 30 related keywords' in prompt
        assert '<seed_keyword>hotel malaga</seed_keyword>' in prompt

    def test_records_a_provider_error_on_the_step_instead_of_raising(self):
        table = _table_with(_expansion_job())

        with (
            patch.object(_mod, 'research_table', table),
            patch.object(_mod, 'get_api_key', MagicMock(return_value='sk-test')),
            patch.object(_mod, 'run_web_search', MagicMock(side_effect=RuntimeError('401 Unauthorized | invalid_api_key'))),
        ):
            result = _mod.handler(self._event('perplexity'), None)

        final = _step_writes(table)[-1]
        assert result['status'] == 'failed'
        assert final['status'] == 'failed'
        assert final['error_message'] == '401 Unauthorized | invalid_api_key'

    def test_treats_unparseable_output_as_a_failed_step_not_an_empty_success(self):
        table = _table_with(_expansion_job())

        with (
            patch.object(_mod, 'research_table', table),
            patch.object(_mod, 'get_api_key', MagicMock(return_value='sk-test')),
            patch.object(_mod, 'run_web_search', MagicMock(return_value='Sorry, I cannot help with that.')),
        ):
            _mod.handler(self._event(), None)

        final = _step_writes(table)[-1]
        assert final['status'] == 'failed'
        assert 'no parseable' in final['error_message']

    def test_fails_the_step_when_the_provider_key_is_missing(self):
        table = _table_with(_expansion_job())

        with (
            patch.object(_mod, 'research_table', table),
            patch.object(_mod, 'get_api_key', MagicMock(return_value=None)),
            patch.object(_mod, 'run_web_search', MagicMock()) as run,
        ):
            _mod.handler(self._event('perplexity'), None)

        run.assert_not_called()
        assert _step_writes(table)[-1]['error_message'] == 'perplexity is not configured'

    def test_keeps_only_entries_that_carry_a_keyword(self):
        table = _table_with(_expansion_job())
        response_text = '[{"keyword": "ok"}, {"intent": "none"}, "junk", {"keyword": 7}]'

        with (
            patch.object(_mod, 'research_table', table),
            patch.object(_mod, 'get_api_key', MagicMock(return_value='sk-test')),
            patch.object(_mod, 'run_web_search', MagicMock(return_value=response_text)),
        ):
            _mod.handler(self._event(), None)

        assert _step_writes(table)[-1]['keywords'] == [{'keyword': 'ok'}]

    def test_truncates_the_raw_response_kept_on_the_step(self):
        table = _table_with(_expansion_job())
        response_text = '[]' + ' ' * 10_000

        with (
            patch.object(_mod, 'research_table', table),
            patch.object(_mod, 'get_api_key', MagicMock(return_value='sk-test')),
            patch.object(_mod, 'run_web_search', MagicMock(return_value=response_text)),
        ):
            _mod.handler(self._event(), None)

        assert len(_step_writes(table)[-1]['raw_response']) == 5000

    def test_competitor_step_merges_defaults_and_attaches_the_scraped_elements(self):
        page = {'success': True, 'title': 'Rooms', 'meta_description': 'Sea view', 'h1_tags': ['Stay'], 'h2_tags': []}
        table = _table_with(_competitor_job(page_data=page))
        response_text = '{"industry": "hospitality", "primary_keywords": [{"keyword": "sea view hotel", "relevance": 8}]}'
        run = MagicMock(return_value=response_text)

        with (
            patch.object(_mod, 'research_table', table),
            patch.object(_mod, 'get_api_key', MagicMock(return_value='sk-test')),
            patch.object(_mod, 'run_web_search', run),
        ):
            _mod.handler({'action': 'execute_step', 'job_id': 'job-2', 'step_id': 'r1-openai', 'provider': 'openai'}, None)

        analysis = _step_writes(table)[-1]['analysis']
        assert analysis['industry'] == 'hospitality'
        assert analysis['content_gaps'] == []
        assert analysis['seo_elements']['title'] == 'Rooms'
        assert '<page_title>Rooms</page_title>' in run.call_args.args[2]

    def test_competitor_step_counts_keywords_across_categories(self):
        table = _table_with(_competitor_job(page_data={'success': False}))
        response_text = '{"primary_keywords": [{"keyword": "a"}], "longtail_keywords": [{"keyword": "b"}, {"keyword": "c"}]}'

        with (
            patch.object(_mod, 'research_table', table),
            patch.object(_mod, 'get_api_key', MagicMock(return_value='sk-test')),
            patch.object(_mod, 'run_web_search', MagicMock(return_value=response_text)),
        ):
            _mod.handler({'action': 'execute_step', 'job_id': 'job-2', 'step_id': 'r1-openai', 'provider': 'openai'}, None)

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
