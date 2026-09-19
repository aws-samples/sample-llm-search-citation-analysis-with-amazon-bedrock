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
