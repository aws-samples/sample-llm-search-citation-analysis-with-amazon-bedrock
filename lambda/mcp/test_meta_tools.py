"""
The meta tools over the wire: ``search_tools`` → ``describe_tool`` → ``call_tool``, and ``tools/call`` error codes.
"""

from __future__ import annotations

from catalogue import find_operation

from testing.mcp_result_fixtures import READ_SCOPE, text_block


def _call(rpc, name: str, arguments: dict | None = None) -> dict:
    """The decoded JSON-RPC response to ``tools/call``."""
    return rpc('tools/call', {'name': name, 'arguments': arguments or {}})


class TestSearchTools:
    def test_returns_name_description_and_tab_of_up_to_five_matches(self, rpc):
        result = _call(rpc, 'search_tools', {'query': 'which engines are enabled'})['result']

        tools = result['structuredContent']['tools']
        assert tools[0] == {'name': 'list_providers', 'description': find_operation('list_providers').description, 'tab': 'Settings'}
        assert 1 <= len(tools) <= 5
        assert set(tools[0]) == {'name', 'description', 'tab'}

    def test_summarises_the_match_count_in_its_text_block(self, rpc):
        result = _call(rpc, 'search_tools', {'query': 'zzqx plorf'})['result']

        assert text_block(result) == ("0 tool(s) match 'zzqx plorf'", {'tools': []})
        assert result['structuredContent'] == {'tools': []}

    def test_needs_a_query(self, rpc):
        response = _call(rpc, 'search_tools', {})

        assert response['error'] == {'code': -32602, 'message': 'Missing required argument(s): query'}


class TestDescribeTool:
    def test_returns_the_full_definition_of_a_catalogue_operation(self, rpc):
        tool = find_operation('get_sentiment_examples')

        described = _call(rpc, 'describe_tool', {'name': 'get_sentiment_examples'})['result']['structuredContent']

        assert described == {
            'name': 'get_sentiment_examples',
            'description': tool.description,
            'inputSchema': tool.input_schema,
            'examples': list(tool.examples),
            'scope': 'read',
            'admin': False,
            'readOnlyHint': True,
        }

    def test_describes_the_write_tool_as_not_read_only(self, rpc):
        described = _call(rpc, 'describe_tool', {'name': 'manage_keywords'})['result']['structuredContent']

        assert (described['scope'], described['admin'], described['readOnlyHint']) == ('write', False, False)

    def test_rejects_an_unknown_operation_with_invalid_params(self, rpc):
        assert _call(rpc, 'describe_tool', {'name': 'launch_rockets'})['error'] == {'code': -32602, 'message': 'Unknown tool: launch_rockets'}

    def test_does_not_describe_the_meta_tools_themselves(self, rpc):
        assert _call(rpc, 'describe_tool', {'name': 'call_tool'})['error']['code'] == -32602


class TestCallTool:
    def test_runs_a_catalogue_operation_through_the_same_invoker(self, rpc, api):
        api.answer(200, [{'id': 'p1', 'name': 'Family', 'enabled': 'true'}])

        result = _call(rpc, 'call_tool', {'name': 'list_personas'})['result']

        assert (api.event['httpMethod'], api.event['path']) == ('GET', '/api/query-prompts')
        assert result['structuredContent'] == {'items': [{'id': 'p1', 'name': 'Family', 'enabled': 'true'}]}

    def test_passes_the_nested_arguments_to_the_operation(self, rpc, api):
        _call(rpc, 'call_tool', {'name': 'get_prompt_insights', 'arguments': {'type': 'losing', 'limit': 3}})

        assert api.event['queryStringParameters'] == {'type': 'losing', 'limit': '3'}

    def test_applies_the_operations_scope_check(self, rpc, api, claims):
        arguments = {'name': 'manage_keywords', 'arguments': {'action': 'create_group', 'name': 'x'}}

        result = rpc('tools/call', {'name': 'call_tool', 'arguments': arguments}, claims_override=claims(scope=f'openid {READ_SCOPE}'))['result']

        assert (result['isError'], api.client.invoke.call_args_list) == (True, [])

    def test_audits_the_operation_it_ran_under_the_call_tool_name(self, rpc, api, audit):
        api.answer(200, {'providers': []})

        _call(rpc, 'call_tool', {'name': 'list_providers'})

        assert [(line['tool'], line['operation'], line['outcome']) for line in audit()] == [('call_tool', 'list_providers', 'http_200')]

    def test_validates_the_nested_arguments_against_the_operations_schema(self, rpc):
        response = _call(rpc, 'call_tool', {'name': 'get_prompt_insights', 'arguments': {'type': 'random'}})

        assert response['error']['code'] == -32602
        assert response['error']['message'] == 'type must be one of: winning, losing, opportunities, all'

    def test_rejects_an_unknown_operation_name(self, rpc):
        assert _call(rpc, 'call_tool', {'name': 'nope'})['error'] == {'code': -32602, 'message': 'Unknown tool: nope'}


class TestToolsCallErrors:
    def test_an_unknown_direct_tool_is_invalid_params(self, rpc):
        assert _call(rpc, 'launch_rockets')['error'] == {'code': -32602, 'message': 'Unknown tool: launch_rockets'}

    def test_a_call_without_a_tool_name_is_invalid_params(self, rpc):
        response = rpc('tools/call', {'arguments': {}})

        assert response['error'] == {'code': -32602, 'message': 'tools/call needs a tool name and an arguments object'}

    def test_arguments_that_are_not_an_object_are_invalid_params(self, rpc):
        assert rpc('tools/call', {'name': 'ping', 'arguments': [1]})['error']['code'] == -32602

    def test_missing_arguments_default_to_an_empty_object(self, rpc, api):
        api.answer(200, {'groups': [], 'count': 0})

        assert 'result' in rpc('tools/call', {'name': 'list_keyword_groups'})

    def test_bad_tool_arguments_are_invalid_params_with_the_reason(self, rpc):
        response = _call(rpc, 'get_visibility', {'group_id': 'grp_1', 'all': True})

        assert response['error'] == {'code': -32602, 'message': 'Use exactly one of group_id, keyword_ids, keyword, all'}

    def test_a_catalogue_operation_can_also_be_called_directly_by_name(self, rpc, api):
        api.answer(200, {'total_searches': 3})

        result = _call(rpc, 'get_dashboard_stats')['result']

        assert (api.event['path'], result['structuredContent']) == ('/api/stats', {'total_searches': 3})

    def test_an_unexpected_failure_is_an_internal_error_not_a_crash(self, rpc, monkeypatch):
        monkeypatch.setenv('MCP_API_FUNCTIONS', '{}')

        response = _call(rpc, 'get_dashboard_stats')

        assert response['error'] == {'code': -32603, 'message': 'Internal error'}
