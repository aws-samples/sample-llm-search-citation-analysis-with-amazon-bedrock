"""
Tests for shared.keyword_groups: id-list and scope validation, keyword-item
serialization and run-time scope resolution against the Keywords table.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from shared import keyword_groups
from testing.dynamodb_stubs import fake_dynamodb_resource


def _keyword(item_id: str, text: str, *, groups: set[str] | None = None, status: str = 'active') -> dict:
    item: dict[str, Any] = {'id': item_id, 'keyword': text, 'status': status}
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
        response: dict[str, Any] = {'Items': page}
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

    @pytest.mark.parametrize(('entry', 'expected'), [
        pytest.param('g' * 64, (['g' * 64], None), id='exactly-64-characters'),
        pytest.param('g' * 65, (None, 'add entries must be non-empty ids of at most 64 characters'), id='65-characters'),
    ])
    def test_accepts_ids_up_to_64_characters_and_rejects_longer_ones(self, entry: str, expected: tuple) -> None:
        assert keyword_groups.validate_id_list([entry], field='add', limit=10) == expected

    def test_rejects_lists_over_the_limit(self) -> None:
        _, error = keyword_groups.validate_id_list(['a', 'b', 'c'], field='group_ids', limit=2)

        assert error == 'group_ids accepts at most 2 entries'

    def test_accepts_more_than_fifty_ids_when_no_request_limit_applies(self) -> None:
        group_ids = [f'group-{index}' for index in range(51)]

        ids, error = keyword_groups.validate_id_list(group_ids, field='group_ids')

        assert error is None
        assert ids == group_ids


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

    def test_returns_the_market_and_concept_of_a_localized_keyword(self) -> None:
        item = {**_keyword('k2', 'hoteles'), 'market_id': 'es-es', 'concept_id': 'k1'}

        serialized = keyword_groups.serialize_keyword_item(item)

        assert (serialized['market_id'], serialized['concept_id']) == ('es-es', 'k1')


class TestAddKeywordGroups:
    def test_returns_membership_union_when_new_group_is_added(self) -> None:
        table = MagicMock()
        table.update_item.return_value = {'Attributes': {
            'id': 'legacy-id',
            'keyword': 'hotels',
            'group_ids': {'existing-group'},
        }}

        updated, added = keyword_groups.add_keyword_groups(
            table,
            'legacy-id',
            {'destination-group'},
        )

        assert updated == {
            'id': 'legacy-id',
            'keyword': 'hotels',
            'group_ids': {'existing-group', 'destination-group'},
        }
        assert added == {'destination-group'}
        table.update_item.assert_called_once_with(
            Key={'id': 'legacy-id'},
            UpdateExpression='ADD group_ids :gids',
            ConditionExpression='attribute_exists(#id)',
            ExpressionAttributeNames={'#id': 'id'},
            ExpressionAttributeValues={':gids': {'destination-group'}},
            ReturnValues='ALL_OLD',
        )


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
            ({'mode': 'all', 'market_ids': ['cl-es']}, 'all active keywords, market cl-es'),
            ({'mode': 'groups', 'group_ids': ['a'], 'market_ids': ['cl-es', 'global']}, '1 group(s), 2 markets'),
        ],
    )
    def test_labels_each_mode(self, scope, expected) -> None:
        assert keyword_groups.describe_scope(scope) == expected


def _market_keyword(item_id: str, text: str, market_id: str | None, *, groups: set[str] | None = None) -> dict:
    item = _keyword(item_id, text, groups=groups)
    if market_id is not None:
        item['market_id'] = market_id
    return item


class TestScopeMarkets:
    @pytest.mark.parametrize('mode', [
        {'mode': 'all'},
        {'mode': 'groups', 'group_ids': ['g']},
        {'mode': 'keywords', 'keyword_ids': ['k1']},
    ], ids=['all', 'groups', 'keywords'])
    def test_keeps_the_market_ids_of_every_mode(self, mode) -> None:
        scope, error = keyword_groups.validate_scope({**mode, 'market_ids': ['cl-es', 'global']})

        assert (error, scope) == (None, {**mode, 'market_ids': ['cl-es', 'global']})

    def test_omits_market_ids_when_absent(self) -> None:
        assert keyword_groups.validate_scope({'mode': 'all'}) == ({'mode': 'all'}, None)

    def test_deduplicates_market_ids_in_first_occurrence_order(self) -> None:
        scope, _ = keyword_groups.validate_scope({'mode': 'all', 'market_ids': ['global', 'cl-es', 'global']})

        assert scope == {'mode': 'all', 'market_ids': ['global', 'cl-es']}

    @pytest.mark.parametrize(('market_ids', 'error'), [
        pytest.param([], 'scope.market_ids must be a non-empty array of market ids', id='empty'),
        pytest.param('cl-es', 'scope.market_ids must be a non-empty array of market ids', id='string'),
        pytest.param(['CL-ES'], "scope.market_ids entries must be market ids or 'global'", id='upper-case'),
        pytest.param([3], "scope.market_ids entries must be market ids or 'global'", id='number'),
        pytest.param([f'm{index:02d}' for index in range(52)], 'scope.market_ids accepts at most 51 entries', id='too-many'),
    ])
    def test_rejects_malformed_market_ids(self, market_ids, error) -> None:
        assert keyword_groups.validate_scope({'mode': 'all', 'market_ids': market_ids}) == (None, error)

    @pytest.mark.parametrize(('scope', 'ids'), [
        pytest.param({'mode': 'all', 'market_ids': ['es-es', 'pt-pt']}, ['k2', 'k3'], id='listed-markets'),
        pytest.param({'mode': 'all', 'market_ids': ['global']}, ['k1', 'k4'], id='global-market'),
        pytest.param({'mode': 'groups', 'group_ids': ['g'], 'market_ids': ['es-es']}, ['k2'], id='group-and-market'),
        pytest.param({'mode': 'all'}, ['k1', 'k2', 'k3', 'k4'], id='every-market'),
    ])
    def test_resolves_only_keywords_of_the_scope_markets(self, scope, ids) -> None:
        table = _table_with_active([
            _market_keyword('k1', 'hotel a', None, groups={'g'}),
            _market_keyword('k2', 'hotel b', 'es-es', groups={'g'}),
            _market_keyword('k3', 'hotel c', 'pt-pt'),
            _market_keyword('k4', 'hotel d', None),
        ])

        assert [item['id'] for item in keyword_groups.resolve_scope(scope, table)] == ids


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


class TestOpenKeywordTables:
    """The table wiring ``manage-keywords`` and ``promote-keywords`` share, with the groups table optional."""

    @pytest.fixture
    def tables(self, monkeypatch: pytest.MonkeyPatch) -> dict[str, MagicMock]:
        """One stub per configured table name; only the Keywords variable is set."""
        monkeypatch.setenv('DYNAMODB_TABLE_KEYWORDS', 'keywords-table')
        monkeypatch.delenv('DYNAMODB_TABLE_KEYWORD_GROUPS', raising=False)
        return {'keywords-table': MagicMock(name='keywords'), 'groups-table': MagicMock(name='groups')}

    def test_opens_both_tables_when_the_groups_variable_is_set(self, monkeypatch, tables) -> None:
        monkeypatch.setenv('DYNAMODB_TABLE_KEYWORD_GROUPS', 'groups-table')

        opened = keyword_groups.open_keyword_tables(fake_dynamodb_resource(by_name=tables))

        assert opened == (tables['keywords-table'], tables['groups-table'])

    def test_leaves_the_groups_table_unset_when_its_variable_is_absent(self, tables) -> None:
        opened = keyword_groups.open_keyword_tables(fake_dynamodb_resource(by_name=tables))

        assert opened == (tables['keywords-table'], None)

    def test_requires_the_keywords_variable(self, monkeypatch, tables) -> None:
        monkeypatch.delenv('DYNAMODB_TABLE_KEYWORDS')

        with pytest.raises(KeyError, match='DYNAMODB_TABLE_KEYWORDS is not set'):
            keyword_groups.open_keyword_tables(fake_dynamodb_resource(by_name=tables))
