"""
Tests for the research-agent routes of `keyword-research.py`:

- POST /keyword-research/agent validates the brief against the chosen
  industry template (its dimension catalogue), snapshots the system prompt
  (inline > template) plus the template's subject, audience and catalogue,
  records the destination group and starts one execution
- GET/POST/PUT/DELETE /keyword-research/templates manage saved industry
  templates; the five built-ins are always listed first and are read-only
- history lists agent jobs without their prompt snapshot
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from shared.research_agent import (
    BUILTIN_TEMPLATE_ID,
    CAFE_TEMPLATE,
    DEFAULT_SYSTEM_PROMPT,
    GENERIC_TEMPLATE,
    LEGACY_DIMENSION_CATALOG,
)
from testing.events import parse_response
from testing.keyword_research_fixtures import (
    history_event,
    job_event,
    load_keyword_research,
    research_table_stub,
    started_stepfunctions,
)

_mod = load_keyword_research('keyword_research_agent_api_under_test')

_CLAIMS = {'requestContext': {'authorizer': {'claims': {'cognito:username': 'bastian', 'email': 'bastian@example.com'}}}}
_GROUP_G1 = {'id': 'g1', 'name': 'Hotel Gran Marino'}
_GYMS_PROMPT = 'You research gyms for members.'
_GENERIC_PROFILE = ('generic', 'business', 'customers')
_RESORT_TEMPLATE = {'id': 't1', 'name': 'Resort prompt', 'system_prompt': 'You research resorts. ' * 3}

# The brief every start sends unless a test overrides a field.
_BRIEF = {
    'seed': 'Hotel Gran Marino', 'country': 'es', 'language': 'es',
    'dimensions': ['destination', 'audience'], 'instruction': 'also events',
    'target_count': 50, 'max_rounds': 2,
}


def _agent_event(**overrides) -> dict:
    body = {**_BRIEF, **overrides}
    return {'httpMethod': 'POST', 'path': '/api/keyword-research/agent', 'body': json.dumps(body), **_CLAIMS}


def _templates_event(method: str, body: dict | None = None, template_id: str | None = None) -> dict:
    event: dict = {'httpMethod': method, 'path': '/api/keyword-research/templates' + (f'/{template_id}' if template_id else ''), **_CLAIMS}
    if body is not None:
        event['body'] = json.dumps(body)
    if template_id:
        event['pathParameters'] = {'id': template_id}
    return event


def _call_templates(table: MagicMock, method: str, body: dict | None = None, template_id: str | None = None) -> dict:
    """A templates-route request against ``table``; returns the raw response."""
    with patch.object(_mod, 'templates_table', table):
        return _mod.handler(_templates_event(method, body, template_id), None)


def _body(response: dict) -> dict:
    return parse_response(response)[1]


def _create_template(body: dict) -> tuple[dict, dict]:
    """POST /templates with ``body`` on an empty table; returns ``(response, row written by put_item)``."""
    table = research_table_stub()
    response = _call_templates(table, 'POST', body)
    return response, table.put_item.call_args.kwargs['Item']


def _profile(template: dict) -> tuple[str, str, str]:
    return template['industry'], template['subject'], template['audience']


def _start(started: dict, **overrides) -> dict:
    """POST /agent with ``overrides`` on the default brief; returns the persisted job row."""
    _mod.handler(_agent_event(**overrides), None)
    return started['research_table'].put_item.call_args.kwargs['Item']


@pytest.fixture
def started():
    """Patch every collaborator for a successful agent start; yields the mocks.

    The only stored group is ``g1``; the templates table holds nothing.
    """
    groups_table = MagicMock()
    groups_table.get_item.side_effect = lambda Key: {'Item': _GROUP_G1} if Key['id'] == 'g1' else {}
    mocks = {
        'research_table': MagicMock(),
        'templates_table': research_table_stub(),
        'groups_table': groups_table,
        'stepfunctions': started_stepfunctions(),
        'get_web_search_clients': MagicMock(return_value=[('perplexity', object())]),
    }
    with patch.multiple(_mod, **mocks):
        yield mocks


class TestStartAgent:
    def test_returns_202_with_a_pending_agent_job(self, started):
        status, body = parse_response(_mod.handler(_agent_event(), None))

        assert status == 202
        assert (body['type'], body['status'], body['round']) == ('agent', 'pending', 0)

    def test_persists_the_validated_config_and_the_seed_for_history(self, started):
        item = _start(started)

        assert item['config'] == {
            **_BRIEF, 'tracking_count': 15, 'group_id': None,
            'subject': 'hotel', 'audience': 'travellers', 'dimension_catalog': LEGACY_DIMENSION_CATALOG,
        }
        assert (item['seed_keyword'], item['rounds'], item['created_by']) == ('Hotel Gran Marino', [], 'bastian')

    @pytest.mark.parametrize(
        ('overrides', 'tracking_count'),
        [({'tracking_count': 12}, 12), ({'target_count': 10}, 10)],
        ids=['explicit-tracking-count-is-kept', 'omitted-tracking-count-shrinks-to-a-shorter-target'],
    )
    def test_persists_the_resolved_tracking_count(self, started, overrides, tracking_count):
        assert _start(started, **overrides)['config']['tracking_count'] == tracking_count

    def test_rejects_an_explicit_tracking_count_above_the_target(self, started):
        status, body = parse_response(_mod.handler(_agent_event(target_count=10, tracking_count=11), None))

        assert status == 400
        assert (body['field'], body['error']) == ('tracking_count', 'tracking_count cannot exceed target_count')
        started['research_table'].put_item.assert_not_called()

    def test_snapshots_the_industry_profile_of_the_chosen_template(self, started):
        item = _start(started, template_id='builtin-cafes', dimensions=['menu', 'occasion'])

        assert (item['config']['subject'], item['config']['audience']) == ('café', 'coffee drinkers')
        assert [dimension['id'] for dimension in item['config']['dimension_catalog']] == ['menu', 'location', 'occasion', 'attributes', 'audience', 'products']
        assert (item['template_id'], item['template_name'], item['system_prompt']) == ('builtin-cafes', 'Cafés & coffee shops', CAFE_TEMPLATE.system_prompt)

    def test_uses_the_saved_templates_own_catalogue(self, started):
        started['templates_table'].get_item.return_value = {'Item': {
            'id': 't1', 'name': 'Gyms', 'system_prompt': 'You research gyms. ' * 3, 'industry': 'generic',
            'subject': 'gym', 'audience': 'members',
            'dimensions': [{'id': 'classes', 'label': 'Classes', 'description': 'd'}, {'id': 'location', 'label': 'Location', 'description': 'd'}],
        }}

        item = _start(started, template_id='t1', dimensions=['classes'])

        assert (item['config']['subject'], item['config']['audience'], item['config']['dimensions']) == ('gym', 'members', ['classes'])
        assert item['config']['dimension_catalog'][0] == {'id': 'classes', 'label': 'Classes', 'description': 'd'}

    def test_snapshots_the_builtin_prompt_when_no_template_is_chosen(self, started):
        item = _start(started)

        assert (item['system_prompt'], item['template_id']) == (DEFAULT_SYSTEM_PROMPT, BUILTIN_TEMPLATE_ID)
        assert item['template_name'] == 'Hotels'

    def test_snapshots_the_saved_template_prompt_and_name(self, started):
        started['templates_table'].get_item.return_value = {'Item': _RESORT_TEMPLATE}

        item = _start(started, template_id='t1', dimensions=['offering'])

        assert (item['system_prompt'], item['template_id'], item['template_name']) == ('You research resorts. ' * 3, 't1', 'Resort prompt')

    def test_a_saved_template_without_a_profile_reads_as_the_generic_industry(self, started):
        started['templates_table'].get_item.return_value = {'Item': _RESORT_TEMPLATE}

        config = _start(started, template_id='t1', dimensions=['offering', 'location'])['config']

        assert (config['subject'], config['audience']) == ('business', 'customers')
        assert config['dimension_catalog'] == GENERIC_TEMPLATE.to_view()['dimensions']

    def test_an_inline_prompt_edit_wins_over_the_template(self, started):
        started['templates_table'].get_item.return_value = {'Item': {**_RESORT_TEMPLATE, 'system_prompt': 'template text'}}

        item = _start(started, template_id='t1', dimensions=['offering'], system_prompt='edited inline prompt')

        assert (item['system_prompt'], item['template_name']) == ('edited inline prompt', 'Resort prompt')

    def test_records_the_destination_group_when_it_exists(self, started):
        assert _start(started, group_id='g1')['config']['group_id'] == 'g1'

    def test_starts_the_execution_with_retry_false(self, started):
        _mod.handler(_agent_event(), None)

        kwargs = started['stepfunctions'].start_execution.call_args.kwargs
        assert json.loads(kwargs['input'])['retry'] is False

    @pytest.mark.parametrize(('override', 'status', 'message'), [
        ({'dimensions': []}, 400, 'dimensions'),
        ({'dimensions': ['weather']}, 400, 'dimensions'),
        ({'dimensions': [1]}, 400, 'dimensions'),
        ({'dimensions': [None]}, 400, 'dimensions'),
        ({'dimensions': [{'nested': 'value'}]}, 400, 'dimensions'),
        (
            {'template_id': 'builtin-cafes', 'dimensions': ['menu', 'trip_type']}, 400,
            'Unknown dimensions: trip_type. Must be one of: menu, location, occasion, attributes, audience, products',
        ),
        ({'country': 'spain'}, 400, 'country'),
        ({'language': '1'}, 400, 'language'),
        ({'target_count': 5}, 400, 'target_count'),
        ({'tracking_count': 0}, 400, 'tracking_count'),
        ({'tracking_count': 51}, 400, 'tracking_count'),
        ({'tracking_count': None}, 400, 'tracking_count'),
        ({'tracking_count': True}, 400, 'tracking_count'),
        ({'max_rounds': 4}, 400, 'max_rounds'),
        ({'seed': 'x'}, 400, 'seed'),
        ({'system_prompt': '   '}, 400, 'system_prompt'),
        ({'template_id': 'gone'}, 404, 'Template not found'),
        ({'group_id': 'nope'}, 400, 'Keyword group not found'),
    ], ids=[
        'empty-dimensions', 'unknown-dimension', 'integer-dimension', 'null-dimension', 'object-dimension',
        'dimension-the-chosen-template-does-not-offer',
        'country-not-a-code', 'language-not-a-code', 'target-count-too-small',
        'tracking-count-zero', 'tracking-count-above-target', 'tracking-count-null', 'tracking-count-boolean',
        'too-many-rounds', 'seed-too-short', 'blank-system-prompt',
        'template-vanished', 'unknown-destination-group',
    ])
    def test_refuses_an_invalid_brief_without_persisting_a_job(self, started, override, status, message):
        response = _mod.handler(_agent_event(**override), None)

        assert response['statusCode'] == status
        assert message in response['body']
        started['research_table'].put_item.assert_not_called()

    def test_returns_400_when_no_web_search_provider_is_configured(self, started):
        started['get_web_search_clients'].return_value = []

        response = _mod.handler(_agent_event(), None)

        assert response['statusCode'] == 400
        assert 'No API keys configured' in response['body']


class TestListTemplates:
    def test_lists_the_five_builtins_first_then_saved_ones_by_name(self):
        saved = [
            {'id': 't2', 'name': 'Urban hotels', 'system_prompt': 'p2', 'created_at': 'b'},
            {'id': 't1', 'name': 'Beach resorts', 'system_prompt': 'p1', 'created_at': 'a', 'created_by': 'ana'},
        ]

        body = _body(_call_templates(research_table_stub(items=saved), 'GET'))

        assert [(item['id'], item['name'], item['builtin']) for item in body['items']] == [
            (BUILTIN_TEMPLATE_ID, 'Hotels', True), ('builtin-restaurants', 'Restaurants', True), ('builtin-cafes', 'Cafés & coffee shops', True),
            ('builtin-retail', 'Retail stores', True), ('builtin-generic', 'Any business (start here to create your own)', True),
            ('t1', 'Beach resorts', False), ('t2', 'Urban hotels', False),
        ]
        assert body['items'][5]['created_by'] == 'ana'
        assert body['count'] == 7

    def test_every_listed_template_carries_an_industry_profile(self):
        saved = [{'id': 't1', 'name': 'Old prompt-only template', 'system_prompt': 'p1', 'created_at': 'a'}]

        body = _body(_call_templates(research_table_stub(items=saved), 'GET'))

        legacy = body['items'][-1]
        assert _profile(legacy) == _GENERIC_PROFILE
        assert legacy['dimensions'] == GENERIC_TEMPLATE.to_view()['dimensions']
        assert body['items'][0]['dimensions'][0] == LEGACY_DIMENSION_CATALOG[0]


class TestCreateTemplate:
    def test_saves_the_prompt_with_the_author_and_answers_201(self):
        response, item = _create_template({'name': 'Beach resorts', 'system_prompt': 'You research beach resorts for families.', 'description': 'd'})

        assert response['statusCode'] == 201
        assert (item['name'], item['system_prompt'], item['description'], item['created_by']) == ('Beach resorts', 'You research beach resorts for families.', 'd', 'bastian')
        assert _body(response)['builtin'] is False

    def test_copies_the_profile_from_the_base_template(self):
        response, item = _create_template({
            'name': 'Specialty coffee', 'system_prompt': 'You research specialty coffee shops.', 'base_template_id': 'builtin-cafes',
        })

        assert _profile(item) == ('cafes', 'café', 'coffee drinkers')
        assert item['dimensions'] == CAFE_TEMPLATE.to_view()['dimensions']
        assert _body(response)['dimensions'] == item['dimensions']

    def test_defaults_the_profile_to_the_generic_template_without_a_base(self):
        _response, item = _create_template({'name': 'Gyms', 'system_prompt': _GYMS_PROMPT})

        assert _profile(item) == _GENERIC_PROFILE
        assert item['dimensions'] == GENERIC_TEMPLATE.to_view()['dimensions']

    def test_request_profile_fields_override_the_base(self):
        dimensions = [{'id': 'classes', 'label': ' Classes ', 'description': 'yoga, spinning'}, {'id': 'location', 'label': 'Location', 'description': ''}]

        response, item = _create_template({
            'name': 'Gyms', 'system_prompt': _GYMS_PROMPT, 'base_template_id': 'builtin-generic',
            'subject': 'gym', 'audience': 'members', 'dimensions': dimensions,
        })

        assert _profile(item) == ('generic', 'gym', 'members')
        assert item['dimensions'] == [{'id': 'classes', 'label': 'Classes', 'description': 'yoga, spinning'}, {'id': 'location', 'label': 'Location', 'description': ''}]
        assert response['statusCode'] == 201

    @pytest.mark.parametrize(('override', 'message'), [
        ({'subject': '<gym>'}, 'subject must be a word or short phrase'),
        ({'audience': '42'}, 'audience must be a word or short phrase'),
        ({'dimensions': [{'id': 'classes', 'label': 'Classes'}]}, 'at least 2 dimensions'),
        ({'dimensions': [{'id': 'other', 'label': 'Other'}, {'id': 'ok', 'label': 'Ok'}]}, "'other' is reserved"),
        ({'dimensions': [{'id': 'a b', 'label': 'A'}, {'id': 'ok', 'label': 'Ok'}]}, 'must be 2-40 characters'),
        ({'name': 'x', 'system_prompt': 'short'}, 'system_prompt'),
    ], ids=[
        'subject-not-a-phrase', 'audience-not-a-phrase', 'single-dimension', 'reserved-dimension-id',
        'malformed-dimension-id', 'prompt-too-short-to-mean-anything',
    ])
    def test_rejects_an_invalid_template_without_saving(self, override, message):
        table = research_table_stub()

        response = _call_templates(table, 'POST', {'name': 'Gyms', 'system_prompt': _GYMS_PROMPT, **override})

        assert response['statusCode'] == 400
        assert message in response['body']
        table.put_item.assert_not_called()

    @pytest.mark.parametrize(('override', 'error'), [
        ({'name': None}, 'Missing required field: name'),
        ({'system_prompt': None}, 'Missing required field: system_prompt'),
        ({'name': ''}, 'name too short (min 1 characters)'),
        ({'name': 'n' * 101}, 'name too long (max 100 characters)'),
        ({'system_prompt': f'  {"p" * 19}  '}, 'system_prompt too short (min 20 characters)'),
        ({'system_prompt': 'p' * 6001}, 'system_prompt too long (max 6000 characters)'),
        ({'description': 'd' * 501}, 'description too long (max 500 characters)'),
    ], ids=[
        'missing-name', 'missing-prompt', 'empty-name', 'name-over-100', 'prompt-under-20-once-trimmed',
        'prompt-over-6000', 'description-over-500',
    ])
    def test_answers_the_field_error_for_a_body_outside_the_schema(self, override, error):
        field = next(iter(override))
        table = research_table_stub()

        response = _call_templates(table, 'POST', {'name': 'Gyms', 'system_prompt': _GYMS_PROMPT, **override})

        assert parse_response(response) == (400, {'error': error, 'field': field})
        table.put_item.assert_not_called()

    def test_trims_the_name_prompt_and_description_it_saves(self):
        _response, item = _create_template({'name': '  Gyms  ', 'system_prompt': f'  {_GYMS_PROMPT}  ', 'description': '  for members  '})

        assert (item['name'], item['system_prompt'], item['description']) == ('Gyms', _GYMS_PROMPT, 'for members')

    def test_accepts_a_system_prompt_of_exactly_twenty_characters(self):
        response, item = _create_template({'name': 'Gyms', 'system_prompt': 'p' * 20})

        assert (response['statusCode'], item['system_prompt']) == (201, 'p' * 20)

    def test_saves_an_empty_description_when_none_is_sent(self):
        _response, item = _create_template({'name': 'Gyms', 'system_prompt': _GYMS_PROMPT})

        assert item['description'] == ''

    def test_answers_404_for_an_unknown_base_template(self):
        table = research_table_stub()

        response = _call_templates(table, 'POST', {'name': 'Gyms', 'system_prompt': _GYMS_PROMPT, 'base_template_id': 'gone'})

        assert response['statusCode'] == 404
        table.put_item.assert_not_called()

    def test_enforces_the_template_cap(self):
        table = research_table_stub()
        table.scan.return_value = {'Count': _mod.MAX_TEMPLATES}

        response = _call_templates(table, 'POST', {'name': 'x', 'system_prompt': 'You research beach resorts for families.'})

        assert response['statusCode'] == 400
        table.put_item.assert_not_called()


class TestUpdateTemplate:
    def test_updates_only_the_fields_sent(self):
        table = research_table_stub({'id': 't1', 'name': 'Old', 'system_prompt': 'old prompt text for research'})
        table.update_item.return_value = {'Attributes': {'id': 't1', 'name': 'New', 'system_prompt': 'old prompt text for research'}}

        response = _call_templates(table, 'PUT', {'name': 'New'}, template_id='t1')

        call = table.update_item.call_args.kwargs
        assert response['statusCode'] == 200
        assert call['UpdateExpression'] == 'SET #f0 = :v0, #f1 = :v1'
        assert (call['ExpressionAttributeNames'], call['ExpressionAttributeValues'][':v0']) == (
            {'#f0': 'name', '#f1': 'updated_at'}, 'New',
        )
        assert _body(response)['name'] == 'New'

    @pytest.mark.parametrize(('stored', 'body', 'template_id', 'message'), [
        ({'id': 't1', 'name': 'Gyms'}, {'subject': '!!'}, 't1', 'subject must be a word or short phrase'),
        ({'id': 't1'}, {}, 't1', 'Nothing to update'),
    ], ids=['invalid-subject', 'empty-update'])
    def test_refuses_an_update_with_400_without_writing(self, stored, body, template_id, message):
        table = research_table_stub(stored)

        response = _call_templates(table, 'PUT', body, template_id=template_id)

        assert response['statusCode'] == 400
        assert message in response['body']
        table.update_item.assert_not_called()

    def test_updates_the_dimension_catalogue_of_a_saved_template(self):
        table = research_table_stub({'id': 't1', 'name': 'Gyms', 'system_prompt': 'old prompt text for research'})
        cleaned = [{'id': 'classes', 'label': 'Classes', 'description': ''}, {'id': 'trainers', 'label': 'Trainers', 'description': 'pt'}]
        table.update_item.return_value = {'Attributes': {'id': 't1', 'name': 'Gyms', 'system_prompt': 'old prompt text for research', 'dimensions': cleaned}}

        response = _call_templates(table, 'PUT', {'dimensions': [{'id': ' Classes ', 'label': 'Classes'}, {'id': 'trainers', 'label': 'Trainers', 'description': 'pt'}]}, template_id='t1')

        call = table.update_item.call_args.kwargs
        assert call['UpdateExpression'] == 'SET #f0 = :v0, #f1 = :v1'
        assert (call['ExpressionAttributeNames']['#f0'], call['ExpressionAttributeValues'][':v0']) == ('dimensions', cleaned)
        assert _body(response)['dimensions'] == cleaned

    def test_returns_404_for_an_unknown_template(self):
        response = _call_templates(research_table_stub(), 'PUT', {'name': 'New'}, template_id='missing')

        assert response['statusCode'] == 404


class TestDeleteTemplate:
    def test_deletes_a_saved_template(self):
        table = research_table_stub()

        response = _call_templates(table, 'DELETE', template_id='t1')

        assert response['statusCode'] == 200
        table.delete_item.assert_called_once_with(Key={'id': 't1'})

    def test_deleting_a_job_still_reaches_the_job_route(self):
        table = MagicMock()

        with patch.object(_mod, 'research_table', table):
            response = _mod.handler(job_event('DELETE', 'job-9'), None)

        assert response['statusCode'] == 200
        table.delete_item.assert_called_once_with(Key={'id': 'job-9'})


class TestSavedTemplateAddressing:
    @pytest.mark.parametrize(('method', 'body', 'template_id', 'error'), [
        ('PUT', {'name': 'New'}, None, 'Template ID is required'),
        ('DELETE', None, None, 'Template ID is required'),
        ('PUT', {'name': 'New'}, BUILTIN_TEMPLATE_ID, 'Built-in templates cannot be edited; save a copy instead'),
        ('DELETE', None, BUILTIN_TEMPLATE_ID, 'Built-in templates cannot be deleted'),
    ], ids=['update-without-id', 'delete-without-id', 'update-builtin', 'delete-builtin'])
    def test_refuses_a_missing_or_builtin_id_with_an_id_field_error_and_no_write(self, method, body, template_id, error):
        table = research_table_stub()

        response = _call_templates(table, method, body, template_id=template_id)

        assert parse_response(response) == (400, {'error': error, 'field': 'id'})
        assert (table.update_item.call_count, table.delete_item.call_count) == (0, 0)


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
            body = _body(_mod.handler(history_event(), None))

        assert [item['type'] for item in body['items']] == ['agent']
        assert table.query.call_count == 3

    def test_history_strips_the_prompt_snapshot_but_the_detail_keeps_it(self):
        table = MagicMock()
        table.query.return_value = {'Items': [self._agent_row()]}
        table.get_item.return_value = {'Item': self._agent_row()}

        with patch.object(_mod, 'research_table', table):
            listed = _body(_mod.handler(history_event('agent'), None))
            detail = _body(_mod.handler(job_event('GET', 'job-a'), None))

        assert 'system_prompt' not in listed['items'][0]
        assert detail['system_prompt'] == 'secret sauce'

    def test_history_accepts_the_agent_type_filter(self):
        table = MagicMock()
        table.query.return_value = {'Items': []}

        with patch.object(_mod, 'research_table', table):
            response = _mod.handler(history_event('agent'), None)

        assert response['statusCode'] == 200
        assert table.query.call_args.kwargs['KeyConditionExpression']._values[1] == 'agent'
