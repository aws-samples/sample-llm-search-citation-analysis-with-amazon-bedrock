"""Tests for shared.requested_group_ids."""

import pytest

from shared.requested_group_ids import validate_requested_group_ids
from testing.dynamodb_stubs import fake_table


@pytest.fixture
def groups_table():
    """Groups `g1` and `g2` exist; every other id is unknown."""
    table = fake_table()
    table.get_item.side_effect = lambda Key: {'Item': {'id': Key['id']}} if Key['id'] in {'g1', 'g2'} else {}
    return table


def test_returns_none_without_an_error_when_group_ids_is_omitted(groups_table):
    assert validate_requested_group_ids({'keyword': 'k'}, groups_table) == (None, None)


def test_returns_the_trimmed_ids_when_every_group_exists(groups_table):
    assert validate_requested_group_ids({'group_ids': [' g2 ', 'g1', 'g2']}, groups_table) == (['g2', 'g1'], None)


def test_accepts_an_empty_list_without_a_groups_table():
    assert validate_requested_group_ids({'group_ids': []}, None) == ([], None)


@pytest.mark.parametrize(('body', 'table_present', 'limit', 'message'), [
    pytest.param({'group_ids': 'g1'}, True, None, 'group_ids must be an array of strings', id='not-a-list'),
    pytest.param({'group_ids': ['g1', 'g2']}, True, 1, 'group_ids accepts at most 1 entries', id='over-the-limit'),
    pytest.param(
        {'group_ids': ['g1']}, False, None, 'Keyword groups are not available on this deployment',
        id='no-groups-table',
    ),
    pytest.param({'group_ids': ['g9', 'g1', 'g3']}, True, None, 'Unknown keyword group ids: g3, g9', id='unknown-ids-sorted'),
])
def test_returns_the_field_message_when_group_ids_is_rejected(groups_table, body, table_present, limit, message):
    table = groups_table if table_present else None

    assert validate_requested_group_ids(body, table, limit=limit) == (None, message)
