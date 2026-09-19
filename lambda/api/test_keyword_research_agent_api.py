"""
Tests for the research-agent routes of `keyword-research.py`:

- POST /keyword-research/agent validates the brief, snapshots the system
  prompt (inline > template > built-in), records the destination group and
  starts one execution
- GET/POST/PUT/DELETE /keyword-research/templates manage saved system
  prompts; the built-in template is always listed first and is read-only
- history lists agent jobs without their prompt snapshot
"""

from __future__ import annotations

import json
import os
from unittest.mock import MagicMock, patch

import pytest

from shared.research_agent import BUILTIN_TEMPLATE_ID, DEFAULT_SYSTEM_PROMPT
from testing.env import KEYWORD_RESEARCH_ENV, setdefault_env
from testing.module_loader import load_handler_module_offline

setdefault_env(KEYWORD_RESEARCH_ENV)
_mod = load_handler_module_offline(os.path.dirname(__file__), 'keyword-research.py', 'keyword_research_agent_api_under_test')

_CLAIMS = {'requestContext': {'authorizer': {'claims': {'cognito:username': 'bastian', 'email': 'bastian@example.com'}}}}


def _agent_event(**overrides) -> dict:
    body = {
        'seed': 'Hotel Gran Marino', 'country': 'es', 'language': 'es',
        'dimensions': ['destination', 'audience'], 'instruction': 'also events',
        'target_count': 50, 'max_rounds': 2,
        **overrides,
    }
    return {'httpMethod': 'POST', 'path': '/api/keyword-research/agent', 'body': json.dumps(body), **_CLAIMS}


def _templates_event(method: str, body: dict | None = None, template_id: str | None = None) -> dict:
    event: dict = {'httpMethod': method, 'path': '/api/keyword-research/templates' + (f'/{template_id}' if template_id else ''), **_CLAIMS}
    if body is not None:
        event['body'] = json.dumps(body)
    if template_id:
        event['pathParameters'] = {'id': template_id}
    return event


def _table(item: dict | None = None, items: list | None = None) -> MagicMock:
    table = MagicMock()
    table.get_item.return_value = {'Item': item} if item is not None else {}
    table.scan.return_value = {'Items': items or [], 'Count': len(items or [])}
    return table


def _stepfunctions() -> MagicMock:
    client = MagicMock()
    client.start_execution.return_value = {'executionArn': 'arn:exec'}
    return client


def _body(response: dict) -> dict:
    return json.loads(response['body'])


@pytest.fixture
def started():
    """Patch every collaborator for a successful agent start; yields the mocks."""
    mocks = {
        'research_table': MagicMock(),
        'templates_table': _table(),
        'groups_table': _table({'id': 'g1', 'name': 'Hotel Gran Marino'}),
        'stepfunctions': _stepfunctions(),
        'get_web_search_clients': MagicMock(return_value=[('perplexity', object())]),
    }
    with patch.multiple(_mod, **mocks):
        yield mocks


class TestStartAgent:
    def test_returns_202_with_a_pending_agent_job(self, started):
        response = _mod.handler(_agent_event(), None)

        body = _body(response)
        assert response['statusCode'] == 202
        assert (body['type'], body['status'], body['round']) == ('agent', 'pending', 0)

    def test_persists_the_validated_config_and_the_seed_for_history(self, started):
        _mod.handler(_agent_event(), None)

        item = started['research_table'].put_item.call_args.kwargs['Item']
        assert item['config'] == {
            'seed': 'Hotel Gran Marino', 'country': 'es', 'language': 'es', 'dimensions': ['destination', 'audience'],
            'instruction': 'also events', 'target_count': 50, 'max_rounds': 2, 'group_id': None,
        }
        assert (item['seed_keyword'], item['rounds'], item['created_by']) == ('Hotel Gran Marino', [], 'bastian')

    def test_snapshots_the_builtin_prompt_when_no_template_is_chosen(self, started):
        _mod.handler(_agent_event(), None)

        item = started['research_table'].put_item.call_args.kwargs['Item']
        assert (item['system_prompt'], item['template_id']) == (DEFAULT_SYSTEM_PROMPT, BUILTIN_TEMPLATE_ID)
        assert item['template_name'] == 'Hotel keyword research (default)'

    def test_snapshots_the_saved_template_prompt_and_name(self, started):
        started['templates_table'].get_item.return_value = {'Item': {'id': 't1', 'name': 'Resort prompt', 'system_prompt': 'You research resorts. ' * 3}}

        _mod.handler(_agent_event(template_id='t1'), None)

        item = started['research_table'].put_item.call_args.kwargs['Item']
        assert (item['system_prompt'], item['template_id'], item['template_name']) == ('You research resorts. ' * 3, 't1', 'Resort prompt')

    def test_an_inline_prompt_edit_wins_over_the_template(self, started):
        started['templates_table'].get_item.return_value = {'Item': {'id': 't1', 'name': 'Resort prompt', 'system_prompt': 'template text'}}

        _mod.handler(_agent_event(template_id='t1', system_prompt='edited inline prompt'), None)

        item = started['research_table'].put_item.call_args.kwargs['Item']
        assert (item['system_prompt'], item['template_name']) == ('edited inline prompt', 'Resort prompt')

    def test_falls_back_to_the_default_prompt_when_the_template_vanished(self, started):
        started['templates_table'].get_item.return_value = {}

        _mod.handler(_agent_event(template_id='gone'), None)

        item = started['research_table'].put_item.call_args.kwargs['Item']
        assert item['system_prompt'] == DEFAULT_SYSTEM_PROMPT
        assert 'template_name' not in item

    def test_records_the_destination_group_when_it_exists(self, started):
        _mod.handler(_agent_event(group_id='g1'), None)

        item = started['research_table'].put_item.call_args.kwargs['Item']
        assert item['config']['group_id'] == 'g1'

    def test_rejects_an_unknown_destination_group(self, started):
        started['groups_table'].get_item.return_value = {}

        response = _mod.handler(_agent_event(group_id='nope'), None)

        assert response['statusCode'] == 400
        assert 'Keyword group not found' in response['body']
        started['research_table'].put_item.assert_not_called()

    def test_starts_the_execution_with_retry_false(self, started):
        _mod.handler(_agent_event(), None)

        kwargs = started['stepfunctions'].start_execution.call_args.kwargs
        assert json.loads(kwargs['input'])['retry'] is False

    @pytest.mark.parametrize(('override', 'field'), [
        ({'dimensions': []}, 'dimensions'),
        ({'dimensions': ['weather']}, 'dimensions'),
        ({'country': 'spain'}, 'country'),
        ({'language': '1'}, 'language'),
        ({'target_count': 5}, 'target_count'),
        ({'max_rounds': 4}, 'max_rounds'),
        ({'seed': 'x'}, 'seed'),
        ({'system_prompt': '   '}, 'system_prompt'),
    ])
    def test_rejects_an_invalid_brief(self, started, override, field):
        response = _mod.handler(_agent_event(**override), None)

        assert response['statusCode'] == 400
        assert field in response['body']
        started['research_table'].put_item.assert_not_called()

    def test_returns_400_when_no_web_search_provider_is_configured(self, started):
        started['get_web_search_clients'].return_value = []

        response = _mod.handler(_agent_event(), None)

        assert response['statusCode'] == 400
        assert 'No API keys configured' in response['body']


class TestListTemplates:
    def test_lists_the_builtin_template_first_then_saved_ones_by_name(self):
        saved = [
            {'id': 't2', 'name': 'Urban hotels', 'system_prompt': 'p2', 'created_at': 'b'},
            {'id': 't1', 'name': 'Beach resorts', 'system_prompt': 'p1', 'created_at': 'a', 'created_by': 'ana'},
        ]

        with patch.object(_mod, 'templates_table', _table(items=saved)):
            body = _body(_mod.handler(_templates_event('GET'), None))

        assert [(item['id'], item['name'], item['builtin']) for item in body['items']] == [
            (BUILTIN_TEMPLATE_ID, 'Hotel keyword research (default)', True), ('t1', 'Beach resorts', False), ('t2', 'Urban hotels', False),
        ]
        assert body['items'][1]['created_by'] == 'ana'
        assert body['count'] == 3


class TestCreateTemplate:
    def test_saves_the_prompt_with_the_author_and_answers_201(self):
        table = _table()

        with patch.object(_mod, 'templates_table', table):
            response = _mod.handler(_templates_event('POST', {'name': 'Beach resorts', 'system_prompt': 'You research beach resorts for families.', 'description': 'd'}), None)

        item = table.put_item.call_args.kwargs['Item']
        assert response['statusCode'] == 201
        assert (item['name'], item['system_prompt'], item['description'], item['created_by']) == ('Beach resorts', 'You research beach resorts for families.', 'd', 'bastian')
        assert _body(response)['builtin'] is False

    def test_rejects_a_prompt_that_is_too_short_to_mean_anything(self):
        with patch.object(_mod, 'templates_table', _table()):
            response = _mod.handler(_templates_event('POST', {'name': 'x', 'system_prompt': 'short'}), None)

        assert response['statusCode'] == 400
        assert 'system_prompt' in response['body']

    def test_enforces_the_template_cap(self):
        table = _table()
        table.scan.return_value = {'Count': _mod.MAX_TEMPLATES}

        with patch.object(_mod, 'templates_table', table):
            response = _mod.handler(_templates_event('POST', {'name': 'x', 'system_prompt': 'You research beach resorts for families.'}), None)

        assert response['statusCode'] == 400
        table.put_item.assert_not_called()


class TestUpdateTemplate:
    def test_updates_only_the_fields_sent(self):
        table = _table({'id': 't1', 'name': 'Old', 'system_prompt': 'old prompt text for research'})
        table.update_item.return_value = {'Attributes': {'id': 't1', 'name': 'New', 'system_prompt': 'old prompt text for research'}}

        with patch.object(_mod, 'templates_table', table):
            response = _mod.handler(_templates_event('PUT', {'name': 'New'}, template_id='t1'), None)

        call = table.update_item.call_args.kwargs
        assert response['statusCode'] == 200
        assert call['UpdateExpression'] == 'SET updated_at = :ts, #n = :v0'
        assert call['ExpressionAttributeValues'][':v0'] == 'New'
        assert _body(response)['name'] == 'New'

    def test_refuses_to_edit_the_builtin_template(self):
        table = _table()

        with patch.object(_mod, 'templates_table', table):
            response = _mod.handler(_templates_event('PUT', {'name': 'New'}, template_id=BUILTIN_TEMPLATE_ID), None)

        assert response['statusCode'] == 400
        assert 'built-in template cannot be edited' in response['body']
        table.update_item.assert_not_called()

    def test_returns_404_for_an_unknown_template(self):
        with patch.object(_mod, 'templates_table', _table()):
            response = _mod.handler(_templates_event('PUT', {'name': 'New'}, template_id='missing'), None)

        assert response['statusCode'] == 404

    def test_rejects_an_empty_update(self):
        with patch.object(_mod, 'templates_table', _table({'id': 't1'})):
            response = _mod.handler(_templates_event('PUT', {}, template_id='t1'), None)

        assert response['statusCode'] == 400
        assert 'Nothing to update' in response['body']


class TestDeleteTemplate:
    def test_deletes_a_saved_template(self):
        table = _table()

        with patch.object(_mod, 'templates_table', table):
            response = _mod.handler(_templates_event('DELETE', template_id='t1'), None)

        assert response['statusCode'] == 200
        table.delete_item.assert_called_once_with(Key={'id': 't1'})

    def test_refuses_to_delete_the_builtin_template(self):
        table = _table()

        with patch.object(_mod, 'templates_table', table):
            response = _mod.handler(_templates_event('DELETE', template_id=BUILTIN_TEMPLATE_ID), None)

        assert response['statusCode'] == 400
        table.delete_item.assert_not_called()

    def test_deleting_a_job_still_reaches_the_job_route(self):
        table = MagicMock()

        with patch.object(_mod, 'research_table', table):
            response = _mod.handler({'httpMethod': 'DELETE', 'path': '/api/keyword-research/job-9', 'pathParameters': {'id': 'job-9'}}, None)

        assert response['statusCode'] == 200
        table.delete_item.assert_called_once_with(Key={'id': 'job-9'})


class TestAgentHistory:
    def _agent_row(self) -> dict:
        return {
            'id': 'job-a', 'type': 'agent', 'status': 'completed', 'created_at': '2026-09-18T10:00:00Z', 'seed_keyword': 'Hotel Gran Marino',
            'system_prompt': 'secret sauce', 'config': {'seed': 'Hotel Gran Marino'}, 'keywords': [], 'keyword_count': 0, 'steps': {},
        }

    def test_history_includes_agent_jobs_when_unfiltered(self):
        table = MagicMock()
        table.query.side_effect = lambda **kwargs: {'Items': [self._agent_row()]} if kwargs['KeyConditionExpression']._values[1] == 'agent' else {'Items': []}

        with patch.object(_mod, 'research_table', table):
            body = _body(_mod.handler({'httpMethod': 'GET', 'path': '/api/keyword-research/history'}, None))

        assert [item['type'] for item in body['items']] == ['agent']
        assert table.query.call_count == 3

    def test_history_strips_the_prompt_snapshot_but_the_detail_keeps_it(self):
        table = MagicMock()
        table.query.return_value = {'Items': [self._agent_row()]}
        table.get_item.return_value = {'Item': self._agent_row()}

        with patch.object(_mod, 'research_table', table):
            listed = _body(_mod.handler({'httpMethod': 'GET', 'path': '/api/keyword-research/history', 'queryStringParameters': {'type': 'agent'}}, None))
            detail = _body(_mod.handler({'httpMethod': 'GET', 'path': '/api/keyword-research/job-a', 'pathParameters': {'id': 'job-a'}}, None))

        assert 'system_prompt' not in listed['items'][0]
        assert detail['system_prompt'] == 'secret sauce'

    def test_history_accepts_the_agent_type_filter(self):
        table = MagicMock()
        table.query.return_value = {'Items': []}

        with patch.object(_mod, 'research_table', table):
            response = _mod.handler({'httpMethod': 'GET', 'path': '/api/keyword-research/history', 'queryStringParameters': {'type': 'agent'}}, None)

        assert response['statusCode'] == 200
        assert table.query.call_args.kwargs['KeyConditionExpression']._values[1] == 'agent'
