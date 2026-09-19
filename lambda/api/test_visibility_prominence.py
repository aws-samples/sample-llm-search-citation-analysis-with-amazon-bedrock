"""Answer-level prominence tests for the visibility metrics API."""

from __future__ import annotations

import os
from unittest.mock import patch

from testing.module_loader import load_handler_module

os.environ.setdefault('DYNAMODB_TABLE_SEARCH_RESULTS', 'test-search')
_mod = load_handler_module(os.path.dirname(__file__), 'get-visibility-metrics.py')


def _brand(name: str, classification: str, rank=None, first_position=None) -> dict:
    return {
        'name': name,
        'classification': classification,
        'mention_count': 1,
        'rank': rank,
        'first_position': first_position,
        'sentiment': 'neutral',
    }


class TestVisibilityProminence:
    def test_uses_only_latest_run_answers_for_first_party_prominence(self) -> None:
        rows = [
            {
                'timestamp': '2026-09-17T10:00:00Z',
                'provider': 'old-provider',
                'brands': [_brand('Mine', 'first_party', rank=1, first_position=1)],
            },
            {
                'timestamp': '2026-09-18T10:00:00Z',
                'provider': 'openai',
                'brands': [
                    _brand('Mine', 'first_party', rank=4, first_position=40),
                    _brand('Mine Plus', 'first_party', rank=1, first_position=10),
                ],
            },
            {
                'timestamp': '2026-09-18T10:00:00Z',
                'provider': 'gemini',
                'brands': [_brand('Mine', 'first_party', rank=999, first_position=20)],
            },
            {
                'timestamp': '2026-09-18T10:00:00Z',
                'provider': 'claude',
                'brands': [_brand('Rival', 'competitor', rank=1, first_position=5)],
            },
            {
                'timestamp': '2026-09-18T10:00:00Z',
                'provider': 'perplexity',
                'brands': [_brand('Mine', 'first_party')],
            },
        ]

        with (
            patch.object(_mod, 'query_keyword_rows', return_value=rows),
            patch.object(_mod, 'get_enabled_provider_count', return_value=4),
        ):
            result = _mod.get_visibility_metrics('hotels', {})

        assert result['prominence'] == {
            'answers': 4,
            'mentioned_answers': 3,
            'rank_1_share': 25.0,
            'top_3_share': 25.0,
            'mean_rank': 1.0,
            'mean_first_position': 15.0,
        }

    def test_uses_only_selected_persona_answers_for_prominence(self) -> None:
        rows = [
            {
                'timestamp': '2026-09-18T10:00:00Z',
                'provider': 'openai',
                'query_prompt_id': 'business',
                'brands': [_brand('Mine', 'first_party', rank=1, first_position=5)],
            },
            {
                'timestamp': '2026-09-18T10:00:00Z',
                'provider': 'gemini',
                'query_prompt_id': 'family',
                'brands': [_brand('Mine', 'first_party', rank=2, first_position=12)],
            },
        ]

        with (
            patch.object(_mod, 'query_keyword_rows', return_value=rows),
            patch.object(_mod, 'get_enabled_provider_count', return_value=4),
        ):
            result = _mod.get_visibility_metrics('hotels', {}, query_prompt_id='family')

        assert result['prominence'] == {
            'answers': 1,
            'mentioned_answers': 1,
            'rank_1_share': 0.0,
            'top_3_share': 100.0,
            'mean_rank': 2.0,
            'mean_first_position': 12.0,
        }
