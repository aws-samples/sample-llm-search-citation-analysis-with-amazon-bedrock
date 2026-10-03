"""
Tests for the prompt text and success payload of the three brand-suggestion helpers in manage-brand-config.py.

Each prompt opens with the shared expert preamble (untrusted-input rule, role, industry context, and the
example brands for expand_brand / find_competitors only), then lists the user's brands wrapped in
``<brand>`` tags, with ``none`` standing in for an empty exclusion list. Every success payload ends with
the model's ``notes`` and the requested ``industry``.
"""

from __future__ import annotations

import json

import pytest
from test_manage_brand_config_fixtures import capture_prompts, load_brand_config_module

from shared.prompt_safety import untrusted_input_system_instruction

_mod = load_brand_config_module('manage_brand_config_prompt_text_under_test')

_HOTELS_CONTEXT = (
    'INDUSTRY CONTEXT:\n'
    '- Entity types: hotel chains, hotel brands, individual properties, resorts, boutique hotels'
)
_HOTELS_EXAMPLES = '\n- Example brands in this industry: Marriott, Hilton, Hyatt, InterContinental, Four Seasons'
_BRAND_EXPERT = (
    f'{untrusted_input_system_instruction()}\n\n'
    'You are a brand expert for the Hotels & Hospitality industry.\n\n'
    f'{_HOTELS_CONTEXT}'
)
_COMPETITIVE_EXPERT = (
    f'{untrusted_input_system_instruction()}\n\n'
    'You are a competitive intelligence expert for the Hotels & Hospitality industry.\n\n'
    f'{_HOTELS_CONTEXT}{_HOTELS_EXAMPLES}'
)


class TestPromptOpening:
    @pytest.mark.parametrize(('function_name', 'arguments', 'expected_opening'), [
        pytest.param(
            'expand_brands',
            (['Barceló', 'Occidental'], 'hotels', 'first_party'),
            f'{_BRAND_EXPERT}\n\n'
            'FIRST-PARTY BRANDS ALREADY BEING TRACKED (DO NOT INCLUDE THESE IN YOUR RESPONSE):\n'
            '<brand>Barceló</brand>, <brand>Occidental</brand>\n\n',
            id='expand-all-lists-tracked-brands-without-examples',
        ),
        pytest.param(
            'expand_brand',
            ('Barceló', 'hotels', []),
            f'{_BRAND_EXPERT}{_HOTELS_EXAMPLES}\n\n'
            'ALREADY TRACKED (do NOT suggest these): none\n\n'
            'Given the brand name <brand>Barceló</brand>,',
            id='expand-brand-excludes-none-when-nothing-is-tracked',
        ),
        pytest.param(
            'find_competitors',
            (['Barceló'], 'hotels', ['Meliá']),
            f'{_COMPETITIVE_EXPERT}\n\n'
            "FIRST-PARTY BRANDS (the user's brands): <brand>Barceló</brand>\n\n"
            'ALREADY TRACKED (do not suggest these): <brand>Barceló</brand>, <brand>Meliá</brand>\n\n',
            id='find-competitors-excludes-first-party-and-tracked-competitors',
        ),
        pytest.param(
            'find_competitors',
            ([], 'hotels', []),
            f'{_COMPETITIVE_EXPERT}\n\n'
            "FIRST-PARTY BRANDS (the user's brands): \n\n"
            'ALREADY TRACKED (do not suggest these): none\n\n',
            id='find-competitors-leaves-first-party-blank-and-excludes-none-when-empty',
        ),
    ])
    def test_prompt_opens_with_the_expert_preamble_and_wrapped_brands(
        self, monkeypatch, function_name, arguments, expected_opening,
    ) -> None:
        prompts = capture_prompts(monkeypatch, _mod)

        getattr(_mod, function_name)(*arguments)

        assert prompts[0][:len(expected_opening)] == expected_opening


class TestSuccessPayload:
    @pytest.mark.parametrize(('function_name', 'arguments', 'model_answer', 'expected'), [
        pytest.param(
            'expand_brands',
            (['Barceló'], 'hotels', 'first_party'),
            {'parent_companies': ['Barceló Group'], 'suggestions': ['Occidental'], 'notes': 'one tier missing'},
            {
                'existing_brands': ['Barceló'],
                'parent_companies': ['Barceló Group'],
                'suggestions': ['Occidental'],
                'duplicates_found': [],
                'notes': 'one tier missing',
                'industry': 'hotels',
            },
            id='expand-all-brands',
        ),
        pytest.param(
            'expand_brand',
            ('Barceló', 'hotels', []),
            {'parent_company': 'Barceló Group', 'suggestions': ['Occidental'], 'notes': 'one tier missing'},
            {
                'main_brand': 'Barceló',
                'parent_company': 'Barceló Group',
                'suggestions': ['Barceló', 'Occidental'],
                'notes': 'one tier missing',
                'industry': 'hotels',
            },
            id='expand-brand',
        ),
        pytest.param(
            'find_competitors',
            (['Barceló'], 'hotels', []),
            {'competitors': ['Meliá'], 'notes': 'one tier missing'},
            {
                'first_party_brands': ['Barceló'],
                'competitors': ['Meliá'],
                'competitor_details': ['Meliá'],
                'notes': 'one tier missing',
                'industry': 'hotels',
            },
            id='find-competitors',
        ),
    ])
    def test_payload_ends_with_the_model_notes_and_requested_industry(
        self, monkeypatch, function_name, arguments, model_answer, expected,
    ) -> None:
        capture_prompts(monkeypatch, _mod, answer=json.dumps(model_answer))

        result = getattr(_mod, function_name)(*arguments)

        assert result == expected

    def test_notes_are_empty_when_the_model_omits_them(self, monkeypatch) -> None:
        capture_prompts(monkeypatch, _mod, answer=json.dumps({'competitors': []}))

        result = _mod.find_competitors(['Barceló'], 'hotels', [])

        assert result['notes'] == ''
