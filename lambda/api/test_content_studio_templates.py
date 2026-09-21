"""Saved-template API and generation-provenance tests for Content Studio."""

from __future__ import annotations

from unittest.mock import patch

import pytest

from shared.content_brief import (
    CREATE_NEW_LANDING_PAGE,
    IMPROVE_CURRENT_URL,
    builtin_content_brief_templates,
)
from testing.content_brief_fixtures import content_brief_template_item
from testing.content_studio_fixtures import (
    call_content_template_route,
    content_generation_event,
    content_template_generation_case,
    create_content_template_for_test,
    load_content_studio_module,
    patched_content_studio,
    queue_content_brief_for_test,
    queued_template_snapshot,
)
from testing.content_studio_fixtures import (
    content_template_event as template_event,
)
from testing.content_studio_fixtures import (
    content_template_resource as template_resource,
)
from testing.content_studio_fixtures import (
    valid_content_template_body as valid_template_body,
)
from testing.dynamodb_stubs import fake_table

_mod = load_content_studio_module('content_studio_templates_under_test')


class TestTemplateListing:
    def test_returns_builtins_first_then_saved_templates_by_name(self) -> None:
        saved = [
            content_brief_template_item(id='template-z', name='Zulu'),
            content_brief_template_item(id='template-a', name='alpha'),
        ]
        table = fake_table(scan={'Items': saved})

        status, body = call_content_template_route(_mod, table, 'GET')

        expected_ids = [
            *(item['id'] for item in builtin_content_brief_templates()),
            'template-a',
            'template-z',
        ]
        assert status == 200
        assert [item['id'] for item in body['items']] == expected_ids
        assert body['count'] == 5

    def test_exposes_one_immutable_builtin_for_each_content_mode(self) -> None:
        table = fake_table(scan={'Items': []})

        _, body = call_content_template_route(_mod, table, 'GET')

        builtins = body['items']
        assert [item['content_angle'] for item in builtins] == [
            'improve_current_url',
            'rewrite_pasted_copy',
            'create_new_landing_page',
        ]
        assert [item['builtin'] for item in builtins] == [True, True, True]


class TestTemplateCreation:
    def test_persists_complete_saved_shape_with_caller_identity(self) -> None:
        table = fake_table(scan={'Count': 3})

        with patch.object(
            _mod, 'get_timestamp', return_value='2026-09-20T12:00:00Z'
        ):
            status, body = call_content_template_route(
                _mod, table, 'POST', body=valid_template_body()
            )

        persisted = table.put_item.call_args.kwargs['Item']
        assert status == 201
        assert body == persisted
        assert persisted['created_by'] == 'writer@example.com'
        assert persisted['builtin'] is False

    def test_rejects_creation_when_one_hundred_saved_templates_exist(self) -> None:
        table = fake_table(scan={'Count': 100})

        status, body = call_content_template_route(
            _mod, table, 'POST', body=valid_template_body()
        )

        assert status == 400
        assert body == {'error': 'Maximum of 100 templates allowed'}
        table.put_item.assert_not_called()

    def test_rejects_unknown_placeholder_before_template_write(self) -> None:
        table = fake_table(scan={'Count': 0})
        request = valid_template_body(prompt_template='Use {industry}')

        status, body = call_content_template_route(
            _mod, table, 'POST', body=request
        )

        assert status == 400
        assert body == {
            'error': 'prompt_template contains unknown placeholder(s): industry',
            'field': 'prompt_template',
        }
        table.put_item.assert_not_called()

    def test_rejects_unknown_content_mode_before_template_write(self) -> None:
        table = fake_table(scan={'Count': 0})
        request = valid_template_body(content_angle='unknown')

        status, body = call_content_template_route(
            _mod, table, 'POST', body=request
        )

        assert status == 400
        assert body['field'] == 'content_angle'
        table.put_item.assert_not_called()


class TestTemplateMutation:
    def test_updates_only_supplied_saved_template_fields(self) -> None:
        existing = content_brief_template_item()
        updated = {**existing, 'name': 'Renamed', 'updated_at': '2026-09-20T13:00:00Z'}
        table = fake_table(
            get_item={'Item': existing},
            update_item={'Attributes': updated},
        )

        status, body = call_content_template_route(
            _mod,
            table,
            'PUT',
            body={'name': 'Renamed'},
            template_id='template-1',
        )

        assert status == 200
        assert body['name'] == 'Renamed'
        assert body['prompt_template'] == existing['prompt_template']
        assert table.update_item.call_args.kwargs['Key'] == {'id': 'template-1'}

    def test_deletes_known_saved_template(self) -> None:
        table = fake_table(get_item={'Item': content_brief_template_item()})

        status, body = call_content_template_route(
            _mod, table, 'DELETE', template_id='template-1'
        )

        assert status == 200
        assert body == {'message': 'Template deleted successfully'}
        table.delete_item.assert_called_once_with(Key={'id': 'template-1'})

    def test_rejects_editing_builtin_template(self) -> None:
        builtin_id = builtin_content_brief_templates()[0]['id']
        table = fake_table()

        status, body = call_content_template_route(
            _mod,
            table,
            'PUT',
            body={'name': 'Changed'},
            template_id=builtin_id,
        )

        assert status == 400
        assert body['field'] == 'id'
        table.update_item.assert_not_called()

    def test_rejects_deleting_builtin_template(self) -> None:
        builtin_id = builtin_content_brief_templates()[0]['id']
        table = fake_table()

        status, body = call_content_template_route(
            _mod, table, 'DELETE', template_id=builtin_id
        )

        assert status == 400
        assert body == {'error': 'Built-in templates cannot be deleted', 'field': 'id'}
        table.delete_item.assert_not_called()

    def test_returns_404_when_updated_template_is_unknown(self) -> None:
        table = fake_table(get_item={})

        status, body = call_content_template_route(
            _mod,
            table,
            'PUT',
            body={'name': 'Changed'},
            template_id='missing',
        )

        assert status == 404
        assert body == {'error': 'Template not found'}
        table.update_item.assert_not_called()

    def test_returns_404_when_deleted_template_is_unknown(self) -> None:
        table = fake_table(get_item={})

        status, body = call_content_template_route(
            _mod, table, 'DELETE', template_id='missing'
        )

        assert status == 404
        assert body == {'error': 'Template not found'}
        table.delete_item.assert_not_called()


class TestGenerationTemplateSnapshot:
    def test_exact_caller_prompt_wins_and_provenance_is_snapshotted(self) -> None:
        status, snapshot = queued_template_snapshot(
            _mod,
            prompt_template='Exact caller prompt for {scope} and {keywords}.',
        )
        assert status == 200
        assert snapshot['prompt_template'] == 'Exact caller prompt for {scope} and {keywords}.'
        assert snapshot['template_name'] == 'Saved landing page'
        assert snapshot['template_modified'] is True

    def test_template_mode_is_authoritative_for_generation(self) -> None:
        status, snapshot = queued_template_snapshot(
            _mod,
            content_angle=IMPROVE_CURRENT_URL,
            landing_url='',
        )
        assert status == 200
        assert snapshot['content_angle'] == CREATE_NEW_LANDING_PAGE
        assert snapshot['template_id'] == 'template-1'

    def test_template_prompt_is_used_when_caller_omits_prompt(self) -> None:
        saved = content_brief_template_item(
            prompt_template='Saved prompt for {scope} and {keywords}.'
        )
        template_table, content_table, idea = content_template_generation_case(saved)
        idea.pop('prompt_template')
        queue_content_brief_for_test(
            _mod,
            idea,
            template_table=template_table,
            content_table=content_table,
        )

        snapshot = content_table.put_item.call_args.kwargs['Item']['idea_data']
        assert snapshot['prompt_template'] == 'Saved prompt for {scope} and {keywords}.'
        assert snapshot['template_modified'] is False

    def test_saved_template_is_read_strongly_before_snapshot(self) -> None:
        template_table, content_table, idea = content_template_generation_case()

        queue_content_brief_for_test(
            _mod,
            idea,
            template_table=template_table,
            content_table=content_table,
        )

        template_table.get_item.assert_called_once_with(
            Key={'id': 'template-1'},
            ConsistentRead=True,
        )

    def test_template_edit_does_not_change_existing_generation_snapshot(self) -> None:
        saved = content_brief_template_item(prompt_template='Original {scope} {keywords}')
        template_table, content_table, idea = content_template_generation_case(
            saved,
            prompt_template='Original {scope} {keywords}',
        )
        generation_event = content_generation_event(idea)

        with patched_content_studio(
            _mod, template_resource(template_table, content_table=content_table)
        ):
            _mod._generate_content(generation_event, None)
            template_table.get_item.return_value = {'Item': saved}
            template_table.update_item.return_value = {
                'Attributes': {**saved, 'prompt_template': 'Edited {scope} {keywords}'}
            }
            _mod._api_handler(
                template_event(
                    'PUT',
                    body={'prompt_template': 'Edited {scope} {keywords}'},
                    template_id='template-1',
                ),
                None,
            )

        snapshot = content_table.put_item.call_args.kwargs['Item']['idea_data']
        assert snapshot['prompt_template'] == 'Original {scope} {keywords}'
        assert template_table.update_item.call_count == 1

    def test_missing_template_id_preserves_custom_prompt_without_provenance(self) -> None:
        template_table, content_table, idea = content_template_generation_case(
            prompt_template='Custom {scope} {keywords}'
        )
        idea.pop('template_id')
        queue_content_brief_for_test(
            _mod,
            idea,
            template_table=template_table,
            content_table=content_table,
        )

        snapshot = content_table.put_item.call_args.kwargs['Item']['idea_data']
        assert snapshot['prompt_template'] == 'Custom {scope} {keywords}'
        assert 'template_id' not in snapshot
        template_table.get_item.assert_not_called()

    def test_unknown_template_id_returns_404_before_content_write(self) -> None:
        template_table, content_table, idea = content_template_generation_case(
            template_id='missing-template'
        )
        template_table.get_item.return_value = {}
        status, body = queue_content_brief_for_test(
            _mod,
            idea,
            template_table=template_table,
            content_table=content_table,
        )

        assert status == 404
        assert body == {'error': 'Template not found'}
        content_table.put_item.assert_not_called()



class TestTemplateTextBoundaries:
    @pytest.mark.parametrize(
        ('field_name', 'value'),
        [('name', 'n' * 101), ('description', 'd' * 501)],
        ids=['name', 'description'],
    )
    def test_rejects_template_text_one_character_beyond_limit(
        self, field_name: str, value: str
    ) -> None:
        status, body, table = create_content_template_for_test(
            _mod, **{field_name: value}
        )

        assert status == 400
        assert body['field'] == field_name
        table.put_item.assert_not_called()

    @pytest.mark.parametrize(
        ('field_name', 'value'),
        [('name', 'n' * 100), ('description', 'd' * 500)],
        ids=['name', 'description'],
    )
    def test_accepts_template_text_at_exact_limit(
        self, field_name: str, value: str
    ) -> None:
        status, body, _table = create_content_template_for_test(
            _mod, **{field_name: value}
        )

        assert status == 201
        assert body[field_name] == value
