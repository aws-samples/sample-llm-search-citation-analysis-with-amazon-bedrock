"""
Recommendations API

Generates actionable recommendations to improve AI visibility based on
analysis of current data. Uses rule-based logic and optionally LLM for
more sophisticated recommendations.

Recommendation Types:
- Citation gaps to fill
- Content optimization suggestions
- Prompt targeting opportunities
- Competitor insights
"""

import json
import logging
import os
import sys
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import boto3

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import success_response
from shared.brand_visibility import classify_brand, load_recent_search_results, tracked_brand_names
from shared.decorators import api_handler, validate
from shared.dynamo_decimal import to_int
from shared.llm_json import parse_llm_json
from shared.models import ModelRole, invoke_bedrock
from shared.scope_params import load_sibling_function
from shared.utils import get_brand_config, get_timestamp, recommendation_id

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = os.environ['DYNAMODB_TABLE_SEARCH_RESULTS']
CITATIONS_TABLE = os.environ['DYNAMODB_TABLE_CITATIONS']
CRAWLED_CONTENT_TABLE = os.environ['DYNAMODB_TABLE_CRAWLED_CONTENT']


@dataclass(frozen=True)
class _KeywordSnapshot:
    """What the latest analysis run of one keyword says about the tracked brands."""

    providers: set[str]
    """Every provider that answered in the run."""
    first_party_providers: set[str]
    """Providers whose answer mentioned a first-party brand."""
    first_party_best_rank: int
    """Best (lowest) rank of a first-party mention; 999 when there is none."""
    competitor_mentions: int
    """Competitor mentions across all of the run's answers."""

    @property
    def first_party_found(self) -> bool:
        """True when any answer in the run mentioned a first-party brand."""
        return bool(self.first_party_providers)


@dataclass(frozen=True)
class _KeywordFindings:
    """The per-keyword observations the recommendation rules are written against."""

    without_first_party: list[dict[str, Any]]
    """Keywords whose latest run never mentions the brand: ``{keyword, competitor_mentions}``."""
    low_rank: list[dict[str, Any]]
    """Keywords where the brand's best rank is below position 3: ``{keyword, rank, providers}``."""
    competitor_dominated: list[dict[str, Any]]
    """Keywords where competitors out-mention the brand: ``{keyword, competitor_mentions, fp_rank}``."""
    provider_gaps: dict[str, list[str]]
    """Provider -> keywords whose answer from that provider omits the brand."""


def _latest_run_snapshot(results: list[dict[str, Any]], first_party: list[str], competitors: list[str]) -> _KeywordSnapshot:
    """Reduce one keyword's SearchResults rows to what its latest run says about the tracked brands."""
    latest_ts = max(r.get('timestamp', '') for r in results)
    latest = [r for r in results if r.get('timestamp') == latest_ts]

    providers: set[str] = set()
    fp_providers: set[str] = set()
    fp_best_rank = 999
    comp_mentions = 0

    for result in latest:
        provider = result.get('provider', '')
        providers.add(provider)

        for brand in result.get('brands', []):
            rank = to_int(brand.get('rank'), 999)

            # Prefer the LLM-assigned classification. Fall back to exact
            # brand-name match (never substring — see audit item 9, 22).
            classification = classify_brand(brand, first_party, competitors)

            if classification == 'first_party':
                fp_best_rank = min(fp_best_rank, rank)
                fp_providers.add(provider)
            elif classification == 'competitor':
                comp_mentions += 1

    return _KeywordSnapshot(providers, fp_providers, fp_best_rank, comp_mentions)


def _collect_keyword_findings(
    keyword_data: dict[str, list[dict[str, Any]]], first_party: list[str], competitors: list[str]
) -> _KeywordFindings:
    """Bucket each keyword's latest run into the observations the rules act on."""
    without_first_party: list[dict[str, Any]] = []
    low_rank: list[dict[str, Any]] = []
    competitor_dominated: list[dict[str, Any]] = []
    provider_gaps: dict[str, list[str]] = defaultdict(list)

    for keyword, results in keyword_data.items():
        run = _latest_run_snapshot(results, first_party, competitors)

        # Track provider gaps
        for provider in run.providers:
            if provider not in run.first_party_providers:
                provider_gaps[provider].append(keyword)

        if not run.first_party_found:
            without_first_party.append({
                'keyword': keyword,
                'competitor_mentions': run.competitor_mentions
            })
        elif run.first_party_best_rank > 3:
            low_rank.append({
                'keyword': keyword,
                'rank': run.first_party_best_rank,
                'providers': list(run.first_party_providers)
            })

        if run.competitor_mentions > 0 and (not run.first_party_found or run.first_party_best_rank > run.competitor_mentions):
            competitor_dominated.append({
                'keyword': keyword,
                'competitor_mentions': run.competitor_mentions,
                'fp_rank': run.first_party_best_rank if run.first_party_found else None
            })

    return _KeywordFindings(without_first_party, low_rank, competitor_dominated, provider_gaps)


def _visibility_gap_rule(findings: _KeywordFindings) -> list[dict[str, Any]]:
    """Keywords where the first-party brand does not appear at all (high priority)."""
    missing = findings.without_first_party
    if not missing:
        return []
    top_gaps = sorted(missing, key=lambda x: -x['competitor_mentions'])[:5]
    return [{
        'type': 'visibility_gap',
        'priority': 'high',
        'title': f'Missing from {len(missing)} Keywords',
        'description': f'Your brand doesn\'t appear in AI responses for {len(missing)} tracked keywords where competitors are mentioned.',
        'action': 'Create content targeting these keywords and ensure your brand is mentioned on authoritative sources.',
        'keywords': [k['keyword'] for k in top_gaps],
        'impact': f'Potential to capture {sum(k["competitor_mentions"] for k in missing)} competitor mentions'
    }]


def _low_rank_rule(findings: _KeywordFindings) -> list[dict[str, Any]]:
    """Keywords where the brand appears but ranks below position 3 (medium priority)."""
    low_rank = findings.low_rank
    if not low_rank:
        return []
    return [{
        'type': 'ranking',
        'priority': 'medium',
        'title': f'Low Rankings on {len(low_rank)} Keywords',
        'description': 'Your brand appears but ranks below position 3 on these keywords.',
        'action': 'Improve content quality and get more citations from authoritative sources for these topics.',
        'keywords': [f"{k['keyword']} (rank {k['rank']})" for k in low_rank[:5]],
        'impact': 'Moving to top 3 can significantly increase visibility'
    }]


def _provider_gap_rule(findings: _KeywordFindings) -> list[dict[str, Any]]:
    """One recommendation per provider that omits the brand on at least 3 keywords (medium priority)."""
    return [
        {
            'type': 'provider_gap',
            'priority': 'medium',
            'title': f'Not Appearing on {provider.title()}',
            'description': f'Your brand doesn\'t appear in {provider.title()} responses for {len(keywords)} keywords.',
            'action': f'Research what sources {provider.title()} prefers and ensure your brand is mentioned there.',
            'keywords': keywords[:5],
            'impact': f'Expand visibility to {provider.title()} users'
        }
        for provider, keywords in findings.provider_gaps.items()
        if len(keywords) >= 3
    ]


def _competitive_rule(findings: _KeywordFindings) -> list[dict[str, Any]]:
    """Keywords where competitors are mentioned more often than the brand ranks (high priority)."""
    dominated = findings.competitor_dominated
    if not dominated:
        return []
    top_dominated = sorted(dominated, key=lambda x: -x['competitor_mentions'])[:3]
    return [{
        'type': 'competitive',
        'priority': 'high',
        'title': 'Competitors Dominating Key Terms',
        'description': 'Competitors are mentioned more frequently than your brand on important keywords.',
        'action': 'Analyze competitor content strategy and citation sources. Create superior content.',
        'keywords': [k['keyword'] for k in top_dominated],
        'impact': 'Reclaim market share in AI search results'
    }]


# Applied in this order. The priority sort in `generate_rule_based_recommendations`
# is stable, so this order is kept within each priority level.
_RULES: tuple[Callable[[_KeywordFindings], list[dict[str, Any]]], ...] = (
    _visibility_gap_rule,
    _low_rank_rule,
    _provider_gap_rule,
    _competitive_rule,
)


def generate_rule_based_recommendations(config: dict[str, Any], keywords: list[str] | None = None) -> list[dict[str, Any]]:
    """
    Generate recommendations based on rule-based analysis.

    ``keywords`` restricts the analysis to those keyword texts (a keyword
    group, for the group-scoped executive summary); by default the active
    keywords are discovered from the Keywords table.
    """
    first_party, competitors = tracked_brand_names(config)

    if not first_party:
        return [{
            'type': 'configuration',
            'priority': 'high',
            'title': 'Configure First-Party Brands',
            'description': 'Add your brand names to the configuration to enable visibility tracking and recommendations.',
            'action': 'Go to Settings > Brand Configuration and add your brands under "First Party"',
            'impact': 'Required for all other recommendations'
        }]

    # Limit to 20 keywords for performance
    items = load_recent_search_results(dynamodb, SEARCH_RESULTS_TABLE, max_keywords=20, keywords=keywords)

    if not items:
        return [{
            'type': 'data',
            'priority': 'high',
            'title': 'Run Your First Analysis',
            'description': 'No search data found. Run an analysis to start tracking your AI visibility.',
            'action': 'Go to Run Analysis and trigger a new analysis',
            'impact': 'Required to generate insights'
        }]

    # Group by keyword
    keyword_data = defaultdict(list)
    for item in items:
        keyword_data[item.get('keyword', '')].append(item)

    findings = _collect_keyword_findings(keyword_data, first_party, competitors)
    recommendations = [rec for rule in _RULES for rec in rule(findings)]

    # General best practices, when the data-driven rules found little to say
    if len(recommendations) < 3:
        recommendations.append({
            'type': 'best_practice',
            'priority': 'low',
            'title': 'Maintain Citation Freshness',
            'description': 'Regularly update your content and ensure citations remain current.',
            'action': 'Review and refresh content quarterly. Monitor for broken links.',
            'impact': 'Sustained visibility over time'
        })

    # Sort by priority
    priority_order = {'high': 0, 'medium': 1, 'low': 2}
    recommendations.sort(key=lambda x: priority_order.get(x.get('priority', 'low'), 2))

    return recommendations


def generate_llm_recommendations(config: dict[str, Any], context: str) -> list[dict[str, Any]]:
    """
    Generate recommendations using LLM for more sophisticated analysis.
    """
    try:
        prompt = f"""Analyze this AI visibility data and provide 3-5 specific, actionable recommendations.

Context:
{context}

Brand Configuration:
- First Party Brands: {config.get('tracked_brands', {}).get('first_party', [])}
- Competitors: {config.get('tracked_brands', {}).get('competitors', [])}
- Industry: {config.get('industry', 'general')}

Provide recommendations in this JSON format:
[
  {{
    "type": "category",
    "priority": "high/medium/low",
    "title": "Short title",
    "description": "Detailed description",
    "action": "Specific action to take",
    "impact": "Expected impact"
  }}
]

Focus on:
1. Quick wins that can improve visibility immediately
2. Strategic moves to outperform competitors
3. Content and citation opportunities
4. Provider-specific optimizations"""

        content = invoke_bedrock(prompt, ModelRole.ANALYSIS, max_tokens=2000)

        # Parse JSON array via shared helper; with expect="array" it yields a list or None.
        parsed = parse_llm_json(content, expect="array")
        if isinstance(parsed, list):
            return parsed

    except Exception:
        logger.exception("LLM recommendation error")

    return []


def _annotate_with_status(recommendations: list[dict[str, Any]]) -> None:
    """
    Mutate each recommendation in place to add `id` + persisted status.

    The id is the same hash that `recommendation-status.py` looks up in
    DynamoDB. The status fields are merged in only when the status
    table is configured (production); otherwise every recommendation
    gets `status: 'new'` so the response shape stays consistent for
    the frontend.

    Failure to load the status table is non-fatal: the recommendations
    are still surfaced, just without per-row tracking. The failure is
    logged with its traceback.
    """
    for rec in recommendations:
        rec['id'] = recommendation_id(rec)

    rec_ids = [r['id'] for r in recommendations]
    statuses: dict[str, dict[str, Any]] = {}

    status_table = os.environ.get('RECOMMENDATION_STATUS_TABLE')
    if status_table and rec_ids:
        try:
            # Loaded lazily, and the way the report aggregators load their
            # sibling KPI functions: recommendation-status.py is hyphen-named,
            # and this module's other tests run without the status table.
            list_statuses = load_sibling_function(__file__, 'recommendation-status.py', 'list_statuses', '_for_join')
            statuses = list_statuses(rec_ids)
        except Exception:
            logger.exception('recommendation status join skipped')

    for rec in recommendations:
        row = statuses.get(rec['id'])
        rec['status'] = row.get('status', 'new') if row else 'new'
        if row:
            for key in ('updated_at', 'completed_at', 'notes',
                        'related_keyword', 'related_content_id'):
                if key in row:
                    rec[key] = row[key]


@api_handler
@validate({
    'use_llm': {'type': bool, 'default': False},
    'keyword': {'type': str, 'max_length': 500}
})
def handler(event: dict[str, Any], context: Any, use_llm: bool = False, keyword: str | None = None) -> dict[str, Any]:
    """
    API handler for recommendations.

    Query params:
        - use_llm: Whether to use LLM for enhanced recommendations (default: false)
        - keyword: Focus recommendations on specific keyword (optional)
    """
    config = get_brand_config()

    # Generate rule-based recommendations
    recommendations = generate_rule_based_recommendations(config)

    # Annotate each recommendation with a deterministic id and (when the
    # status table is configured) the persisted action-tracking state.
    # Done here rather than inside `generate_rule_based_recommendations`
    # so the rule generator stays a pure data shaper. The id is computed
    # from `type + title + sorted keywords` so it survives list
    # regeneration as long as those fields don't change.
    _annotate_with_status(recommendations)

    # Optionally enhance with LLM
    llm_recommendations = []
    if use_llm and recommendations:
        context_str = json.dumps(recommendations[:5], indent=2)
        llm_recommendations = generate_llm_recommendations(config, context_str)

    result = {
        'generated_at': get_timestamp(),
        'recommendations': recommendations,
        'llm_enhanced': llm_recommendations if llm_recommendations else None,
        'total_count': len(recommendations),
        'by_priority': {
            'high': len([r for r in recommendations if r.get('priority') == 'high']),
            'medium': len([r for r in recommendations if r.get('priority') == 'medium']),
            'low': len([r for r in recommendations if r.get('priority') == 'low'])
        }
    }

    return success_response(result, event)
