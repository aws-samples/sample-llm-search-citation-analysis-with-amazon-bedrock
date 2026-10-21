"""Tests for shared.response_budget: envelope measurement and page cutting."""

from __future__ import annotations

import json
from decimal import Decimal

from hypothesis import given
from hypothesis import strategies as st

from shared.api_response import api_response
from shared.response_budget import (
    LAMBDA_RESPONSE_LIMIT_BYTES,
    PAGE_BUDGET_BYTES,
    SPILL_THRESHOLD_BYTES,
    envelope_bytes,
    json_bytes,
    take_within_budget,
)


def test_counts_each_accented_character_as_a_six_byte_escape() -> None:
    assert json_bytes('ñ') == len('"\\u00f1"')


def test_measures_bodies_exactly_as_api_response_serializes_them() -> None:
    body = {'n': Decimal(12), 'text': 'coruña'}

    response = api_response(200, body)

    assert json_bytes(body) == len(response['body'].encode('utf-8'))


def test_envelope_counts_the_second_escaping_of_the_body() -> None:
    body = json.dumps({'a': 'b'})
    response = {'statusCode': 200, 'headers': {}, 'body': body}

    assert envelope_bytes(response) == len(json.dumps(response))
    assert envelope_bytes(response) > len(body) + len('"body": ""')


def test_spill_threshold_leaves_room_under_the_lambda_cap() -> None:
    assert PAGE_BUDGET_BYTES < SPILL_THRESHOLD_BYTES < LAMBDA_RESPONSE_LIMIT_BYTES


def test_keeps_every_item_when_the_list_fits() -> None:
    assert take_within_budget(['a', 'b', 'c'], max_bytes=1_000) == (['a', 'b', 'c'], False)


def test_cuts_the_list_where_the_next_item_would_exceed_the_budget() -> None:
    items = ['x' * 40, 'y' * 40, 'z' * 40]

    page, truncated = take_within_budget(items, max_bytes=100)

    assert (page, truncated) == (['x' * 40, 'y' * 40], True)


def test_always_keeps_the_first_item_so_a_cursor_advances() -> None:
    assert take_within_budget(['x' * 500], max_bytes=10) == (['x' * 500], False)


def test_honours_max_items_before_the_byte_budget() -> None:
    assert take_within_budget([1, 2, 3, 4], max_items=2) == ([1, 2], True)


def test_returns_an_empty_page_for_an_empty_list() -> None:
    assert take_within_budget([]) == ([], False)


def test_treats_a_negative_max_items_as_zero() -> None:
    assert take_within_budget([1, 2], max_items=-3) == ([], True)


@given(st.lists(st.text(max_size=200), max_size=60), st.integers(min_value=50, max_value=5_000))
def test_a_page_of_several_items_never_exceeds_the_budget(items: list[str], budget: int) -> None:
    page, truncated = take_within_budget(items, max_bytes=budget)

    assert page == items[:len(page)]
    assert truncated == (len(page) < len(items))
    if len(page) > 1:
        assert json_bytes(page) <= budget
