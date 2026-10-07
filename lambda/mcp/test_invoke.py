"""
Replaying a tool call against the API handler Lambdas: the event sent, the result shaped, the audit line.
"""

from __future__ import annotations

import dataclasses
import io
import json
from unittest.mock import MagicMock

import pytest
import state
from auth import verify_claims
from botocore.exceptions import ClientError
from catalogue import InvalidArguments, find_operation
from invoke import MAX_RESULT_CHARS, run_operation, truncate_result

from testing.mcp_result_fixtures import READ_SCOPE, WRITE_SCOPE, text_block

CALLER_SUB = '11111111-2222-3333-4444-555555555555'


def _run(name: str, arguments: dict, caller, *, tool_name: str | None = None) -> dict:
    return run_operation(tool_name or name, find_operation(name), arguments, caller)


def _request_line(api) -> tuple[str, str, str]:
    """``(httpMethod, path, resource)`` of the event the API received."""
    event = api.event
    return event['httpMethod'], event['path'], event['resource']


def _failure(result: dict) -> tuple[bool, dict]:
    """``(isError, structuredContent)`` of a tool result."""
    return result['isError'], result['structuredContent']


def _answer_raw(api, status: int, body: str) -> None:
    """A proxy response whose body is not JSON."""
    payload = json.dumps({'statusCode': status, 'body': body}).encode('utf-8')
    api.client.invoke.return_value = {'StatusCode': 200, 'Payload': io.BytesIO(payload)}


class TestEventSent:
    def test_carries_the_callers_identity_and_groups_as_authorizer_claims(self, api, caller):
        _run('list_keyword_groups', {}, caller)

        assert api.event['requestContext'] == {'authorizer': {'claims': {
            'sub': CALLER_SUB, 'cognito:username': 'alice', 'cognito:groups': 'Users',
        }}}

    def test_omits_the_groups_claim_the_token_did_not_carry(self, api, claims):
        ungrouped = verify_claims({key: value for key, value in claims().items() if key != 'cognito:groups'})

        _run('list_keyword_groups', {}, ungrouped)

        assert 'cognito:groups' not in api.event['requestContext']['authorizer']['claims']

    def test_sends_a_get_with_method_path_resource_and_no_body(self, api, caller):
        _run('list_keyword_groups', {}, caller)

        assert _request_line(api) == ('GET', '/api/keyword-groups', '/api/keyword-groups')
        assert (api.event['pathParameters'], api.event['queryStringParameters'], api.event['body']) == (None, None, None)

    def test_sends_query_parameters_as_strings(self, api, caller):
        _run('list_keywords', {'group_id': 'grp_1', 'limit': 50}, caller)

        assert api.event['queryStringParameters'] == {'group_id': 'grp_1', 'limit': '50'}

    def test_sends_a_write_as_a_json_body_with_path_parameters_and_a_json_content_type(self, api, caller):
        _run('manage_keywords', {'action': 'set_status', 'keyword_id': 'kw_1', 'keyword': 'parador', 'status': 'paused'}, caller)

        assert _request_line(api) == ('PUT', '/api/keywords/kw_1', '/api/keywords/{id}')
        assert (api.event['pathParameters'], json.loads(api.event['body'])) == ({'id': 'kw_1'}, {'keyword': 'parador', 'status': 'paused'})
        assert api.event['headers'] == {'Content-Type': 'application/json'}

    def test_invokes_the_function_mapped_to_the_routes_router(self, api, caller):
        _run('get_brand_config', {}, caller)

        assert api.function_name == 'CitationAnalysis-BrandConfig'


class TestResults:
    def test_returns_the_handler_body_as_structured_content_with_a_one_line_summary(self, api, caller):
        body = {'groups': [{'id': 'grp_1'}, {'id': 'grp_2'}], 'count': 2}
        api.answer(200, body)

        result = _run('list_keyword_groups', {}, caller)

        assert set(result) == {'content', 'structuredContent'}
        assert result['structuredContent'] == body
        assert text_block(result) == ('list_keyword_groups: 2 groups', body)

    def test_the_text_block_repeats_the_json_for_hosts_that_ignore_structured_content(self, api, caller):
        api.answer(200, {'groups': [{'id': 'grp_1', 'name': 'Hotel Coruña'}], 'count': 1})

        text = _run('list_keyword_groups', {}, caller)['content'][0]['text']

        assert text == 'list_keyword_groups: 1 groups\n{"groups": [{"id": "grp_1", "name": "Hotel Coru\\u00f1a"}], "count": 1}'

    def test_summarises_a_body_without_lists_by_its_field_count(self, api, caller):
        api.answer(200, {'industry': 'hotels', 'max_brands': 10})

        assert text_block(_run('get_brand_config', {}, caller))[0] == 'get_brand_config: 2 field(s)'

    def test_wraps_a_bare_array_body_in_items(self, api, caller):
        api.answer(200, [{'id': 'p1', 'name': 'Family'}])

        assert _run('list_personas', {}, caller)['structuredContent'] == {'items': [{'id': 'p1', 'name': 'Family'}]}

    def test_applies_the_operations_shape_before_returning(self, api, caller):
        api.answer(200, {'providers': [{'id': 'brave', 'name': 'Brave', 'enabled': False, 'configured': False,
                                        'model': 'web-search', 'masked_key': None, 'type': 'search'}]})

        assert _run('list_providers', {}, caller)['structuredContent'] == {'providers': [
            {'id': 'brave', 'name': 'Brave', 'enabled': False, 'configured': False, 'model': 'web-search'},
        ]}

    def test_a_400_from_the_handler_becomes_a_tool_error_with_its_details_and_field(self, api, caller):
        api.answer(400, {'error': 'Provider check failed', 'details': 'credit balance is too low', 'field': 'enabled'})

        result = _run('list_providers', {}, caller)

        assert result['isError'] is True
        assert result['structuredContent'] == {
            'status': 400, 'error': 'Provider check failed', 'details': 'credit balance is too low', 'field': 'enabled',
        }
        assert text_block(result) == (
            'list_providers failed (400): Provider check failed - credit balance is too low', result['structuredContent']
        )

    def test_a_404_names_the_handlers_error_without_inventing_details(self, api, caller):
        api.answer(404, {'error': 'Keyword group not found'})

        result = _run('manage_keywords', {'action': 'update_group', 'group_id': 'grp_9', 'name': 'x'}, caller)

        assert _failure(result) == (True, {'status': 404, 'error': 'Keyword group not found'})

    def test_a_non_json_error_body_is_kept_as_the_error_text(self, api, caller):
        _answer_raw(api, 502, 'Bad Gateway')

        assert _failure(_run('get_brand_config', {}, caller)) == (True, {'status': 502, 'error': 'Bad Gateway'})

    def test_an_empty_2xx_body_is_an_empty_object(self, api, caller):
        _answer_raw(api, 204, '')

        assert _run('get_brand_config', {}, caller)['structuredContent'] == {}

    def test_a_failed_function_invocation_becomes_a_tool_error(self, api, caller):
        api.client.invoke.return_value['FunctionError'] = 'Unhandled'

        assert _failure(_run('list_recommendations', {}, caller)) == (True, {'status': 502, 'error': 'The API handler failed'})

    def test_an_invoke_the_sdk_refuses_becomes_a_tool_error_naming_the_upstream(self, api, caller):
        api.client.invoke.side_effect = ClientError({'Error': {'Code': 'TooManyRequestsException'}}, 'Invoke')

        assert _failure(_run('get_dashboard_stats', {}, caller)) == (True, {'error': 'upstream_unavailable'})

    def test_a_50_kb_result_is_cut_to_its_first_page_and_marked_truncated(self, api, caller):
        keywords = [{'id': f'kw_{index}', 'keyword': 'x' * 40} for index in range(2000)]
        api.answer(200, {'keywords': keywords, 'count': 2000, 'next_token': None})

        data = _run('list_keywords', {}, caller)['structuredContent']

        assert data['truncated'] is True
        assert data['keywords'] == keywords[:len(data['keywords'])]
        assert 0 < len(data['keywords']) < 2000
        assert len(json.dumps(data)) <= MAX_RESULT_CHARS

    def test_a_truncated_result_says_so_in_its_summary(self, api, caller):
        api.answer(200, {'items': [{'id': index, 'text': 'y' * 100} for index in range(1000)]})

        assert text_block(_run('list_recommendations', {}, caller))[0].endswith('(truncated)')


class TestTruncateResult:
    def test_returns_a_small_result_untouched(self):
        data = {'groups': [{'id': 'grp_1'}], 'count': 1}

        assert truncate_result(data) is data

    def test_trims_the_longest_list_first(self):
        data = {'big': [{'v': 'a' * 200} for _ in range(400)], 'small': list(range(100))}

        trimmed = truncate_result(data)

        assert (trimmed['small'], trimmed['truncated']) == (list(range(100)), True)
        assert 0 < len(trimmed['big']) < 400

    def test_falls_back_to_a_text_preview_when_nothing_can_be_trimmed(self):
        trimmed = truncate_result({'blob': 'z' * (MAX_RESULT_CHARS + 10)})

        assert (set(trimmed), trimmed['truncated']) == ({'preview', 'truncated'}, True)
        assert len(json.dumps(trimmed)) <= MAX_RESULT_CHARS


class TestAudit:
    def test_logs_one_line_naming_caller_tool_operation_outcome_and_duration(self, api, caller, audit):
        api.answer(200, {'providers': [{'id': 'openai'}]})

        _run('list_providers', {}, caller, tool_name='call_tool')

        lines = audit()
        assert len(lines) == 1
        assert {key: lines[0][key] for key in ('caller_sub', 'tool', 'operation', 'outcome')} == {
            'caller_sub': CALLER_SUB, 'tool': 'call_tool', 'operation': 'list_providers', 'outcome': 'http_200',
        }
        assert isinstance(lines[0]['ms'], int)

    @pytest.mark.parametrize(('arguments', 'scope'), [
        ({}, f'openid {READ_SCOPE} {WRITE_SCOPE}'),
        ({'action': 'add', 'keyword': 'parador'}, f'openid {READ_SCOPE}'),
    ], ids=['admin_denied', 'scope_denied'])
    def test_logs_a_refusal_as_denied(self, audit, claims, arguments, scope):
        tool = dataclasses.replace(find_operation('manage_keywords'), admin=True)

        run_operation('manage_keywords', tool, arguments, verify_claims(claims(scope=scope)))

        assert [line['outcome'] for line in audit()] == ['denied']

    def test_logs_rejected_arguments_before_raising(self, caller, audit):
        with pytest.raises(InvalidArguments, match='Provide one of'):
            _run('get_visibility', {}, caller)

        assert [line['outcome'] for line in audit()] == ['invalid_arguments']

    def test_never_logs_the_request_body_or_the_callers_name(self, api, caller, audit, caplog):
        api.answer(201, {'id': 'kw_9'})

        _run('manage_keywords', {'action': 'add', 'keyword': 'secret launch keyword'}, caller)

        assert audit() != []
        assert 'secret launch keyword' not in caplog.text
        assert 'alice' not in caplog.text


class TestRefusalAndAuditRecords:
    def test_a_denied_call_logs_the_refusal_reason(self, audit, claims):
        _run('manage_keywords', {'action': 'add', 'keyword': 'parador'}, verify_claims(claims(scope=f'openid {READ_SCOPE}')))

        assert audit()[-1]['reason'] == f'This tool needs the {WRITE_SCOPE} scope'

    def test_an_allowed_call_logs_no_reason(self, api, caller, audit):
        _run('list_keyword_groups', {}, caller)

        assert 'reason' not in audit()[-1]

    def test_a_write_call_is_recorded_in_the_state_table(self, api, caller, monkeypatch):
        recorded = MagicMock()
        monkeypatch.setattr(state, 'record_audit', recorded)
        api.answer(201, {'id': 'kw_9'})

        _run('manage_keywords', {'action': 'add', 'keyword': 'parador'}, caller)

        recorded.assert_called_once_with(CALLER_SUB, 'manage_keywords', 'manage_keywords', 'http_201', None)

    def test_a_read_call_is_not_recorded_in_the_state_table(self, api, caller, monkeypatch):
        recorded = MagicMock()
        monkeypatch.setattr(state, 'record_audit', recorded)

        _run('list_keyword_groups', {}, caller)

        recorded.assert_not_called()


class TestSelectedResults:
    def test_returns_the_custom_report_picked_by_id(self, api, caller):
        api.answer(200, {'reports': [{'id': 'rpt_1', 'title': 'Aurora Miles monthly'}]})

        result = _run('get_custom_report', {'report_id': 'rpt_1'}, caller)

        assert result['structuredContent'] == {'report': {'id': 'rpt_1', 'title': 'Aurora Miles monthly'}}

    def test_an_unknown_custom_report_is_a_404_tool_error(self, api, caller):
        api.answer(200, {'reports': []})

        assert _failure(_run('get_custom_report', {'report_id': 'rpt_9'}, caller)) == (
            True, {'status': 404, 'error': 'No custom report with id rpt_9'},
        )
