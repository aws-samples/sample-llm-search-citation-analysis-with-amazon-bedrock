"""
Invariants of the tool catalogue, the shape and size of ``tools/list``, and the routes the entries build.
"""

from __future__ import annotations

import json

import pytest
from catalogue import (
    META_TOOLS,
    OPERATIONS,
    InvalidArguments,
    Route,
    find_operation,
    listed_operations,
    tool_listing,
    validate_arguments,
)

#: ``len(json.dumps(tools)) / 4``: the roadmap's 4,000 leaves this margin for tokenizer variance.
TOKEN_BUDGET = 3500
ROUTERS = {
    'keyword-mgmt', 'config-mgmt', 'execution-mgmt', 'stats-insights', 'citations-content',
    'brand-config', 'brand-mentions', 'persona-rankings',
}
DIRECT_TOOLS = [
    'list_keyword_groups', 'list_keywords', 'get_brand_config', 'get_visibility', 'get_report', 'get_citations',
    'list_recommendations', 'manage_keywords',
]
META_TOOL_NAMES = ['search_tools', 'describe_tool', 'call_tool']


def _names(tools) -> list[str]:
    return [tool['name'] for tool in tools]


def _route(name: str, arguments: dict) -> Route:
    tool = find_operation(name)
    return tool.route(validate_arguments(tool.input_schema, arguments))


@pytest.mark.parametrize('tool', OPERATIONS, ids=lambda tool: tool.name)
class TestEveryEntry:
    def test_declares_a_read_or_write_scope(self, tool):
        assert tool.scope in ('read', 'write')

    def test_has_an_object_schema_that_rejects_unknown_properties(self, tool):
        assert (tool.input_schema['type'], tool.input_schema['additionalProperties']) == ('object', False)

    def test_has_at_least_one_tag(self, tool):
        assert len(tool.tags) >= 1

    def test_describes_itself_in_under_240_characters(self, tool):
        assert 0 < len(tool.description) < 240

    def test_names_a_dashboard_tab(self, tool):
        assert tool.tab != ''

    def test_offers_at_least_one_example_that_fits_its_schema(self, tool):
        assert len(tool.examples) >= 1
        assert [validate_arguments(tool.input_schema, dict(example)) for example in tool.examples] == list(tool.examples)

    def test_routes_its_first_example_to_a_known_router_under_the_api_prefix(self, tool):
        route = tool.route(dict(tool.examples[0]))

        assert route.router in ROUTERS
        assert route.path.startswith('/api/')
        assert route.method in ('GET', 'POST', 'PUT')

    def test_reads_only_when_it_is_not_a_write_tool(self, tool):
        assert tool.read_only is (tool.scope == 'read')


class TestToolsList:
    def test_default_listing_is_the_direct_entries_then_the_meta_tools(self):
        assert _names(tool_listing()) == DIRECT_TOOLS + META_TOOL_NAMES

    def test_default_listing_stays_under_the_token_budget(self):
        assert len(json.dumps(tool_listing())) / 4 < TOKEN_BUDGET

    def test_full_listing_names_every_catalogue_entry_and_the_meta_tools(self):
        assert _names(tool_listing(full=True)) == [tool.name for tool in OPERATIONS] + META_TOOL_NAMES

    def test_catalogue_entries_beyond_the_direct_ones_exist(self):
        assert len(OPERATIONS) > len(DIRECT_TOOLS)

    def test_pinned_tools_join_the_default_listing_in_catalogue_order(self, monkeypatch):
        monkeypatch.setenv('MCP_PINNED_TOOLS', ' list_personas,list_providers ,unknown_tool')

        names = [tool.name for tool in listed_operations()]

        assert names == [*DIRECT_TOOLS, 'list_providers', 'list_personas']

    def test_every_listed_tool_carries_closed_world_annotations(self):
        annotations = {json.dumps(tool['annotations'], sort_keys=True) for tool in tool_listing(full=True)}

        assert annotations == {
            '{"destructiveHint": false, "openWorldHint": false, "readOnlyHint": true}',
            '{"destructiveHint": false, "openWorldHint": false, "readOnlyHint": false}',
        }

    def test_manage_keywords_and_call_tool_are_the_only_tools_not_marked_read_only(self):
        writers = [tool['name'] for tool in tool_listing(full=True) if tool['annotations']['readOnlyHint'] is False]

        assert writers == ['manage_keywords', 'call_tool']

    def test_meta_tools_require_their_lookup_argument(self):
        assert [meta['inputSchema'].get('required') for meta in META_TOOLS] == [['query'], ['name'], ['name']]

    def test_tools_full_query_lists_the_whole_catalogue_over_the_wire(self, rpc):
        tools = rpc('tools/list', query={'tools': 'full'})['result']['tools']

        assert len(tools) == len(OPERATIONS) + len(META_TOOLS)

    def test_tools_list_without_the_query_is_the_default_listing_over_the_wire(self, rpc):
        assert _names(rpc('tools/list')['result']['tools']) == DIRECT_TOOLS + META_TOOL_NAMES


class TestArgumentValidation:
    def test_rejects_unknown_arguments_by_name(self):
        with pytest.raises(InvalidArguments, match='Unknown argument\\(s\\): groupId'):
            _route('list_keywords', {'groupId': 'g1'})

    def test_rejects_a_missing_required_argument(self):
        with pytest.raises(InvalidArguments, match='Missing required argument\\(s\\): kind'):
            _route('get_report', {'days': 7})

    def test_rejects_a_value_outside_the_enum(self):
        with pytest.raises(InvalidArguments, match='status must be one of: active, inactive, paused'):
            _route('list_keywords', {'status': 'archived'})

    def test_rejects_an_integer_out_of_range(self):
        with pytest.raises(InvalidArguments, match='limit must be between 1 and 1000'):
            _route('list_keywords', {'limit': 0})

    def test_rejects_a_boolean_where_an_integer_is_expected(self):
        with pytest.raises(InvalidArguments, match='limit must be of type integer'):
            _route('list_keywords', {'limit': True})

    def test_rejects_non_string_items_in_a_string_list(self):
        with pytest.raises(InvalidArguments, match='keyword_ids items must be of type string'):
            _route('get_visibility', {'keyword_ids': ['kw_1', 2]})

    def test_rejects_arguments_that_are_not_an_object(self):
        tool = find_operation('list_keywords')

        with pytest.raises(InvalidArguments, match='arguments must be an object'):
            validate_arguments(tool.input_schema, ['kw_1'])

    def test_ignores_optional_arguments_sent_as_null(self):
        assert _route('list_keywords', {'status': None}).query is None


class TestScopeRouting:
    @pytest.mark.parametrize(('arguments', 'query'), [
        ({'group_id': 'grp_1'}, {'group_id': 'grp_1'}),
        ({'keyword_ids': ['kw_1', 'kw_2']}, {'keyword_ids': 'kw_1,kw_2'}),
        ({'keyword': 'hotel coruña'}, {'keyword': 'hotel coruña'}),
        ({'all': True}, {'scope': 'all'}),
    ], ids=['group', 'ids', 'keyword', 'all'])
    def test_turns_each_scope_argument_into_the_handlers_query_parameter(self, arguments, query):
        assert _route('get_visibility', arguments).query == query

    def test_rejects_two_scope_arguments_at_once(self):
        with pytest.raises(InvalidArguments, match='exactly one of group_id, keyword_ids, keyword, all'):
            _route('get_visibility', {'group_id': 'grp_1', 'all': True})

    def test_requires_a_scope_where_the_handler_does(self):
        with pytest.raises(InvalidArguments, match='Provide one of group_id, keyword_ids, keyword, all'):
            _route('get_visibility', {'brand': 'Hotel Coruña'})

    def test_treats_all_false_as_no_scope(self):
        with pytest.raises(InvalidArguments, match='Provide one of'):
            _route('get_visibility', {'all': False})

    def test_lets_optional_scope_reports_run_unscoped(self):
        assert _route('get_report', {'kind': 'overview', 'days': 30}) == Route(
            'stats-insights', 'GET', '/api/reports/overview', '/api/reports/overview', None, {'days': '30'}, None,
        )

    def test_group_kpis_report_requires_a_scope(self):
        with pytest.raises(InvalidArguments, match='Provide one of'):
            _route('get_report', {'kind': 'group_kpis'})

    def test_competitor_report_passes_its_own_parameters(self):
        route = _route('get_report', {'kind': 'competitor', 'competitor': 'Rival Hotels', 'keyword_limit': 5})

        assert (route.path, route.query) == ('/api/reports/competitor', {'competitor': 'Rival Hotels', 'keyword_limit': '5'})

    def test_citation_gaps_go_to_the_stats_router_and_the_list_to_citations(self):
        gaps, listing = _route('get_citations', {'view': 'gaps', 'limit': 5}), _route('get_citations', {'view': 'list'})

        assert (gaps.router, gaps.path, gaps.query) == ('stats-insights', '/api/citation-gaps', {'limit': '5'})
        assert (listing.router, listing.path, listing.query) == ('citations-content', '/api/citations', None)

    def test_booleans_travel_as_lower_case_strings(self):
        assert _route('get_crawled_page', {'url': 'https://e.com/p', 'include_history': True}).query == {
            'url': 'https://e.com/p', 'include_history': 'true',
        }


class TestManageKeywordsRouting:
    def test_update_group_targets_the_group_path_with_its_id_as_path_parameter(self):
        route = _route('manage_keywords', {'action': 'update_group', 'group_id': 'grp_1', 'name': 'Galicia'})

        assert route == Route(
            'keyword-mgmt', 'PUT', '/api/keyword-groups/grp_1', '/api/keyword-groups/{id}', {'id': 'grp_1'}, None,
            {'name': 'Galicia'},
        )

    def test_add_posts_the_keyword_fields_and_group_membership(self):
        route = _route('manage_keywords', {'action': 'add', 'keyword': 'parador', 'priority': 'high', 'group_ids': ['grp_1']})

        assert (route.method, route.path, route.body) == (
            'POST', '/api/keywords', {'keyword': 'parador', 'priority': 'high', 'group_ids': ['grp_1']},
        )

    def test_set_status_puts_the_stored_keyword_text_with_the_new_status(self):
        route = _route('manage_keywords', {'action': 'set_status', 'keyword_id': 'kw_1', 'keyword': 'parador', 'status': 'paused'})

        assert (route.path, route.path_params, route.body) == (
            '/api/keywords/kw_1', {'id': 'kw_1'}, {'keyword': 'parador', 'status': 'paused'},
        )

    def test_set_membership_sends_the_add_and_remove_lists_to_the_group(self):
        arguments = {'action': 'set_membership', 'group_id': 'grp_1', 'add_keyword_ids': ['kw_1'], 'remove_keyword_ids': ['kw_2']}

        route = _route('manage_keywords', arguments)

        assert (route.path, route.body) == ('/api/keyword-groups/grp_1/keywords', {'add': ['kw_1'], 'remove': ['kw_2']})

    def test_set_membership_without_lists_sends_empty_lists_for_the_handler_to_refuse(self):
        route = _route('manage_keywords', {'action': 'set_membership', 'group_id': 'grp_1'})

        assert route.body == {'add': [], 'remove': []}

    @pytest.mark.parametrize(('arguments', 'missing'), [
        ({'action': 'create_group'}, 'create_group needs name'),
        ({'action': 'set_status', 'keyword_id': 'kw_1'}, 'set_status needs keyword, status'),
        ({'action': 'update', 'keyword': 'parador'}, 'update needs keyword_id'),
        ({'action': 'update_group', 'group_id': ''}, 'update_group needs group_id'),
    ], ids=['create_group', 'set_status', 'update', 'blank_id'])
    def test_names_the_arguments_an_action_is_missing(self, arguments, missing):
        with pytest.raises(InvalidArguments, match=missing):
            _route('manage_keywords', arguments)

    def test_is_the_only_write_tool_and_is_not_admin_gated(self):
        writers = [tool for tool in OPERATIONS if tool.scope == 'write']

        assert [(tool.name, tool.admin) for tool in writers] == [('manage_keywords', False)]


class TestProviderShape:
    def test_strips_provider_rows_to_id_name_enabled_configured_and_model(self):
        shape = find_operation('list_providers').shape
        assert shape is not None

        shaped = shape({'providers': [{
            'id': 'openai', 'name': 'OpenAI', 'enabled': True, 'configured': True, 'model': 'gpt-5-mini',
            'masked_key': 'sk-1...wxyz', 'docs_url': 'https://platform.openai.com', 'last_error': 'boom',
        }]})

        assert shaped == {'providers': [
            {'id': 'openai', 'name': 'OpenAI', 'enabled': True, 'configured': True, 'model': 'gpt-5-mini'},
        ]}

    def test_shapes_an_unexpected_body_to_an_empty_provider_list(self):
        shape = find_operation('list_providers').shape
        assert shape is not None

        assert shape(['not', 'a', 'dict']) == {'providers': []}
