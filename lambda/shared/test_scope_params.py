"""
Tests for shared.scope_params — the report scope every KPI endpoint accepts.

- exactly one of keyword / group_id / keyword_ids; none means "no scope"
- group and id scopes resolve to active keyword texts through the shared resolver
- keyword_ids is capped at 100 and parsed as a comma-separated list
"""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from shared.scope_params import MAX_KEYWORD_IDS, ReportScope, all_active_scope, parse_scope_params


def _keywords_table(items: list[dict]) -> MagicMock:
    table = MagicMock()
    table.query.return_value = {'Items': items}
    return table


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

        scope, error = parse_scope_params({'keyword': ' hotel coruna spa '}, table)

        assert error is None
        assert scope == ReportScope(kind='keyword', keywords=('hotel coruna spa',), scope={'mode': 'keyword', 'keyword': 'hotel coruna spa'}, label='hotel coruna spa')
        assert scope.is_single_keyword is True
        table.query.assert_not_called()


class TestGroupScope:
    def test_resolves_the_active_members_of_the_group_sorted_by_text(self):
        scope, error = parse_scope_params({'group_id': 'coruna'}, _keywords_table(ACTIVE))

        assert error is None
        assert scope.kind == 'group'
        assert scope.keywords == ('best hotels galicia', 'hotel coruna spa')
        assert scope.scope == {'mode': 'groups', 'group_ids': ['coruna']}
        assert scope.is_single_keyword is False

    def test_describes_itself_for_the_response(self):
        scope, _ = parse_scope_params({'group_id': 'coruna'}, _keywords_table(ACTIVE))

        assert scope.describe() == {'mode': 'groups', 'group_ids': ['coruna'], 'kind': 'group', 'label': '1 group(s)', 'keyword_count': 2}

    def test_resolves_to_no_keywords_for_an_unknown_group(self):
        scope, error = parse_scope_params({'group_id': 'nope'}, _keywords_table(ACTIVE))

        assert error is None
        assert scope.keywords == ()


class TestKeywordIdsScope:
    def test_parses_a_comma_separated_list_and_resolves_it(self):
        scope, error = parse_scope_params({'keyword_ids': 'k2, k3 ,,'}, _keywords_table(ACTIVE))

        assert error is None
        assert scope.kind == 'keywords'
        assert scope.keywords == ('Beach hotel marino', 'best hotels galicia')
        assert scope.scope == {'mode': 'keywords', 'keyword_ids': ['k2', 'k3']}

    def test_rejects_more_than_the_cap(self):
        ids = ','.join(f'k{index}' for index in range(MAX_KEYWORD_IDS + 1))

        scope, error = parse_scope_params({'keyword_ids': ids}, _keywords_table(ACTIVE))

        assert scope is None
        assert error == 'keyword_ids accepts at most 100 ids'

    def test_rejects_an_over_long_id(self):
        scope, error = parse_scope_params({'keyword_ids': 'x' * 65}, _keywords_table(ACTIVE))

        assert scope is None
        assert 'keyword_ids' in error


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


class TestScopeAll:
    def test_scope_all_covers_every_active_keyword_as_a_group(self):
        scope, error = parse_scope_params({'scope': 'all'}, _keywords_table(ACTIVE))

        assert error is None
        assert scope.kind == 'all'
        assert len(scope.keywords) == 3
        assert scope.is_single_keyword is False

    def test_rejects_any_other_scope_value(self):
        scope, error = parse_scope_params({'scope': 'everything'}, _keywords_table(ACTIVE))

        assert scope is None
        assert "scope must be 'all'" in error

    def test_scope_all_conflicts_with_a_keyword(self):
        scope, error = parse_scope_params({'scope': 'all', 'keyword': 'x'}, _keywords_table(ACTIVE))

        assert scope is None
        assert error == 'Use only one of keyword, group_id, keyword_ids, scope'
