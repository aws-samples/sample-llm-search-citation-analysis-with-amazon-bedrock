"""
Tests for shared.llm_json — tolerant JSON parsing of LLM responses.

Covers:
- Happy path: clean JSON object / array
- Markdown code fences with and without language tag
- Unclosed fences (LLM truncation) salvaged
- Extra prose before and after JSON
- Truncated arrays salvaged via last-complete-object recovery
- Wrong top-level type returns None
- Empty / None / malformed input returns None
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(__file__))

from llm_json import parse_llm_json


class TestObjectParsing:
    def test_returns_dict_for_clean_object(self) -> None:
        assert parse_llm_json('{"a": 1}') == {"a": 1}

    def test_strips_markdown_fence_with_json_language_tag(self) -> None:
        text = '```json\n{"a": 1}\n```'
        assert parse_llm_json(text) == {"a": 1}

    def test_strips_markdown_fence_without_language_tag(self) -> None:
        text = '```\n{"a": 1}\n```'
        assert parse_llm_json(text) == {"a": 1}

    def test_ignores_prose_before_and_after_object(self) -> None:
        text = 'Here is the JSON:\n{"a": 1}\nLet me know if you need more.'
        assert parse_llm_json(text) == {"a": 1}

    def test_salvages_unclosed_fence_with_valid_object(self) -> None:
        text = '```json\n{"a": 1, "b": 2}'
        assert parse_llm_json(text) == {"a": 1, "b": 2}

    def test_returns_none_when_top_level_is_array_but_object_expected(self) -> None:
        assert parse_llm_json('[1, 2, 3]', expect="object") is None

    def test_returns_none_when_no_braces_found(self) -> None:
        assert parse_llm_json('just text, no json here') is None

    def test_returns_none_for_malformed_json(self) -> None:
        assert parse_llm_json('{this is not: valid json}') is None

    def test_returns_none_for_empty_input(self) -> None:
        assert parse_llm_json('') is None

    def test_returns_none_for_none_input(self) -> None:
        assert parse_llm_json(None) is None  # type: ignore[arg-type]


class TestArrayParsing:
    def test_returns_list_for_clean_array(self) -> None:
        assert parse_llm_json('[1, 2, 3]', expect="array") == [1, 2, 3]

    def test_strips_markdown_fence_around_array(self) -> None:
        text = '```json\n[{"x": 1}]\n```'
        assert parse_llm_json(text, expect="array") == [{"x": 1}]

    def test_salvages_truncated_array_after_last_complete_object(self) -> None:
        # LLM ran out of tokens mid-output. Should recover the two full objects.
        text = '[{"name": "A"}, {"name": "B"}, {"name": "C'
        assert parse_llm_json(text, expect="array") == [
            {"name": "A"},
            {"name": "B"},
        ]

    def test_returns_none_when_top_level_is_object_but_array_expected(self) -> None:
        assert parse_llm_json('{"a": 1}', expect="array") is None

    def test_returns_none_when_no_brackets_or_recoverable_content(self) -> None:
        assert parse_llm_json('just text', expect="array") is None

    def test_handles_nested_objects_inside_array(self) -> None:
        text = '[{"a": {"b": 1}}, {"a": {"b": 2}}]'
        assert parse_llm_json(text, expect="array") == [
            {"a": {"b": 1}},
            {"a": {"b": 2}},
        ]
