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

from unittest.mock import MagicMock

import pytest
from botocore.exceptions import ClientError

from shared.constants import MAX_KEYWORD_LENGTH
from shared.keyword_store import (
    KeywordReference,
    build_keyword_item,
    keyword_reference,
    put_keyword_if_absent,
    resolve_concept_id,
    validate_keyword_market,
    validate_keyword_text,
)
from shared.utils import keyword_id
from testing.dynamodb_stubs import conditional_check_failure, fake_table
from testing.markets_fixtures import CHILE, markets_item


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
        table.put_item.side_effect = conditional_check_failure('PutItem')

        created = put_keyword_if_absent(table, {'id': 'abc', 'keyword': 'alpha'})

        assert created is False

    def test_propagates_non_conditional_client_errors_unchanged(self):
        table = MagicMock()
        error = ClientError({'Error': {'Code': 'ThrottlingException'}}, 'PutItem')
        table.put_item.side_effect = error

        with pytest.raises(ClientError) as raised:
            put_keyword_if_absent(table, {'id': 'abc', 'keyword': 'alpha'})

        assert raised.value is error


class TestBuildKeywordItemReferences:
    def test_stores_the_market_and_concept_when_given(self):
        item = build_keyword_item('vuelos', timestamp='2026-10-01T00:00:00Z', market_id='cl-es', concept_id='source-id')

        assert (item['market_id'], item['concept_id']) == ('cl-es', 'source-id')

    def test_stores_neither_reference_for_a_global_keyword(self):
        item = build_keyword_item('flights', timestamp='2026-10-01T00:00:00Z')

        assert {'market_id', 'concept_id'} & item.keys() == set()


class TestKeywordReference:
    def test_reads_an_omitted_field_as_not_given(self):
        assert keyword_reference({}, 'market_id') == (KeywordReference(given=False, value=None), None)

    @pytest.mark.parametrize('raw', ['', '   ', None], ids=['empty', 'blank', 'null'])
    def test_reads_an_empty_value_as_given_without_a_value(self, raw):
        assert keyword_reference({'market_id': raw}, 'market_id') == (KeywordReference(given=True, value=None), None)

    def test_trims_a_given_id(self):
        assert keyword_reference({'market_id': ' cl-es '}, 'market_id') == (KeywordReference(given=True, value='cl-es'), None)

    def test_rejects_a_non_string_value(self):
        assert keyword_reference({'concept_id': ['a']}, 'concept_id') == (None, 'concept_id must be a string')

    def test_reads_a_non_object_body_as_not_given(self):
        assert keyword_reference(['market_id'], 'market_id') == (KeywordReference(given=False, value=None), None)


class TestValidateKeywordMarket:
    def test_accepts_a_configured_market(self):
        table = fake_table(get_item={'Item': markets_item(CHILE)})

        assert validate_keyword_market('cl-es', table) == ('cl-es', None)

    @pytest.mark.parametrize('market_id', [None, 'global'])
    def test_answers_the_global_market_without_reading_the_list(self, market_id):
        table = fake_table()

        assert validate_keyword_market(market_id, table) == (None, None)
        table.get_item.assert_not_called()

    def test_rejects_an_unconfigured_market(self):
        table = fake_table(get_item={'Item': markets_item(CHILE)})

        assert validate_keyword_market('br-pt', table) == (None, 'Unknown market_id: br-pt')

    def test_rejects_every_market_when_none_is_configured(self):
        assert validate_keyword_market('cl-es', fake_table(get_item={})) == (None, 'Unknown market_id: cl-es')


class TestResolveConceptId:
    def test_keeps_the_id_of_a_source_keyword(self):
        table = fake_table(get_item={'Item': {'id': 'source-id', 'keyword': 'flights'}})

        assert resolve_concept_id(table, 'source-id', 'new-id') == ('source-id', None)

    def test_resolves_a_translation_to_its_concept(self):
        table = fake_table(get_item={'Item': {'id': 'translation-id', 'concept_id': 'source-id'}})

        assert resolve_concept_id(table, 'translation-id', 'new-id') == ('source-id', None)

    def test_answers_no_concept_for_none(self):
        table = fake_table()

        assert resolve_concept_id(table, None, 'new-id') == (None, None)
        table.get_item.assert_not_called()

    def test_rejects_an_unknown_keyword(self):
        assert resolve_concept_id(fake_table(get_item={}), 'ghost', 'new-id') == (None, 'Unknown concept_id: ghost')

    def test_rejects_a_concept_that_resolves_to_the_keyword_itself(self):
        table = fake_table(get_item={'Item': {'id': 'translation-id', 'concept_id': 'own-id'}})

        assert resolve_concept_id(table, 'translation-id', 'own-id') == (None, 'A keyword cannot localize itself')
