"""
Unit tests for the self-reflection cache's composite-key construction.

bugs.md 2.3: `keyword_brand` and `persona_timestamp` join user-supplied
values with '#'. Keywords, brands, and persona ids may themselves contain
'#', so unescaped joins collide: ("a#b", "c") and ("a", "b#c") map to the
same partition key, and a begins_with persona prefix for "a" also matches
persona "a#b". The handler escapes each component, making the keys injective.

`self-reflection.py` is hyphenated and builds a `boto3` DynamoDB resource at
import time, so it is loaded fresh under a module name unique to THIS file
with the table env vars set and `boto3` patched BEFORE the load
(`testing.handler_fixtures.handler_fixture`).
"""

import os

from testing.handler_fixtures import handler_fixture

_API_DIR = os.path.dirname(os.path.abspath(__file__))

reflection_handler = handler_fixture(
    _API_DIR,
    'self-reflection.py',
    'self_reflection_under_test_cache_keys',
    env={
        'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-search-results-table',
        'DYNAMODB_TABLE_SELF_REFLECTION': 'test-self-reflection-table',
        'QUERY_PROMPTS_TABLE': 'test-query-prompts-table',
    },
)


class TestReflectionPartitionKey:
    """`_reflection_pk` is injective over (keyword, lowercased brand)."""

    def test_partition_keys_differ_when_a_hash_shifts_between_keyword_and_brand(
        self, reflection_handler
    ):
        keyword_with_hash = reflection_handler._reflection_pk('a#b', 'c')
        brand_with_hash = reflection_handler._reflection_pk('a', 'b#c')

        assert keyword_with_hash != brand_with_hash, (
            f'Delimiter ambiguity: both pairs map to {keyword_with_hash!r}'
        )

    def test_partition_key_treats_a_literal_escape_sequence_as_distinct_from_a_hash(
        self, reflection_handler
    ):
        literal_escape = reflection_handler._reflection_pk('a%23b', 'brand')
        actual_hash = reflection_handler._reflection_pk('a#b', 'brand')

        assert literal_escape != actual_hash, (
            'Escaping is not injective: %23 and # collapse to the same key'
        )

    def test_partition_key_is_unchanged_for_values_without_delimiter_characters(
        self, reflection_handler
    ):
        pk = reflection_handler._reflection_pk('best running shoes', 'Acme')

        assert pk == 'best running shoes#acme', f'Plain values must pass through, got {pk!r}'

    def test_partition_key_lowercases_the_brand_component(self, reflection_handler):
        mixed_case = reflection_handler._reflection_pk('kw', 'BrandName')
        lower_case = reflection_handler._reflection_pk('kw', 'brandname')

        assert mixed_case == lower_case, 'Brand matching must stay case-insensitive'


class TestPersonaKeyPrefix:
    """`_persona_key_prefix` cannot prefix-match a different persona."""

    def test_prefix_for_short_persona_does_not_match_sort_key_of_hash_extended_persona(
        self, reflection_handler
    ):
        stored_sort_key = (
            f"{reflection_handler._persona_key_prefix('a#b')}2026-08-19T00:00:00Z"
        )

        assert not stored_sort_key.startswith(
            reflection_handler._persona_key_prefix('a')
        ), f'begins_with for persona "a" would match {stored_sort_key!r}'

    def test_prefix_ends_with_the_delimiter_for_a_plain_persona_id(self, reflection_handler):
        prefix = reflection_handler._persona_key_prefix('default')

        assert prefix == 'default#', f'Expected trailing delimiter, got {prefix!r}'
