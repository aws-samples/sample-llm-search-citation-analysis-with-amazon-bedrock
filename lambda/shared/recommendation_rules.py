"""
The rule-based recommendations of the Action Center (``GET /api/recommendations``).

Each keyword's **latest run** is reduced to a *finding* (which providers
answered, which named a first-party brand, the first party's best rank, the
competitor mentions); the rules then read the findings of a whole scope:

- ``visibility_gap`` (high): keywords whose run never names the brand;
- ``ranking`` (medium): keywords where its best rank is below 3rd;
- ``provider_gap`` (medium): one per AI engine omitting it on 3+ keywords;
- ``competitive`` (high): keywords where competitors out-mention its rank;
- ``best_practice`` (low) when the rules found fewer than three things to say.

The rules were in ``api/get-recommendations.py``; the handler's live path,
the ``actions`` partial and the ``recommendations`` artifact share them here.
Findings are taken in the scope's keyword order (case-insensitive), so a
scope's list never depends on the order its keywords were merged in.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from shared import scope_order
from shared.brand_visibility import classify_brand, tracked_brand_names
from shared.config import LLM_PROVIDERS, provider_display_name
from shared.constants import priority_rank

#: Keywords each rule names (the counts in its title cover them all).
_LISTED = 5
_LISTED_DOMINATED = 3
#: Keywords a provider must omit the brand on before it is a ``provider_gap``.
PROVIDER_GAP_MIN_KEYWORDS = 3

CONFIGURATION_RECOMMENDATION: dict[str, Any] = {
    'type': 'configuration',
    'priority': 'high',
    'title': 'Configure First-Party Brands',
    'description': 'Add your brand names to the configuration to enable visibility tracking and recommendations.',
    'action': 'Go to Settings > Brand Configuration and add your brands under "First Party"',
    'impact': 'Required for all other recommendations',
}

NO_DATA_RECOMMENDATION: dict[str, Any] = {
    'type': 'data',
    'priority': 'high',
    'title': 'Run Your First Analysis',
    'description': 'No search data found. Run an analysis to start tracking your AI visibility.',
    'action': 'Go to Run Analysis and trigger a new analysis',
    'impact': 'Required to generate insights',
}

BEST_PRACTICE_RECOMMENDATION: dict[str, Any] = {
    'type': 'best_practice',
    'priority': 'low',
    'title': 'Maintain Citation Freshness',
    'description': 'Regularly update your content and ensure citations remain current.',
    'action': 'Review and refresh content quarterly. Monitor for broken links.',
    'impact': 'Sustained visibility over time',
}


def keyword_finding(keyword: str, rows: Sequence[Mapping[str, Any]], config: Mapping[str, Any]) -> dict[str, Any] | None:
    """What one keyword's latest run (``rows``) says about the tracked brands; ``None`` without rows.

    Prefers the LLM-assigned classification and falls back to an exact name
    match (``brand_visibility.classify_brand``).
    """
    if not rows:
        return None
    first_party, competitors = tracked_brand_names(dict(config))
    fp_providers: set[str] = set()
    fp_best_rank = scope_order.UNRANKED
    competitor_mentions = 0
    providers = {str(row.get('provider', '')) for row in rows}
    for provider, brand in scope_order.brand_mentions(rows):
        classification = classify_brand(dict(brand), first_party, competitors)
        if classification == 'first_party':
            fp_best_rank = min(fp_best_rank, scope_order.brand_rank(brand))
            fp_providers.add(provider)
        elif classification == 'competitor':
            competitor_mentions += 1
    return {
        'keyword': keyword,
        'providers': sorted(providers),
        'first_party_providers': sorted(fp_providers),
        'first_party_best_rank': fp_best_rank,
        'competitor_mentions': competitor_mentions,
    }


def finding_order(finding: Mapping[str, Any]) -> tuple[str, str]:
    """The scope's keyword order (case-insensitive, then exact)."""
    return scope_order.keyword_order(str(finding['keyword']))


@dataclass(frozen=True)
class _ScopeFindings:
    without_first_party: list[dict[str, Any]]
    low_rank: list[dict[str, Any]]
    competitor_dominated: list[dict[str, Any]]
    provider_gaps: dict[str, list[str]]


def _bucket(finding: Mapping[str, Any], scope: _ScopeFindings) -> None:
    keyword = finding['keyword']
    fp_providers = set(finding['first_party_providers'])
    found = bool(fp_providers)
    best = int(finding['first_party_best_rank'])
    mentions = int(finding['competitor_mentions'])
    for provider in finding['providers']:
        if provider not in fp_providers:
            scope.provider_gaps[provider].append(keyword)
    if not found:
        scope.without_first_party.append({'keyword': keyword, 'competitor_mentions': mentions})
    elif best > 3:
        scope.low_rank.append({'keyword': keyword, 'rank': best, 'providers': list(finding['first_party_providers'])})
    if mentions > 0 and (not found or best > mentions):
        scope.competitor_dominated.append({'keyword': keyword, 'competitor_mentions': mentions, 'fp_rank': best if found else None})


def _scope_findings(findings: Iterable[Mapping[str, Any]]) -> _ScopeFindings:
    scope = _ScopeFindings([], [], [], defaultdict(list))
    for finding in sorted(findings, key=finding_order):
        _bucket(finding, scope)
    return scope


def _visibility_gap_rule(findings: _ScopeFindings) -> list[dict[str, Any]]:
    missing = findings.without_first_party
    if not missing:
        return []
    top_gaps = sorted(missing, key=lambda x: -x['competitor_mentions'])[:_LISTED]
    return [{
        'type': 'visibility_gap',
        'priority': 'high',
        'title': f'Missing from {len(missing)} Keywords',
        'description': f'Your brand doesn\'t appear in AI responses for {len(missing)} tracked keywords where competitors are mentioned.',
        'action': 'Create content targeting these keywords and ensure your brand is mentioned on authoritative sources.',
        'keywords': [k['keyword'] for k in top_gaps],
        'impact': f'Potential to capture {sum(k["competitor_mentions"] for k in missing)} competitor mentions',
    }]


def _low_rank_rule(findings: _ScopeFindings) -> list[dict[str, Any]]:
    low_rank = findings.low_rank
    if not low_rank:
        return []
    return [{
        'type': 'ranking',
        'priority': 'medium',
        'title': f'Low Rankings on {len(low_rank)} Keywords',
        'description': 'Your brand appears but ranks below position 3 on these keywords.',
        'action': 'Improve content quality and get more citations from authoritative sources for these topics.',
        'keywords': [f"{k['keyword']} (rank {k['rank']})" for k in low_rank[:_LISTED]],
        'impact': 'Moving to top 3 can significantly increase visibility',
    }]


def _provider_gap_rule(findings: _ScopeFindings) -> list[dict[str, Any]]:
    """One recommendation per AI engine that omits the brand on ``PROVIDER_GAP_MIN_KEYWORDS`` keywords or more.

    Only answer engines (``LLM_PROVIDERS``) count: web-search providers return
    links, not answers, so a brand cannot appear in them (and they are not in
    the KPIs). Engines with the most gaps come first, then by id, so the cards
    keep one order between page loads.
    """
    gaps = sorted(
        ((provider, keywords) for provider, keywords in findings.provider_gaps.items()
         if provider in LLM_PROVIDERS and len(keywords) >= PROVIDER_GAP_MIN_KEYWORDS),
        key=lambda gap: (-len(gap[1]), gap[0]),
    )
    return [
        {
            'type': 'provider_gap',
            'priority': 'medium',
            # The engine id: `recommendation_id` hashes it, so a saved status keeps matching when the title wording changes.
            'provider': provider,
            'title': f'Not Appearing on {provider_display_name(provider)}',
            'description': f'Your brand doesn\'t appear in {provider_display_name(provider)} answers for {len(keywords)} keywords.',
            'action': f'Research what sources {provider_display_name(provider)} prefers and ensure your brand is mentioned there.',
            'keywords': keywords[:_LISTED],
            'impact': f'Expand visibility to {provider_display_name(provider)} users',
        }
        for provider, keywords in gaps
    ]


def _competitive_rule(findings: _ScopeFindings) -> list[dict[str, Any]]:
    dominated = findings.competitor_dominated
    if not dominated:
        return []
    top_dominated = sorted(dominated, key=lambda x: -x['competitor_mentions'])[:_LISTED_DOMINATED]
    return [{
        'type': 'competitive',
        'priority': 'high',
        'title': 'Competitors Dominating Key Terms',
        'description': 'Competitors are mentioned more frequently than your brand on important keywords.',
        'action': 'Analyze competitor content strategy and citation sources. Create superior content.',
        'keywords': [k['keyword'] for k in top_dominated],
        'impact': 'Reclaim market share in AI search results',
    }]


# Applied in this order; the priority sort is stable, so the order holds within a priority.
_RULES: tuple[Callable[[_ScopeFindings], list[dict[str, Any]]], ...] = (
    _visibility_gap_rule,
    _low_rank_rule,
    _provider_gap_rule,
    _competitive_rule,
)


def rule_recommendations(findings: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Every recommendation the rules make for a scope's findings (any order), most urgent first.

    No finding at all answers the "run your first analysis" recommendation;
    the caller answers the configuration one when no first-party brand is set.
    """
    pooled = list(findings)
    if not pooled:
        return [dict(NO_DATA_RECOMMENDATION)]
    scope = _scope_findings(pooled)
    recommendations = [rec for rule in _RULES for rec in rule(scope)]
    if len(recommendations) < 3:
        recommendations.append(dict(BEST_PRACTICE_RECOMMENDATION))
    recommendations.sort(key=lambda rec: priority_rank(rec.get('priority')))
    return recommendations


def impact_order(finding: Mapping[str, Any]) -> tuple[int, int, int, str, str]:
    """A keyword's place in the LLM prompt: the brand missing first, then the most competitor mentions, the worst rank."""
    missing = 0 if finding['first_party_providers'] else 1
    return -missing, -int(finding['competitor_mentions']), -int(finding['first_party_best_rank']), *finding_order(finding)


def highest_impact_keywords(findings: Iterable[Mapping[str, Any]], limit: int) -> list[str]:
    """The ``limit`` keywords a recommendation would move most (``impact_order``)."""
    return [str(finding['keyword']) for finding in sorted(findings, key=impact_order)[:limit]]


def by_priority(recommendations: Iterable[Mapping[str, Any]]) -> dict[str, int]:
    """How many recommendations each priority has."""
    counts = {'high': 0, 'medium': 0, 'low': 0}
    for rec in recommendations:
        priority = rec.get('priority')
        if priority in counts:
            counts[str(priority)] += 1
    return counts


__all__ = [
    'CONFIGURATION_RECOMMENDATION',
    'NO_DATA_RECOMMENDATION',
    'by_priority',
    'finding_order',
    'highest_impact_keywords',
    'impact_order',
    'keyword_finding',
    'rule_recommendations',
]
