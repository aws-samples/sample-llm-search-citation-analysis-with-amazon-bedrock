"""
Tests for shared.keyword_store.

The module consolidates the keyword validate/build/put pipeline that
``manage-keywords`` and ``promote-keywords`` previously duplicated
(bugs.md 3.3). These tests pin the consolidated contract:

- The validation sequence (type → surrogate check → trim → length) and its
  exact message texts, which both routes' suites assert on.
- ``empty_ok`` as the single deliberate divergence point: manage rejects
  empty-after-trim, promote skips.
- The canonical item shape and defaults ('global'/'en'/''/'normal').
- Conditional-put semantics: created vs occupied, non-conditional errors
  propagate unchanged.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from shared.constants import MAX_KEYWORD_LENGTH
from shared.keyword_store import (
    build_keyword_item,
    put_keyword_if_absent,
    validate_keyword_text,
)
from shared.utils import keyword_id


class TestValidateKeywordText:
    """The shared validate sequence: type → surrogate → trim → length."""

    def test_returns_trimmed_text_for_valid_padded_keyword(self):
        text, message = validate_keyword_text('  best running shoes  ')

        assert (text, message) == ('best running shoes', None)

    def test_rejects_non_string_input_with_type_message(self):
        text, message = validate_keyword_text(42)

        assert (text, message) == (None, 'Keyword must be a string')

    def test_rejects_lone_surrogate_with_scalar_message(self):
        text, message = validate_keyword_text('alpha\ud800')

        assert (text, message) == (
            None,
            'Keyword must contain valid Unicode scalar values',
        )

    def test_rejects_empty_after_trim_by_default(self):
        text, message = validate_keyword_text('   ')

        assert (text, message) == (None, 'Keyword must not be empty')

    def test_returns_empty_text_when_empty_ok(self):
        text, message = validate_keyword_text('   ', empty_ok=True)

        assert (text, message) == ('', None)

    def test_rejects_text_longer_than_the_shared_cap(self):
        text, message = validate_keyword_text('a' * (MAX_KEYWORD_LENGTH + 1))

        assert (text, message) == (
            None,
            f'Keyword exceeds maximum length of {MAX_KEYWORD_LENGTH} characters',
        )

    def test_accepts_text_exactly_at_the_shared_cap(self):
        at_cap = 'a' * MAX_KEYWORD_LENGTH

        text, message = validate_keyword_text(at_cap)

        assert (text, message) == (at_cap, None)


class TestBuildKeywordItem:
    """The canonical Keywords-table item shape and defaults."""

    def test_item_uses_shared_defaults_and_stamps_both_timestamps(self):
        item = build_keyword_item('best running shoes', timestamp='2026-08-19T00:00:00.000000Z')

        assert item == {
            'id': keyword_id('best running shoes'),
            'keyword': 'best running shoes',
            'status': 'active',
            'created_at': '2026-08-19T00:00:00.000000Z',
            'updated_at': '2026-08-19T00:00:00.000000Z',
            'region': 'global',
            'language': 'en',
            'category': '',
            'priority': 'normal',
            'notes': '',
        }

    def test_item_carries_caller_overrides(self):
        item = build_keyword_item(
            'trail shoes',
            timestamp='2026-08-19T00:00:00.000000Z',
            status='paused',
            priority='high',
            region='eu',
            language='de',
            category='footwear',
            notes='intent: commercial',
        )

        assert item == {
            'id': keyword_id('trail shoes'),
            'keyword': 'trail shoes',
            'status': 'paused',
            'created_at': '2026-08-19T00:00:00.000000Z',
            'updated_at': '2026-08-19T00:00:00.000000Z',
            'region': 'eu',
            'language': 'de',
            'category': 'footwear',
            'priority': 'high',
            'notes': 'intent: commercial',
        }


def _conditional_failure() -> ClientError:
    return ClientError(
        {'Error': {'Code': 'ConditionalCheckFailedException'}}, 'PutItem'
    )


class TestPutKeywordIfAbsent:
    """Conditional-put semantics shared by both write routes."""

    def test_returns_true_and_writes_conditionally_when_id_is_free(self):
        table = MagicMock()
        item = {'id': 'abc', 'keyword': 'alpha'}

        created = put_keyword_if_absent(table, item)

        assert created is True
        table.put_item.assert_called_once_with(
            Item=item,
            ConditionExpression='attribute_not_exists(#id)',
            ExpressionAttributeNames={'#id': 'id'},
        )

    def test_returns_false_when_the_id_is_already_taken(self):
        table = MagicMock()
        table.put_item.side_effect = _conditional_failure()

        created = put_keyword_if_absent(table, {'id': 'abc', 'keyword': 'alpha'})

        assert created is False

    def test_propagates_non_conditional_client_errors_unchanged(self):
        table = MagicMock()
        error = ClientError({'Error': {'Code': 'ThrottlingException'}}, 'PutItem')
        table.put_item.side_effect = error

        with pytest.raises(ClientError) as raised:
            put_keyword_if_absent(table, {'id': 'abc', 'keyword': 'alpha'})

        assert raised.value is error
