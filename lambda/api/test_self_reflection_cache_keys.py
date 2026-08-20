"""
Unit tests for the self-reflection cache's composite-key construction.

bugs.md 2.3: `keyword_brand` and `persona_timestamp` join user-supplied
values with '#'. Keywords, brands, and persona ids may themselves contain
'#', so unescaped joins collide: ("a#b", "c") and ("a", "b#c") map to the
same partition key, and a begins_with persona prefix for "a" also matches
persona "a#b". The handler escapes each component, making the keys injective.

`self-reflection.py` is hyphenated and builds a `boto3` DynamoDB resource at
import time, so it is loaded fresh via `spec_from_file_location` under a
module name unique to THIS file (the pattern from
`test_promote_keywords_pure_functions.py`) with the layer `shared` on
`sys.path`, table env vars set, and `boto3` patched BEFORE the load.
"""

import importlib
import importlib.util
import os
import sys
from unittest.mock import MagicMock, patch

import pytest

_API_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.abspath(os.path.join(_API_DIR, '..', '..'))
_LAYER_PY = os.path.join(_REPO, 'lambda', 'layer', 'python')

_HANDLER_FILE = 'self-reflection.py'
_MODULE_NAME = 'self_reflection_under_test_cache_keys'
_TABLE_ENV_VARS = {
    'DYNAMODB_TABLE_SEARCH_RESULTS': 'test-search-results-table',
    'DYNAMODB_TABLE_SELF_REFLECTION': 'test-self-reflection-table',
    'QUERY_PROMPTS_TABLE': 'test-query-prompts-table',
}


def _load_reflection_handler():
    """Load `self-reflection.py` fresh under this file's unique module name.

    `shared/__init__.py` re-exports `api_response` as a function, shadowing the
    submodule, so the real module object is bound explicitly -- otherwise the
    handler's `from shared.api_response import ...` resolves to the function.
    """
    if _LAYER_PY not in sys.path:
        sys.path.insert(0, _LAYER_PY)
    sys.modules['shared.api_response'] = importlib.import_module('shared.api_response')
    sys.modules.pop(_MODULE_NAME, None)
    spec = importlib.util.spec_from_file_location(
        _MODULE_NAME, os.path.join(_API_DIR, _HANDLER_FILE)
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope='module')
def reflection_handler():
    """`self-reflection.py`, loaded once for this module with `boto3` patched."""
    saved = {name: os.environ.get(name) for name in _TABLE_ENV_VARS}
    os.environ.update(_TABLE_ENV_VARS)

    with (
        patch('boto3.resource', MagicMock(name='boto3.resource')),
        patch('boto3.client', MagicMock(name='boto3.client')),
    ):
        yield _load_reflection_handler()

    for name, value in saved.items():
        if value is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = value
    sys.modules.pop(_MODULE_NAME, None)


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
