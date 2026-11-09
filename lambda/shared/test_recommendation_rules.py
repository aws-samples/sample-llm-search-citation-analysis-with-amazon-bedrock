"""Tests for shared.recommendation_rules: the rule-based Action Center list.

The oracle is the pre-move ``api/get-recommendations.py`` rule set
(``_latest_run_snapshot``, ``_collect_keyword_findings`` and the four rules
as of 2.44.0, without the DynamoDB read), kept here until S4 lands. Fed the
keywords in the scope's order, it must give the same recommendations.
"""

from __future__ import annotations

from typing import Any

from hypothesis import given
from hypothesis import strategies as st

from shared.brand_visibility import classify_brand, tracked_brand_names
from shared.config import LLM_PROVIDERS
from shared.constants import priority_rank
from shared.dynamo_decimal import to_int
from shared.recommendation_rules import (
    NO_DATA_RECOMMENDATION,
    by_priority,
    highest_impact_keywords,
    keyword_finding,
    rule_recommendations,
)
from testing import action_rule_fixtures as fx
from testing.kpi_row_strategies import search_rows


def _oracle_findings(keyword_data: dict[str, list[dict[str, Any]]], config: fx.Config) -> dict[str, Any]:
    first_party, competitors = tracked_brand_names(config)
    found: dict[str, Any] = {'without': [], 'low': [], 'dominated': [], 'gaps': {}}
    for keyword, latest in keyword_data.items():
        fp_providers, best, comp = set(), 999, 0
        providers = {result.get('provider', '') for result in latest}
        for provider, brand in [(result.get('provider', ''), brand) for result in latest for brand in result.get('brands', [])]:
            classification = classify_brand(brand, first_party, competitors)
            if classification == 'first_party':
                best = min(best, to_int(brand.get('rank'), 999))
                fp_providers.add(provider)
            elif classification == 'competitor':
                comp += 1
        for provider in sorted(providers):
            if provider not in fp_providers:
                found['gaps'].setdefault(provider, []).append(keyword)
        if not fp_providers:
            found['without'].append({'keyword': keyword, 'competitor_mentions': comp})
        elif best > 3:
            found['low'].append({'keyword': keyword, 'rank': best})
        if comp > 0 and (not fp_providers or best > comp):
            found['dominated'].append({'keyword': keyword, 'competitor_mentions': comp})
    return found


def _oracle_recommendations(keyword_data: dict[str, list[dict[str, Any]]], config: fx.Config) -> list[dict[str, Any]]:
    if not keyword_data:
        return [dict(NO_DATA_RECOMMENDATION)]
    found = _oracle_findings(keyword_data, config)
    recs: list[dict[str, Any]] = []
    if found['without']:
        top = sorted(found['without'], key=lambda x: -x['competitor_mentions'])[:5]
        recs.append({'type': 'visibility_gap', 'keywords': [k['keyword'] for k in top], 'count': len(found['without'])})
    if found['low']:
        recs.append({'type': 'ranking', 'keywords': [f"{k['keyword']} (rank {k['rank']})" for k in found['low'][:5]], 'count': len(found['low'])})
    recs.extend(
        {'type': 'provider_gap', 'keywords': keywords[:5], 'count': len(keywords), 'provider': provider}
        # 2.54.0: answer engines only (web-search providers write no answer).
        for provider, keywords in found['gaps'].items() if provider in LLM_PROVIDERS and len(keywords) >= 3
    )
    if found['dominated']:
        top = sorted(found['dominated'], key=lambda x: -x['competitor_mentions'])[:3]
        recs.append({'type': 'competitive', 'keywords': [k['keyword'] for k in top], 'count': len(found['dominated'])})
    return recs


def _shape(rec: dict[str, Any]) -> tuple[str, tuple[str, ...]]:
    return str(rec['type']), tuple(rec.get('keywords') or ())


def _scope_order(rows: fx.Rows) -> dict[str, list[dict[str, Any]]]:
    runs = fx.latest_runs(rows)
    return {keyword: runs[keyword] for keyword in sorted(runs, key=lambda keyword: (keyword.casefold(), keyword))}


def _findings(runs: dict[str, list[dict[str, Any]]], config: fx.Config) -> list[dict[str, Any]]:
    return [finding for keyword, run in runs.items() if (finding := keyword_finding(keyword, run, config))]


@fx.EXAMPLES
@fx.SCOPES
def test_rule_recommendations_name_the_pre_move_keywords(rows: fx.Rows, config: fx.Config) -> None:
    runs = _scope_order(rows)
    recommendations = [rec for rec in rule_recommendations(_findings(runs, config)) if rec['type'] != 'best_practice']

    assert sorted(map(_shape, recommendations)) == sorted(map(_shape, _oracle_recommendations(runs, config)))


@fx.EXAMPLES
@fx.SCOPES
def test_rule_recommendations_add_the_best_practice_below_three(rows: fx.Rows, config: fx.Config) -> None:
    runs = _scope_order(rows)
    oracle = _oracle_recommendations(runs, config)
    expected = 1 if runs and len(oracle) < 3 else 0

    assert [rec['type'] for rec in rule_recommendations(_findings(runs, config))].count('best_practice') == expected


@fx.EXAMPLES
@given(rows=search_rows(max_size=40), config=fx.BRAND_CONFIGS, seed=st.randoms())
def test_rule_recommendations_ignore_the_order_findings_arrive_in(rows: fx.Rows, config: fx.Config, seed: Any) -> None:
    findings = _findings(fx.latest_runs(rows), config)
    shuffled = fx.reordered(findings, seed)

    assert rule_recommendations(shuffled) == rule_recommendations(findings)


@fx.EXAMPLES
@fx.SCOPES
def test_rule_recommendations_are_sorted_by_priority(rows: fx.Rows, config: fx.Config) -> None:
    ranks = [priority_rank(rec['priority']) for rec in rule_recommendations(_findings(fx.latest_runs(rows), config))]

    assert ranks == sorted(ranks)


def test_no_finding_answers_the_run_your_first_analysis_recommendation() -> None:
    assert rule_recommendations([]) == [NO_DATA_RECOMMENDATION]


def test_keyword_finding_is_none_without_rows() -> None:
    assert keyword_finding('spa', [], fx.BASE_BRAND_CONFIG) is None


def test_highest_impact_keywords_put_the_missing_brand_first() -> None:
    findings = [
        {'keyword': 'ranked', 'first_party_providers': ['openai'], 'competitor_mentions': 9, 'first_party_best_rank': 2},
        {'keyword': 'missing', 'first_party_providers': [], 'competitor_mentions': 1, 'first_party_best_rank': 999},
    ]

    assert highest_impact_keywords(findings, 1) == ['missing']


def test_by_priority_counts_each_level() -> None:
    assert by_priority([{'priority': 'high'}, {'priority': 'low'}, {'priority': 'high'}]) == {'high': 2, 'medium': 0, 'low': 1}
