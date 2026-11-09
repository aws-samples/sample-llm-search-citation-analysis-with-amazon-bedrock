"""Tests for shared.content_idea_rules: the Content Studio ideas of a scope.

The oracle is the pre-move ``api/content-studio.py`` idea code
(``_analyze_keyword_visibility`` and the three per-keyword ideas as of 2.44.0,
without the DynamoDB read), kept here until S4 lands. The shared rules must
give every keyword the same ideas; list fields are compared sorted because
the old code built them from sets.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from unittest.mock import patch

from shared.brand_visibility import classify_brand, tracked_brand_names
from shared.config import LLM_PROVIDERS
from shared.content_idea_rules import (
    MAX_IDEAS,
    configuration_idea,
    ideas_artifact,
    keyword_idea_entry,
    seasonal_suggestions,
    served_ideas,
)
from shared.dynamo_decimal import to_int
from testing.action_rule_fixtures import (
    BASE_BRAND_CONFIG,
    EXAMPLES,
    SCOPES,
    Config,
    Rows,
    latest_runs,
    without_ids,
)

_COMPARED = ('type', 'priority', 'keyword', 'current_rank', 'competitor_brands', 'content_angle')


def _oracle_ideas(keyword: str, latest: list[dict[str, Any]], config: Config) -> list[dict[str, Any]]:
    first_party, competitors = tracked_brand_names(config)
    fp_found, best, fp_providers, sentiments, comp, providers = False, 999, set(), [], [], set()
    for result in latest:
        provider = result.get('provider', '')
        providers.add(provider)
        for brand in result.get('brands', []):
            rank = to_int(brand.get('rank'), 999)
            classification = classify_brand(brand, first_party, competitors)
            if classification == 'first_party':
                fp_found, best = True, min(best, rank)
                fp_providers.add(provider)
                sentiments.append(brand.get('sentiment', 'neutral'))
            elif classification == 'competitor':
                comp.append(brand.get('name'))
    ideas = []
    if not fp_found and comp:
        ideas.append({'type': 'visibility_gap', 'priority': 'high', 'keyword': keyword, 'competitor_brands': comp[:5], 'content_angle': 'comprehensive_guide'})
    elif fp_found and best > 2 and comp:
        ideas.append({
            'type': 'ranking_improvement', 'priority': 'medium' if best > 3 else 'low', 'keyword': keyword,
            'current_rank': best, 'competitor_brands': comp[:3], 'content_angle': 'differentiation',
        })
    elif fp_found and best <= 2:
        ideas.append({
            'type': 'leadership_maintenance', 'priority': 'low', 'keyword': keyword, 'current_rank': best,
            'competitor_brands': comp[:3], 'content_angle': 'thought_leadership',
        })
    # 2.54.0: answer engines only (web-search providers write no answer).
    if fp_found and (providers - fp_providers) & set(LLM_PROVIDERS):
        ideas.append({'type': 'provider_gap', 'priority': 'medium', 'keyword': keyword, 'content_angle': 'provider_optimization'})
    if fp_found and 'negative' in sentiments:
        ideas.append({'type': 'sentiment_improvement', 'priority': 'high', 'keyword': keyword, 'current_rank': best, 'content_angle': 'reputation_management'})
    return ideas


def _compared(ideas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{key: idea[key] for key in _COMPARED if key in idea} for idea in ideas]


@EXAMPLES
@SCOPES
def test_keyword_ideas_match_the_pre_move_ideas(rows: Rows, config: Config) -> None:
    for keyword, run in latest_runs(rows).items():
        entry = keyword_idea_entry(keyword, run, config)

        assert entry is not None
        assert _compared(entry['ideas']) == _oracle_ideas(keyword, run, config)


@EXAMPLES
@SCOPES
def test_ideas_artifact_keeps_the_most_urgent_ideas(rows: Rows, config: Config) -> None:
    entries = [entry for keyword, run in latest_runs(rows).items() if (entry := keyword_idea_entry(keyword, run, config))]
    every = [idea for entry in entries for idea in entry['ideas']]

    assert len(ideas_artifact(entries)['ideas']) == min(len(every), MAX_IDEAS)


def test_served_ideas_of_an_empty_scope_ask_for_a_first_run() -> None:
    artifact = ideas_artifact([])

    assert [idea['type'] for idea in served_ideas(artifact, 'hotels')] == ['data']


def test_served_ideas_before_brand_extraction_are_citation_ideas() -> None:
    rows = [{'keyword': 'spa', 'timestamp': 't1', 'provider': 'openai', 'brands': [], 'citations': ['https://a.com/x']}]
    entry = keyword_idea_entry('spa', rows, BASE_BRAND_CONFIG)

    assert entry is not None
    assert [idea['type'] for idea in served_ideas(ideas_artifact([entry]), 'hotels')] == ['citation_opportunity']


def test_served_ideas_mint_an_id_for_every_idea() -> None:
    rows = [{'keyword': 'spa', 'timestamp': 't1', 'provider': 'openai', 'brands': [{'name': 'Parador', 'classification': 'competitor', 'rank': 1}], 'citations': []}]
    entry = keyword_idea_entry('spa', rows, BASE_BRAND_CONFIG)

    assert entry is not None
    ideas = served_ideas(ideas_artifact([entry]), 'general')
    assert len({idea['id'] for idea in ideas}) == len(ideas)


def test_seasonal_suggestions_add_this_months_industry_topic() -> None:
    with patch('shared.content_idea_rules.utc_now', return_value=datetime(2026, 12, 1, tzinfo=UTC)):
        ideas = without_ids(seasonal_suggestions(['christmas market hotel'], 'hotels'))

    assert [idea['type'] for idea in ideas] == ['seasonal_content', 'trending_topic', 'evergreen_content']


def test_configuration_idea_is_not_actionable() -> None:
    assert configuration_idea()['actionable'] is False
