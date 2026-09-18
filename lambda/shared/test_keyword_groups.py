"""
Tests for shared.keyword_groups: id-list and scope validation, keyword-item
serialization and run-time scope resolution against the Keywords table.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from shared import keyword_groups


def _keyword(item_id: str, text: str, *, groups: set[str] | None = None, status: str = 'active') -> dict:
    item = {'id': item_id, 'keyword': text, 'status': status}
    if groups:
        item['group_ids'] = set(groups)
    return item


def _table_with_active(items: list[dict], *, pages: int = 1) -> MagicMock:
    """Fake Keywords table whose StatusIndex query returns `items` across `pages` pages."""
    table = MagicMock()
    chunk = max(1, -(-len(items) // pages))
    responses = []
    for index in range(pages):
        page = items[index * chunk:(index + 1) * chunk]
        response = {'Items': page}
        if index < pages - 1:
            response['LastEvaluatedKey'] = {'id': f'page-{index}'}
        responses.append(response)
    table.query.side_effect = responses
    return table


class TestValidateIdList:
    def test_returns_empty_list_when_value_is_missing(self) -> None:
        assert keyword_groups.validate_id_list(None, field='group_ids', limit=10) == ([], None)

    def test_trims_and_deduplicates_ids_preserving_first_occurrence_order(self) -> None:
        ids, error = keyword_groups.validate_id_list([' b ', 'a', 'b'], field='group_ids', limit=10)

        assert error is None
        assert ids == ['b', 'a']

    def test_rejects_non_list_values(self) -> None:
        ids, error = keyword_groups.validate_id_list('a,b', field='group_ids', limit=10)

        assert ids is None
        assert error == 'group_ids must be an array of strings'

    def test_rejects_non_string_entries(self) -> None:
        _, error = keyword_groups.validate_id_list(['a', 3], field='add', limit=10)

        assert error == 'add must be an array of strings'

    def test_rejects_blank_entries(self) -> None:
        _, error = keyword_groups.validate_id_list(['a', '  '], field='add', limit=10)

        assert error == 'add entries must be non-empty ids of at most 64 characters'

    def test_rejects_lists_over_the_limit(self) -> None:
        _, error = keyword_groups.validate_id_list(['a', 'b', 'c'], field='group_ids', limit=2)

        assert error == 'group_ids accepts at most 2 entries'


class TestValidateScope:
    def test_accepts_the_all_mode_without_ids(self) -> None:
        assert keyword_groups.validate_scope({'mode': 'all', 'group_ids': ['ignored']}) == ({'mode': 'all'}, None)

    def test_accepts_groups_mode_with_ids(self) -> None:
        scope, error = keyword_groups.validate_scope({'mode': 'groups', 'group_ids': ['g1', 'g2', 'g1']})

        assert error is None
        assert scope == {'mode': 'groups', 'group_ids': ['g1', 'g2']}

    def test_accepts_keywords_mode_with_ids(self) -> None:
        scope, error = keyword_groups.validate_scope({'mode': 'keywords', 'keyword_ids': ['k1']})

        assert error is None
        assert scope == {'mode': 'keywords', 'keyword_ids': ['k1']}

    def test_rejects_unknown_modes(self) -> None:
        scope, error = keyword_groups.validate_scope({'mode': 'everything'})

        assert scope is None
        assert error == 'scope.mode must be one of all, groups, keywords'

    def test_rejects_groups_mode_without_ids(self) -> None:
        _, error = keyword_groups.validate_scope({'mode': 'groups', 'group_ids': []})

        assert error == 'scope.group_ids must contain at least one id'

    def test_rejects_non_object_scopes(self) -> None:
        _, error = keyword_groups.validate_scope('all')

        assert error == 'scope must be an object'


class TestSerializeKeywordItem:
    def test_converts_the_group_id_set_to_a_sorted_list(self) -> None:
        item = _keyword('k1', 'hotels', groups={'zeta', 'alpha'})

        assert keyword_groups.serialize_keyword_item(item)['group_ids'] == ['alpha', 'zeta']

    def test_leaves_items_without_memberships_untouched(self) -> None:
        item = _keyword('k1', 'hotels')

        assert keyword_groups.serialize_keyword_item(item) == item

    def test_does_not_mutate_the_input_item(self) -> None:
        item = _keyword('k1', 'hotels', groups={'g1'})

        keyword_groups.serialize_keyword_item(item)

        assert isinstance(item['group_ids'], set)


class TestResolveScope:
    def test_all_mode_returns_every_active_keyword_sorted_by_text(self) -> None:
        table = _table_with_active([_keyword('k2', 'Zurich hotels'), _keyword('k1', 'amsterdam hotels')])

        resolved = keyword_groups.resolve_scope({'mode': 'all'}, table)

        assert [item['keyword'] for item in resolved] == ['amsterdam hotels', 'Zurich hotels']

    def test_follows_status_index_pagination(self) -> None:
        items = [_keyword(f'k{i}', f'keyword {i:02d}') for i in range(5)]
        table = _table_with_active(items, pages=3)

        resolved = keyword_groups.resolve_scope({'mode': 'all'}, table)

        assert len(resolved) == 5
        assert table.query.call_count == 3
        assert 'ExclusiveStartKey' in table.query.call_args_list[1].kwargs

    def test_groups_mode_keeps_only_members_of_the_requested_groups(self) -> None:
        table = _table_with_active([
            _keyword('k1', 'hotel a', groups={'coruna'}),
            _keyword('k2', 'hotel b', groups={'marino'}),
            _keyword('k3', 'hotel c'),
        ])

        resolved = keyword_groups.resolve_scope({'mode': 'groups', 'group_ids': ['coruna']}, table)

        assert [item['id'] for item in resolved] == ['k1']

    def test_groups_mode_returns_a_keyword_shared_by_two_requested_groups_once(self) -> None:
        table = _table_with_active([_keyword('k1', 'shared keyword', groups={'coruna', 'marino'})])

        resolved = keyword_groups.resolve_scope({'mode': 'groups', 'group_ids': ['coruna', 'marino']}, table)

        assert [item['id'] for item in resolved] == ['k1']

    def test_keywords_mode_keeps_only_the_requested_ids(self) -> None:
        table = _table_with_active([_keyword('k1', 'hotel a'), _keyword('k2', 'hotel b')])

        resolved = keyword_groups.resolve_scope({'mode': 'keywords', 'keyword_ids': ['k2', 'missing']}, table)

        assert [item['id'] for item in resolved] == ['k2']

    def test_never_returns_inactive_keywords_because_only_the_active_index_is_read(self) -> None:
        table = _table_with_active([_keyword('k1', 'hotel a', groups={'g'})])

        keyword_groups.resolve_scope({'mode': 'groups', 'group_ids': ['g']}, table)

        query_kwargs = table.query.call_args.kwargs
        assert query_kwargs['IndexName'] == 'StatusIndex'

    def test_skips_items_without_keyword_text(self) -> None:
        table = _table_with_active([{'id': 'k1', 'status': 'active'}, _keyword('k2', 'valid')])

        resolved = keyword_groups.resolve_scope({'mode': 'all'}, table)

        assert [item['id'] for item in resolved] == ['k2']


class TestDescribeScope:
    @pytest.mark.parametrize(
        ('scope', 'expected'),
        [
            ({'mode': 'all'}, 'all active keywords'),
            ({'mode': 'groups', 'group_ids': ['a', 'b']}, '2 group(s)'),
            ({'mode': 'keywords', 'keyword_ids': ['a']}, '1 selected keyword(s)'),
        ],
    )
    def test_labels_each_mode(self, scope, expected) -> None:
        assert keyword_groups.describe_scope(scope) == expected


class TestGroupNameKey:
    def test_normalizes_case_and_inner_whitespace(self) -> None:
        assert keyword_groups.normalize_group_name('  Hotel   Coruña ') == 'hotel coruña'

    def test_build_group_item_carries_the_name_key_and_identical_timestamps(self) -> None:
        item = keyword_groups.build_group_item('g1', 'Hotel Coruña', 'Galicia', timestamp='2026-09-18T00:00:00Z')

        assert item == {
            'id': 'g1',
            'name': 'Hotel Coruña',
            'name_key': 'hotel coruña',
            'description': 'Galicia',
            'created_at': '2026-09-18T00:00:00Z',
            'updated_at': '2026-09-18T00:00:00Z',
        }
