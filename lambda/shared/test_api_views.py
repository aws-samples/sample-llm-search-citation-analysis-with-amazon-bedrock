"""Tests for ``shared.api_views`` — the opening fields of a user-named row's API view."""

from __future__ import annotations

from shared.api_views import named_item_view


def test_returns_id_name_and_description_when_the_row_carries_all_three():
    view = named_item_view({'id': 'g-1', 'name': 'Hotel Coruña', 'description': 'Galicia', 'created_at': 'x'})

    assert view == {'id': 'g-1', 'name': 'Hotel Coruña', 'description': 'Galicia'}


def test_blanks_the_name_and_description_when_the_row_lacks_them():
    assert named_item_view({'id': 'g-1'}) == {'id': 'g-1', 'name': '', 'description': ''}


def test_lists_the_fields_in_id_name_description_order():
    assert list(named_item_view({'id': 'g-1', 'description': 'd', 'name': 'n'})) == ['id', 'name', 'description']
