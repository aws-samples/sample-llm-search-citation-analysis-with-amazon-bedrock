"""
Prompt Insights API

Analyzes which prompts/keywords lead to brand mentions and provides
insights on winning vs losing prompts.

Features:
- Prompt-to-brand correlation
- Winning prompts (high brand visibility)
- Losing prompts (low/no brand visibility)
- Prompt opportunities (keywords where competitors appear but you don't)
"""

import logging
import os
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import success_response, validation_error
from shared.decorators import api_handler, validate
from shared.dynamo_decimal import to_int
from shared.search_results import latest_run, scan_keyword_texts, search_results_table_name
from shared.utils import get_brand_config

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# The results table is required; the Keywords table is optional (no table -> no keywords).
SEARCH_RESULTS_TABLE = search_results_table_name()
KEYWORDS_TABLE = os.environ.get('DYNAMODB_TABLE_KEYWORDS')

# Rank sentinel for a brand side that was never mentioned; reported as `best_rank: None`.
_UNRANKED = 999


def get_all_keywords() -> list[str]:
    """Get all tracked keywords from Keywords table (small table, scan is acceptable).

    Any failure of the scan is logged with its traceback and reported as "no
    keywords", which the handler turns into a 400.
    """
    if not KEYWORDS_TABLE:
        return []
    try:
        # Keywords table is small (typically <100 items); the projected scan
        # is capped so it cannot run away.
        return scan_keyword_texts(dynamodb.Table(KEYWORDS_TABLE))
    except Exception:
        logger.exception("Error getting keywords")
        return []


def _fetch_recent_results(keywords: list[str]) -> list[dict[str, Any]]:
    """Query the 20 most recent SearchResults rows for each of the first 50 keywords.

    Querying by partition key is much more efficient than a scan. A keyword
    whose query fails is logged (with its traceback) and skipped so one bad
    partition cannot empty the whole view.
    """
    table = dynamodb.Table(SEARCH_RESULTS_TABLE)
    items: list[dict[str, Any]] = []
    for keyword in keywords[:50]:  # Limit to 50 keywords for performance
        try:
            response = table.query(
                KeyConditionExpression=Key('keyword').eq(keyword),
                ScanIndexForward=False,  # Most recent first
                Limit=20  # Get recent results per keyword
            )
            items.extend(response.get('Items', []))
        except Exception:
            logger.exception(f"Error querying keyword {keyword!r}")

    logger.info(f"Queried {len(items)} total items across {len(keywords)} keywords")
    return items


def _group_by_keyword(items: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Bucket rows by keyword, keeping the order in which keywords were first seen."""
    keyword_results: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in items:
        keyword_results[item.get('keyword', '')].append(item)

    logger.info(f"Found {len(keyword_results)} unique keywords")
    return keyword_results


@dataclass
class _BrandPresence:
    """Running tally of one brand side (first-party or competitors) across a keyword's latest run."""

    mentions: int = 0
    best_rank: int = _UNRANKED
    providers: set[str] = field(default_factory=set)

    def record(self, provider: str, brand: dict[str, Any]) -> None:
        """Count one brand entry from `provider`'s response."""
        self.mentions += to_int(brand.get('mention_count'), 1)
        self.best_rank = min(self.best_rank, to_int(brand.get('rank'), _UNRANKED))
        self.providers.add(provider)

    def coverage(self, total_providers: int) -> float:
        """Share of the run's providers that mentioned this side (0 for an empty run)."""
        return len(self.providers) / total_providers if total_providers > 0 else 0

    def as_dict(self, total_providers: int) -> dict[str, Any]:
        """The per-side block of a prompt record."""
        return {
            'mentions': self.mentions,
            'best_rank': self.best_rank if self.best_rank < _UNRANKED else None,
            'provider_coverage': round(self.coverage(total_providers) * 100, 1),
            'providers': list(self.providers),
        }


def _tally_brand_presence(latest_results: list[dict[str, Any]]) -> tuple[_BrandPresence, _BrandPresence]:
    """Tally first-party and competitor mentions across one run, using the LLM-assigned classification."""
    first_party = _BrandPresence()
    competitors = _BrandPresence()
    for result in latest_results:
        provider = result.get('provider', '')
        for brand in result.get('brands', []):
            classification = brand.get('classification', 'other')
            if classification == 'first_party':
                first_party.record(provider, brand)
            elif classification == 'competitor':
                competitors.record(provider, brand)
    return first_party, competitors


def _classify_prompt(first_party: _BrandPresence, competitors: _BrandPresence, total_providers: int) -> dict[str, Any]:
    """The prompt's `status` plus the score field that status carries.

    Winning: first-party in the top 3 (`score`). Opportunity: competitors appear
    but first-party does not (`opportunity_score`). Losing: first-party absent or
    ranked below 5 (`improvement_potential`). Neutral: first-party at rank 4-5,
    unscored; it is listed among the winning prompts.
    """
    fp_provider_coverage = first_party.coverage(total_providers)

    if first_party.mentions > 0 and first_party.best_rank <= 3:
        score = (
            (fp_provider_coverage * 50) +
            ((4 - first_party.best_rank) / 3 * 30) +
            (min(first_party.mentions, 10) / 10 * 20)
        )
        return {'status': 'winning', 'score': round(score, 1)}

    if first_party.mentions == 0 and competitors.mentions > 0:
        opportunity_score = (
            (competitors.coverage(total_providers) * 50) +
            (min(competitors.mentions, 10) / 10 * 50)
        )
        return {'status': 'opportunity', 'opportunity_score': round(opportunity_score, 1)}

    if first_party.mentions == 0 or first_party.best_rank > 5:
        improvement_potential = (
            100 - (fp_provider_coverage * 50) -
            ((10 - min(first_party.best_rank, 10)) / 10 * 50)
        )
        return {'status': 'losing', 'improvement_potential': round(improvement_potential, 1)}

    return {'status': 'neutral'}


def _analyze_keyword(keyword: str, results: list[dict[str, Any]]) -> dict[str, Any]:
    """Build one prompt record from the latest run of a keyword's search results."""
    latest_ts, latest_results = latest_run(results)
    total_providers = len(latest_results)
    first_party, competitors = _tally_brand_presence(latest_results)
    return {
        'keyword': keyword,
        'timestamp': latest_ts,
        'first_party': first_party.as_dict(total_providers),
        'competitors': competitors.as_dict(total_providers),
        'total_providers': total_providers,
        **_classify_prompt(first_party, competitors, total_providers),
    }


def _rank_prompts(prompts: list[dict[str, Any]]) -> dict[str, Any]:
    """Bucket prompts by status, rank each bucket by its score, and shape the insights payload.

    Neutral prompts sit in the winning bucket (unscored, so after every scored
    win) and count toward the win rate. Each bucket is cut to its top 20 while
    the summary counts every prompt.
    """
    winning_prompts = [p for p in prompts if p['status'] in ('winning', 'neutral')]
    losing_prompts = [p for p in prompts if p['status'] == 'losing']
    opportunity_prompts = [p for p in prompts if p['status'] == 'opportunity']

    winning_prompts.sort(key=lambda x: x.get('score', 0), reverse=True)
    losing_prompts.sort(key=lambda x: x.get('improvement_potential', 0), reverse=True)
    opportunity_prompts.sort(key=lambda x: x.get('opportunity_score', 0), reverse=True)

    return {
        'total_prompts_analyzed': len(prompts),
        'winning_prompts': winning_prompts[:20],  # Top 20
        'losing_prompts': losing_prompts[:20],
        'opportunity_prompts': opportunity_prompts[:20],
        'summary': {
            'winning_count': len(winning_prompts),
            'losing_count': len(losing_prompts),
            'opportunity_count': len(opportunity_prompts),
            'win_rate': round(len(winning_prompts) / len(prompts) * 100, 1) if prompts else 0
        }
    }


def analyze_prompt_brand_correlation(config: dict[str, Any]) -> dict[str, Any]:
    """
    Analyze correlation between prompts and brand mentions.

    Returns insights on:
    - Which prompts trigger first-party brand mentions
    - Which prompts favor competitors
    - Opportunities where competitors appear but first-party doesn't
    """
    # Get tracked brands — only first_party is needed to gate execution below.
    # Classification is taken from brand.get('classification') per-mention in
    # _tally_brand_presence, so the lowercase lists that used to drive substring
    # matching are no longer needed here.
    tracked_brands = config.get("tracked_brands", {})
    first_party = [b.lower() for b in tracked_brands.get("first_party", [])]

    if not first_party:
        return {"error": "No first-party brands configured"}

    # Get keywords from Keywords table (small, efficient) then query SearchResults by keyword
    keywords = get_all_keywords()

    if not keywords:
        return {"error": "No keywords configured"}

    keyword_results = _group_by_keyword(_fetch_recent_results(keywords))
    prompts = [_analyze_keyword(keyword, results) for keyword, results in keyword_results.items()]
    return _rank_prompts(prompts)


@api_handler
@validate({
    'type': {'type': str, 'choices': ['winning', 'losing', 'opportunities', 'all'], 'default': 'all'},
    'limit': {'type': int, 'min': 1, 'max': 100, 'default': 20}
})
def handler(event: dict[str, Any], context: Any, type: str = 'all', limit: int = 20) -> dict[str, Any]:
    """
    API handler for prompt insights.

    Query params:
        - type: 'winning', 'losing', 'opportunities', or 'all' (default: all)
        - limit: Number of results per category (default: 20)
    """
    config = get_brand_config()
    insights = analyze_prompt_brand_correlation(config)
    if 'error' in insights:
        # A missing prerequisite (no first-party brand, no keywords) is the
        # caller's configuration to fix, so it gets 400 with the actual reason.
        return validation_error(insights['error'], event)

    # Filter by type if specified
    if type == 'winning':
        insights = {
            'winning_prompts': insights['winning_prompts'][:limit],
            'summary': insights['summary']
        }
    elif type == 'losing':
        insights = {
            'losing_prompts': insights['losing_prompts'][:limit],
            'summary': insights['summary']
        }
    elif type == 'opportunities':
        insights = {
            'opportunity_prompts': insights['opportunity_prompts'][:limit],
            'summary': insights['summary']
        }
    else:
        # Apply limit to all categories
        insights['winning_prompts'] = insights['winning_prompts'][:limit]
        insights['losing_prompts'] = insights['losing_prompts'][:limit]
        insights['opportunity_prompts'] = insights['opportunity_prompts'][:limit]

    return success_response(insights, event)
