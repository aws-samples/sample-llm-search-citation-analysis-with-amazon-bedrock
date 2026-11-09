"""Tests for shared.cursors: opaque next_token encoding."""

from __future__ import annotations

import base64
import json
from decimal import Decimal

import pytest
from hypothesis import given
from hypothesis import strategies as st

from shared.cursors import (
    MAX_CURSOR_LENGTH,
    decode_bound_offset_cursor,
    decode_cursor,
    decode_offset_cursor,
    encode_bound_offset_cursor,
    encode_cursor,
    encode_offset_cursor,
    query_binding,
)


def _raw_token(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode('utf-8')).decode('ascii').rstrip('=')


def test_returns_none_when_there_is_no_further_page() -> None:
    assert (encode_cursor(None), encode_cursor({})) == (None, None)


def test_round_trips_a_dynamodb_key_with_number_and_non_ascii_values() -> None:
    key = {'keyword': 'hôtel coruña', 'citation_count': Decimal(3), 'score': Decimal('0.25')}

    token = encode_cursor(key)

    assert token is not None
    assert decode_cursor(token, ('keyword', 'citation_count', 'score')) == {
        'keyword': 'hôtel coruña', 'citation_count': 3, 'score': Decimal('0.25'),
    }


def test_encodes_url_safe_unpadded_tokens() -> None:
    token = encode_cursor({'id': '???>>>~~~'})

    assert token is not None
    assert set(token) <= set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_')


@pytest.mark.parametrize('token', [
    'not base64 !!',
    _raw_token('not json'),
    _raw_token('[1, 2]'),
    _raw_token('{"id": "a", "extra": 1}'),
    _raw_token('{"other": "a"}'),
    _raw_token('"just a string"'),
    '',
])
def test_rejects_tokens_that_are_not_an_object_with_exactly_the_expected_keys(token: str) -> None:
    assert decode_cursor(token, ('id',)) is None


def test_rejects_tokens_longer_than_the_maximum() -> None:
    assert decode_cursor('A' * (MAX_CURSOR_LENGTH + 1), ('id',)) is None


def test_offset_cursor_is_absent_at_the_end_of_the_list() -> None:
    assert (encode_offset_cursor(10, 10), encode_offset_cursor(11, 10)) == (None, None)


def test_offset_cursor_round_trips_the_next_offset() -> None:
    token = encode_offset_cursor(200, 1_000)

    assert decode_offset_cursor(token) == 200


def test_offset_cursor_reads_as_zero_without_a_token() -> None:
    assert decode_offset_cursor(None) == 0


@pytest.mark.parametrize('payload', [{'offset': -1}, {'offset': True}, {'offset': '5'}, {'offset': 1.5}])
def test_offset_cursor_rejects_offsets_that_are_not_non_negative_integers(payload: dict[str, object]) -> None:
    assert decode_offset_cursor(_raw_token(json.dumps(payload))) is None


@given(st.dictionaries(st.text(min_size=1, max_size=20), st.text(max_size=60), min_size=1, max_size=4))
def test_any_string_key_round_trips(key: dict[str, str]) -> None:
    token = encode_cursor(key)

    assert token is not None
    assert decode_cursor(token, key.keys()) == key


class TestBoundOffsetCursor:
    BINDING = query_binding({'scope': 'group:coruna', 'classification': None})

    def test_round_trips_the_offset_for_the_same_query(self) -> None:
        token = encode_bound_offset_cursor(100, 250, self.BINDING)

        assert decode_bound_offset_cursor(token, self.BINDING) == 100

    def test_is_absent_at_the_end_of_the_list(self) -> None:
        assert encode_bound_offset_cursor(250, 250, self.BINDING) is None

    def test_reads_as_zero_without_a_token(self) -> None:
        assert decode_bound_offset_cursor(None, self.BINDING) == 0

    def test_rejects_a_token_of_another_query(self) -> None:
        token = encode_bound_offset_cursor(100, 250, query_binding({'scope': 'group:other', 'classification': None}))

        assert decode_bound_offset_cursor(token, self.BINDING) is None

    @pytest.mark.parametrize('payload', [{'offset': 100}, {'offset': -1, 'query': BINDING}, {'offset': True, 'query': BINDING}])
    def test_rejects_unbound_or_invalid_offsets(self, payload: dict[str, object]) -> None:
        assert decode_bound_offset_cursor(_raw_token(json.dumps(payload)), self.BINDING) is None

    def test_binding_ignores_key_order(self) -> None:
        assert query_binding({'a': 1, 'b': None}) == query_binding({'b': None, 'a': 1})
