"""End-to-end handler tests for Content Studio group brief requests."""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import pytest

from shared.content_brief import (
    CREATE_NEW_LANDING_PAGE,
    DEFAULT_PROMPT_TEMPLATES,
    IMPROVE_CURRENT_URL,
    ContentBriefFetchError,
)
from testing.content_brief_fixtures import build_group_brief
from testing.dynamodb_stubs import fake_dynamodb_resource, fake_table
from testing.events import api_gateway_event, parse_response
from testing.module_loader import load_handler_module

for environment_name, table_name in (
    ('DYNAMODB_TABLE_SEARCH_RESULTS', 'test-search'),
    ('DYNAMODB_TABLE_CITATIONS', 'test-citations'),
    ('DYNAMODB_TABLE_CRAWLED_CONTENT', 'test-crawled'),
    ('DYNAMODB_TABLE_CONTENT_STUDIO', 'test-content-studio'),
    ('DYNAMODB_TABLE_KEYWORDS', 'test-keywords'),
    ('DYNAMODB_TABLE_KEYWORD_GROUPS', 'test-keyword-groups'),
):
    os.environ.setdefault(environment_name, table_name)
_mod = load_handler_module(
    os.path.dirname(__file__), 'content-studio.py', 'content_studio_group_brief_under_test'
)


def generation_event(idea: dict[str, object]) -> dict[str, object]:
    return api_gateway_event(
        'POST',
        '/content-studio/generate',
        body={'idea': idea},
    )


def dynamodb_with_group(
    *,
    group: dict[str, object] | None = None,
    members: list[dict[str, object]] | None = None,
) -> tuple[MagicMock, MagicMock]:
    group_item = {'id': 'group-1', 'name': 'Authoritative Group'} if group is None else group
    groups_table = fake_table(get_item={'Item': group_item})
    active_members = [
        {'id': 'keyword-1', 'keyword': 'Alpha', 'group_ids': {'group-1'}},
        {'id': 'keyword-2', 'keyword': 'Beta', 'group_ids': {'group-1'}},
    ] if members is None else members
    keywords_table = fake_table(query={'Items': active_members})
    content_table = fake_table()
    resource = fake_dynamodb_resource(by_name={
        'test-keyword-groups': groups_table,
        'test-keywords': keywords_table,
        'test-content-studio': content_table,
    })
    return resource, content_table


def generate_response(idea: dict[str, object], resource: MagicMock) -> dict[str, object]:
    """Run the decorated generate route against a supplied DynamoDB resource."""
    with patch.object(_mod, 'dynamodb', resource):
        return _mod._generate_content(generation_event(idea), None)


class TestGroupBriefGenerateRoute:
    def test_persists_authoritative_group_and_keyword_values_before_dispatch(self) -> None:
        resource, content_table = dynamodb_with_group()
        dispatch = MagicMock()
        idea = build_group_brief(
            keyword_ids=['keyword-2', 'keyword-1'],
            keywords=['stale beta', 'stale alpha'],
        )

        with patch.object(_mod, 'dynamodb', resource), patch.object(
            _mod, 'invoke_self_async', dispatch
        ):
            response = _mod._generate_content(generation_event(idea), None)

        persisted = content_table.put_item.call_args.kwargs['Item']['idea_data']
        dispatched = dispatch.call_args.args[0]['idea']
        assert response['statusCode'] == 200
        assert persisted['group_name'] == 'Authoritative Group'
        assert persisted['keywords'] == ['Alpha', 'Beta']
        assert dispatched == persisted

    def test_snapshots_exact_effective_template_in_idea_data(self) -> None:
        resource, content_table = dynamodb_with_group()
        custom_template = 'Create for {brand} with {keywords} in {output_language}.'

        with patch.object(_mod, 'dynamodb', resource), patch.object(
            _mod, 'invoke_self_async', MagicMock()
        ):
            _mod._generate_content(
                generation_event(build_group_brief(prompt_template=custom_template)), None
            )

        persisted = content_table.put_item.call_args.kwargs['Item']['idea_data']
        assert persisted['prompt_template'] == custom_template

    def test_returns_field_specific_400_when_selected_keyword_is_not_a_member(self) -> None:
        resource, content_table = dynamodb_with_group(
            members=[{'id': 'keyword-1', 'keyword': 'Alpha', 'group_ids': {'other-group'}}]
        )

        response = generate_response(build_group_brief(), resource)

        status, body = parse_response(response)
        assert status == 400
        assert body == {
            'error': 'keyword_ids must contain only active keywords in the selected group',
            'field': 'keyword_ids',
        }
        content_table.put_item.assert_not_called()

    def test_returns_field_specific_400_when_template_placeholder_is_unknown(self) -> None:
        resource, content_table = dynamodb_with_group()

        response = generate_response(
            build_group_brief(prompt_template='Use {industry}'), resource
        )

        status, body = parse_response(response)
        assert status == 400
        assert body == {
            'error': 'prompt_template contains unknown placeholder(s): industry',
            'field': 'prompt_template',
        }
        content_table.put_item.assert_not_called()

    def test_returns_field_specific_400_when_url_is_restricted(self) -> None:
        resource, content_table = dynamodb_with_group()
        idea = build_group_brief(
            content_angle=IMPROVE_CURRENT_URL,
            landing_url='http://127.0.0.1/private',
            prompt_template=DEFAULT_PROMPT_TEMPLATES[IMPROVE_CURRENT_URL],
        )

        response = generate_response(idea, resource)

        status, body = parse_response(response)
        assert status == 400
        assert body['field'] == 'landing_url'
        assert body['error'] == 'landing_url is invalid: URL points to a restricted address'
        content_table.put_item.assert_not_called()

    def test_keeps_legacy_idea_dispatch_contract_unchanged(self) -> None:
        content_table = fake_table()
        resource = fake_dynamodb_resource(content_table)
        dispatch = MagicMock()
        legacy_idea = {
            'id': 'legacy-1',
            'type': 'visibility_gap',
            'keyword': 'generic keyword',
            'content_angle': 'comprehensive_guide',
        }

        with patch.object(_mod, 'dynamodb', resource), patch.object(
            _mod, 'invoke_self_async', dispatch
        ):
            response = _mod._generate_content(generation_event(legacy_idea), None)

        status, body = parse_response(response)
        assert status == 200
        assert body['keyword'] == 'generic keyword'
        assert dispatch.call_args.args[0]['idea'] == legacy_idea
        assert resource.Table.call_args.args == ('test-content-studio',)


class TestGroupBriefAsyncGeneration:
    def test_returns_safe_failed_result_when_url_fetch_fails(self) -> None:
        idea = build_group_brief(
            content_angle=IMPROVE_CURRENT_URL,
            landing_url='https://example.com/page',
            prompt_template=DEFAULT_PROMPT_TEMPLATES[IMPROVE_CURRENT_URL],
        )
        failure = ContentBriefFetchError(
            'Could not fetch the landing URL. Check that it is publicly accessible and try again.'
        )
        bedrock = MagicMock()

        with patch.object(_mod, 'build_group_brief_prompt', side_effect=failure), patch.object(
            _mod, 'invoke_bedrock', bedrock
        ):
            result = _mod.generate_content(idea, {})

        assert result == {
            'success': False,
            'error': 'Could not fetch the landing URL. Check that it is publicly accessible and try again.',
            'error_type': 'source_fetch',
            'content_angle': IMPROVE_CURRENT_URL,
        }
        bedrock.assert_not_called()

    def test_marks_async_generation_failed_when_url_fetch_fails(self) -> None:
        failure_result = {
            'success': False,
            'error': 'The landing URL must return HTML content.',
            'error_type': 'source_fetch',
            'content_angle': IMPROVE_CURRENT_URL,
        }
        update = MagicMock()

        with patch.object(_mod, 'get_brand_config', return_value={}), patch.object(
            _mod, 'generate_content', return_value=failure_result
        ), patch.object(_mod, 'update_content_status', update):
            _mod._process_generation_async('content-1', build_group_brief())

        assert update.call_args_list[0].args == ('content-1', 'generating')
        assert update.call_args_list[1].args == ('content-1', 'failed', failure_result)

    def test_parses_group_brief_with_existing_generated_content_shape(self) -> None:
        generated = """TITLE: Example title
META: Example description

## Overview
Useful body.

HEADINGS: Overview, FAQ
POINTS:
- First point
- Second point"""

        with patch.object(
            _mod, 'build_group_brief_prompt', return_value=('prompt', 1)
        ), patch.object(_mod, 'invoke_bedrock', return_value=generated):
            result = _mod.generate_content(build_group_brief(), {})

        assert result['success'] is True
        assert result['content'] == {
            'title': 'Example title',
            'meta_description': 'Example description',
            'body': '## Overview\nUseful body.',
            'suggested_headings': ['Overview', 'FAQ'],
            'key_points': ['First point', 'Second point'],
        }
        assert result['content_angle'] == CREATE_NEW_LANDING_PAGE
        assert result['competitor_sources_used'] == 1


@pytest.mark.parametrize(
    'field',
    ['id', 'group_id', 'keyword_ids', 'content_angle', 'prompt_template', 'output_language'],
)
def test_group_brief_requires_bounded_contract_field(field: str) -> None:
    resource, content_table = dynamodb_with_group()
    idea = build_group_brief()
    idea.pop(field)

    with patch.object(_mod, 'dynamodb', resource):
        response = _mod._generate_content(generation_event(idea), None)

    status, body = parse_response(response)
    assert status == 400
    assert body['field'] == field
    content_table.put_item.assert_not_called()
