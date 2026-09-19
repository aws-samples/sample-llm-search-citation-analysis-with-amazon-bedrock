"""
Tests for shared.scope_params — the report scope every KPI endpoint accepts.

- exactly one of keyword / group_id / keyword_ids; none means "no scope"
- group and id scopes resolve to active keyword texts through the shared resolver
- keyword_ids is capped at 100 and parsed as a comma-separated list
- the handler plumbing around it: the shared ``@validate`` rules, the
  Keywords table name, the scope-or-400 helper, the per-keyword partition
  read and the sibling-function loader the report aggregators use
"""

from __future__ import annotations

import json
import sys
from dataclasses import FrozenInstanceError, fields
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from shared.scope_params import (
    MAX_KEYWORD_IDS,
    SCOPE_PARAMS,
    SCOPE_QUERY_PARAMS,
    ReportScope,
    all_active_scope,
    keywords_table_name,
    load_sibling_function,
    parse_scope_params,
    query_keyword_rows,
    scope_from_request,
)


def _keywords_table(items: list[dict]) -> MagicMock:
    table = MagicMock()
    table.query.return_value = {'Items': items}
    return table


def _parsed(params: dict | None, table: MagicMock) -> ReportScope:
    """The scope ``parse_scope_params`` resolves for ``params``, asserting they were not rejected."""
    scope, error = parse_scope_params(params, table)
    assert error is None
    assert scope is not None
    return scope


ACTIVE = [
    {'id': 'k1', 'keyword': 'hotel coruna spa', 'status': 'active', 'group_ids': {'coruna'}},
    {'id': 'k2', 'keyword': 'Beach hotel marino', 'status': 'active', 'group_ids': {'marino'}},
    {'id': 'k3', 'keyword': 'best hotels galicia', 'status': 'active', 'group_ids': {'coruna', 'marino'}},
]


class TestNoScope:
    def test_returns_nothing_when_no_scope_parameter_is_present(self):
        assert parse_scope_params({'days': '30'}, _keywords_table(ACTIVE)) == (None, None)

    def test_treats_blank_parameters_as_absent(self):
        assert parse_scope_params({'keyword': '  ', 'group_id': ''}, _keywords_table(ACTIVE)) == (None, None)

    def test_accepts_a_missing_parameter_dict(self):
        assert parse_scope_params(None, _keywords_table(ACTIVE)) == (None, None)


class TestSingleKeyword:
    def test_wraps_the_keyword_without_touching_the_table(self):
        table = _keywords_table(ACTIVE)

        scope = _parsed({'keyword': ' hotel coruna spa '}, table)

        assert scope == ReportScope(kind='keyword', keywords=('hotel coruna spa',), scope={'mode': 'keyword', 'keyword': 'hotel coruna spa'}, label='hotel coruna spa')
        assert scope.is_single_keyword is True
        table.query.assert_not_called()


class TestGroupScope:
    def test_resolves_the_active_members_of_the_group_sorted_by_text(self):
        scope = _parsed({'group_id': 'coruna'}, _keywords_table(ACTIVE))

        assert scope.kind == 'group'
        assert scope.keywords == ('best hotels galicia', 'hotel coruna spa')
        assert scope.scope == {'mode': 'groups', 'group_ids': ['coruna']}
        assert scope.is_single_keyword is False

    def test_describes_itself_for_the_response(self):
        scope = _parsed({'group_id': 'coruna'}, _keywords_table(ACTIVE))

        assert scope.describe() == {'mode': 'groups', 'group_ids': ['coruna'], 'kind': 'group', 'label': '1 group(s)', 'keyword_count': 2}

    def test_resolves_to_no_keywords_for_an_unknown_group(self):
        scope = _parsed({'group_id': 'nope'}, _keywords_table(ACTIVE))

        assert scope.keywords == ()


class TestKeywordIdsScope:
    def test_parses_a_comma_separated_list_and_resolves_it(self):
        scope = _parsed({'keyword_ids': 'k2, k3 ,,'}, _keywords_table(ACTIVE))

        assert scope.kind == 'keywords'
        assert scope.keywords == ('Beach hotel marino', 'best hotels galicia')
        assert scope.scope == {'mode': 'keywords', 'keyword_ids': ['k2', 'k3']}

    def test_rejects_more_than_the_cap(self):
        ids = ','.join(f'k{index}' for index in range(MAX_KEYWORD_IDS + 1))

        scope, error = parse_scope_params({'keyword_ids': ids}, _keywords_table(ACTIVE))

        assert scope is None
        assert error == 'keyword_ids accepts at most 100 ids'

    def test_accepts_exactly_the_cap(self):
        ids = ','.join(f'k{index}' for index in range(MAX_KEYWORD_IDS))

        scope = _parsed({'keyword_ids': ids}, _keywords_table(ACTIVE))

        assert len(scope.scope['keyword_ids']) == MAX_KEYWORD_IDS

    def test_rejects_an_over_long_id(self):
        scope, error = parse_scope_params({'keyword_ids': 'x' * 65}, _keywords_table(ACTIVE))

        assert scope is None
        assert error == 'keyword_ids entries must be non-empty ids of at most 64 characters'


class TestConflicts:
    def test_rejects_two_scope_parameters_at_once(self):
        scope, error = parse_scope_params({'keyword': 'a', 'group_id': 'g'}, _keywords_table(ACTIVE))

        assert scope is None
        assert error == 'Use only one of keyword, group_id, keyword_ids, scope'


class TestAllActiveScope:
    def test_covers_every_active_keyword(self):
        scope = all_active_scope(_keywords_table(ACTIVE))

        assert scope.kind == 'all'
        assert scope.keywords == ('Beach hotel marino', 'best hotels galicia', 'hotel coruna spa')
        assert scope.describe()['label'] == 'all active keywords'

    def test_describes_itself_with_the_canonical_all_descriptor(self):
        scope = all_active_scope(_keywords_table(ACTIVE))

        assert scope.describe() == {'mode': 'all', 'kind': 'all', 'label': 'all active keywords', 'keyword_count': 3}


class TestReportScope:
    def test_every_field_is_immutable_once_resolved(self):
        scope = ReportScope(kind='keyword', keywords=('a',), scope={'mode': 'keyword', 'keyword': 'a'}, label='a')

        for field in fields(scope):
            with pytest.raises(FrozenInstanceError):
                setattr(scope, field.name, 'changed')

    def test_requires_every_field_so_no_caller_can_widen_a_scope_by_omission(self):
        partial: dict[str, Any] = {'kind': 'all', 'keywords': ()}

        with pytest.raises(TypeError, match=r"missing 2 required (positional |keyword-only )?arguments: 'scope' and 'label'"):
            ReportScope(**partial)


class TestScopeAll:
    def test_scope_all_covers_every_active_keyword_as_a_group(self):
        scope = _parsed({'scope': 'all'}, _keywords_table(ACTIVE))

        assert scope.kind == 'all'
        assert len(scope.keywords) == 3
        assert scope.is_single_keyword is False

    def test_rejects_any_other_scope_value(self):
        scope, error = parse_scope_params({'scope': 'everything'}, _keywords_table(ACTIVE))

        assert scope is None
        assert error == "scope must be 'all' (use group_id or keyword_ids for a narrower scope)"

    def test_scope_all_conflicts_with_a_keyword(self):
        scope, error = parse_scope_params({'scope': 'all', 'keyword': 'x'}, _keywords_table(ACTIVE))

        assert scope is None
        assert error == 'Use only one of keyword, group_id, keyword_ids, scope'


class TestScopeQueryParams:
    def test_validation_rules_are_the_shared_report_scope_contract(self):
        assert SCOPE_QUERY_PARAMS == {
            'keyword': {'type': str, 'max_length': 500},
            'group_id': {'type': str, 'max_length': 64},
            'keyword_ids': {'type': str, 'max_length': 8000},
            'scope': {'type': str, 'choices': ['all']},
        }

    def test_parameter_names_follow_the_validation_rules(self):
        assert SCOPE_PARAMS == tuple(SCOPE_QUERY_PARAMS)


class TestKeywordsTableName:
    def test_prefers_the_canonical_env_var(self, monkeypatch):
        monkeypatch.setenv('DYNAMODB_TABLE_KEYWORDS', 'canonical-keywords')
        monkeypatch.setenv('KEYWORDS_TABLE', 'legacy-keywords')

        assert keywords_table_name() == 'canonical-keywords'

    def test_falls_back_to_the_legacy_env_var_when_the_canonical_one_is_blank(self, monkeypatch):
        monkeypatch.setenv('DYNAMODB_TABLE_KEYWORDS', '')
        monkeypatch.setenv('KEYWORDS_TABLE', 'legacy-keywords')

        assert keywords_table_name() == 'legacy-keywords'

    def test_defaults_to_the_stack_table_name_when_nothing_is_set(self, monkeypatch):
        monkeypatch.delenv('DYNAMODB_TABLE_KEYWORDS', raising=False)
        monkeypatch.delenv('KEYWORDS_TABLE', raising=False)

        assert keywords_table_name() == 'CitationAnalysis-Keywords'


EVENT = {'httpMethod': 'GET', 'path': '/api/x', 'headers': {}}


def _rejection(response: dict | None) -> tuple[int, dict]:
    assert response is not None
    return response['statusCode'], json.loads(response['body'])


class TestScopeFromRequest:
    def test_returns_the_resolved_scope_without_a_response(self):
        scope, rejected = scope_from_request(EVENT, {'group_id': 'coruna'}, _keywords_table(ACTIVE))

        assert rejected is None
        assert scope is not None
        assert (scope.kind, scope.keywords) == ('group', ('best hotels galicia', 'hotel coruna spa'))

    def test_answers_400_on_the_scope_field_for_contradictory_parameters(self):
        scope, rejected = scope_from_request(EVENT, {'keyword': 'a', 'scope': 'all'}, _keywords_table(ACTIVE))

        assert scope is None
        assert _rejection(rejected) == (400, {'error': 'Use only one of keyword, group_id, keyword_ids, scope', 'field': 'scope'})

    def test_leaves_the_default_to_the_caller_when_no_scope_is_given(self):
        assert scope_from_request(EVENT, {'keyword': None, 'group_id': None}, _keywords_table(ACTIVE)) == (None, None)

    def test_answers_400_on_the_keyword_field_when_a_required_scope_is_missing(self):
        scope, rejected = scope_from_request(EVENT, {'keyword': None}, _keywords_table(ACTIVE), required=True)

        assert scope is None
        assert _rejection(rejected) == (400, {'error': 'Provide keyword, group_id or keyword_ids', 'field': 'keyword'})


class TestQueryKeywordRows:
    def test_concatenates_every_page_of_the_partition(self):
        table = MagicMock()
        table.query.side_effect = [
            {'Items': [{'provider': 'openai'}], 'LastEvaluatedKey': {'keyword': 'k', 'timestamp_provider': 'x'}},
            {'Items': [{'provider': 'gemini'}]},
        ]

        rows = query_keyword_rows(table, 'k', '#ts, provider')

        assert rows == [{'provider': 'openai'}, {'provider': 'gemini'}]
        assert table.query.call_args_list[1].kwargs['ExclusiveStartKey'] == {'keyword': 'k', 'timestamp_provider': 'x'}

    def test_reads_only_the_projection_with_the_timestamp_alias(self):
        table = MagicMock()
        table.query.return_value = {'Items': []}

        query_keyword_rows(table, 'hotel coruna spa', '#ts, provider, brands')

        kwargs = table.query.call_args.kwargs
        assert kwargs['ProjectionExpression'] == '#ts, provider, brands'
        assert kwargs['ExpressionAttributeNames'] == {'#ts': 'timestamp'}
        condition = kwargs['KeyConditionExpression'].get_expression()
        assert (condition['values'][0].name, condition['operator'], condition['values'][1]) == ('keyword', '=', 'hotel coruna spa')

    def test_stops_after_a_single_page_when_nothing_is_left(self):
        table = MagicMock()
        table.query.return_value = {'Items': []}

        assert query_keyword_rows(table, 'k', '#ts, provider') == []
        assert table.query.call_count == 1
        assert 'ExclusiveStartKey' not in table.query.call_args.kwargs


@pytest.fixture
def sibling_dir(tmp_path):
    (tmp_path / 'kpi-helper.py').write_text('def compute():\n    return 42\n')
    yield tmp_path
    sys.modules.pop('kpi_helper_for_test', None)


class TestLoadSiblingFunction:
    def test_returns_the_named_function_of_a_hyphenated_sibling(self, sibling_dir):
        compute = load_sibling_function(str(sibling_dir / 'report.py'), 'kpi-helper.py', 'compute', '_for_test')

        assert compute() == 42

    def test_registers_the_module_under_the_aliased_name(self, sibling_dir):
        compute = load_sibling_function(str(sibling_dir / 'report.py'), 'kpi-helper.py', 'compute', '_for_test')

        assert sys.modules['kpi_helper_for_test'].compute is compute

    def test_raises_import_error_when_the_file_cannot_be_loaded(self, sibling_dir):
        with patch('importlib.util.spec_from_file_location', return_value=None), pytest.raises(ImportError) as raised:
            load_sibling_function(str(sibling_dir / 'report.py'), 'kpi-helper.py', 'compute', '_for_test')

        assert str(raised.value) == "Could not load sibling module 'kpi-helper.py'"

    def test_raises_attribute_error_when_the_sibling_lacks_the_function(self, sibling_dir):
        with pytest.raises(AttributeError) as raised:
            load_sibling_function(str(sibling_dir / 'report.py'), 'kpi-helper.py', 'missing', '_for_test')

        assert str(raised.value) == "kpi-helper.py has no attribute 'missing'"
