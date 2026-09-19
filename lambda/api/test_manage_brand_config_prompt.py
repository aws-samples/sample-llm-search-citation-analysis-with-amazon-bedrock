"""
Tests for the shared Bedrock prompt runner in manage-brand-config.py.

Background — bugs.md §5: expand_brands, expand_brand, and find_competitors
each hand-rolled the same invoke -> guard-empty -> parse -> guard-invalid ->
shape -> except ladder. These tests pin the consolidated `_run_brand_prompt`
behavior through the three public functions: error defaults for empty,
unparseable, and raising model calls, and each endpoint's success shaping.
"""

from __future__ import annotations

import json
import os

from testing.module_loader import load_handler_module

# The table name the module reads at import time, so it loads without touching AWS.
os.environ.setdefault('DYNAMODB_TABLE_BRAND_CONFIG', 'test-brand-config')
_mod = load_handler_module(os.path.dirname(__file__), 'manage-brand-config.py')


class BedrockUnavailableError(Exception):
    """Stand-in for a Bedrock invocation failure."""


class TestErrorDefaults:
    def test_expand_brand_returns_defaults_when_model_returns_empty_text(self, monkeypatch) -> None:
        monkeypatch.setattr(_mod, 'invoke_bedrock', lambda *_args, **_kwargs: '')

        result = _mod.expand_brand('Barceló', industry='hotels')

        assert result == {
            'main_brand': 'Barceló',
            'suggestions': ['Barceló'],
            'error': 'Empty response',
        }

    def test_expand_brand_returns_defaults_when_response_is_not_json(self, monkeypatch) -> None:
        monkeypatch.setattr(_mod, 'invoke_bedrock', lambda *_args, **_kwargs: 'sorry, no JSON here')

        result = _mod.expand_brand('Barceló', industry='hotels')

        assert result == {
            'main_brand': 'Barceló',
            'suggestions': ['Barceló'],
            'error': 'Invalid response format',
        }

    def test_expand_brands_returns_defaults_when_model_invocation_raises(self, monkeypatch) -> None:
        def raise_unavailable(*_args, **_kwargs):
            raise BedrockUnavailableError('throttled')

        monkeypatch.setattr(_mod, 'invoke_bedrock', raise_unavailable)

        result = _mod.expand_brands(['Barceló'], industry='hotels')

        assert result == {
            'suggestions': [],
            'duplicates_found': [],
            'error': 'throttled',
        }


class TestSuccessShaping:
    def test_expand_brand_inserts_main_brand_at_head_of_suggestions(self, monkeypatch) -> None:
        payload = json.dumps({
            'main_brand': 'Barceló',
            'parent_company': 'Barceló Group',
            'suggestions': ['Occidental', 'Allegro'],
            'notes': 'sub-brands',
        })
        monkeypatch.setattr(_mod, 'invoke_bedrock', lambda *_args, **_kwargs: payload)

        result = _mod.expand_brand('Barceló', industry='hotels')

        assert result['suggestions'] == ['Barceló', 'Occidental', 'Allegro']
        assert result['parent_company'] == 'Barceló Group'

    def test_expand_brands_filters_suggestions_matching_existing_brands(self, monkeypatch) -> None:
        payload = json.dumps({
            'parent_companies': ['Barceló Group'],
            'suggestions': ['BARCELÓ', 'Occidental', 'occidental', 'Allegro'],
            'notes': 'found some',
        })
        monkeypatch.setattr(_mod, 'invoke_bedrock', lambda *_args, **_kwargs: payload)

        result = _mod.expand_brands(['Barceló'], industry='hotels')

        # The existing brand is filtered out (case-insensitive) and the
        # duplicated suggestion is collapsed to its first occurrence.
        assert result['suggestions'] == ['Occidental', 'Allegro']
        assert result['existing_brands'] == ['Barceló']

    def test_find_competitors_extracts_names_from_detailed_entries(self, monkeypatch) -> None:
        payload = json.dumps({
            'competitors': [
                {
                    'name': 'Meliá',
                    'reason': 'same market',
                },
                'Iberostar',
            ],
            'notes': 'landscape',
        })
        monkeypatch.setattr(_mod, 'invoke_bedrock', lambda *_args, **_kwargs: payload)

        result = _mod.find_competitors(['Barceló'], industry='hotels')

        assert result['competitors'] == ['Meliá', 'Iberostar']
        assert result['first_party_brands'] == ['Barceló']



class TestDefaultPrompt:
    """`generate_default_prompt` is what the dashboard shows as each preset's editable starting point."""

    def test_renders_the_mention_example_as_an_indented_json_array(self) -> None:
        prompt = _mod.generate_default_prompt('Hotels & Hospitality', 'hotel recommendations', ['hotel chains'])

        assert (
            'Return ONLY a valid JSON array with no additional text. Format:\n'
            '[\n'
            '  {\n'
            '    "name": "Brand Name",\n'
            '    "parent_company": "Parent Company or null",\n'
            '    "mention_count": 2,\n'
            '    "first_position": 150,\n'
            '    "rank": 1,\n'
            '    "sentiment": "positive",\n'
            '    "sentiment_reason": "Praised for quality and value",\n'
            '    "ranking_context": "Recommended as top choice"\n'
            '  }\n'
            ']\n'
            '\n'
            'If no brands are found, return an empty array: []\n'
        ) in prompt

    def test_keeps_the_extractor_placeholders_as_double_braces(self) -> None:
        prompt = _mod.generate_default_prompt('Hotels & Hospitality', 'hotel recommendations', ['hotel chains'])

        assert prompt.endswith('TEXT TO ANALYZE:\n{{TEXT}}\n\nJSON OUTPUT:')
        assert '{{TRACKED_BRANDS}}' in prompt
        assert '{{SENTIMENT_FIELDS}}\n{{RANKING_CONTEXT_FIELD}}\n\n{{CUSTOM_INSTRUCTIONS}}' in prompt

    def test_lists_each_entity_type_as_a_bullet(self) -> None:
        prompt = _mod.generate_default_prompt('Hotels & Hospitality', 'hotel recommendations', ['hotel chains', 'resorts'])

        assert 'ENTITY TYPES TO EXTRACT:\n- hotel chains\n- resorts\n' in prompt

    def test_falls_back_to_a_generic_bullet_when_the_preset_lists_no_entity_types(self) -> None:
        prompt = _mod.generate_default_prompt('Custom Industry', 'brand recommendations', [])

        assert 'ENTITY TYPES TO EXTRACT:\n- Brand names and company names\n' in prompt
