"""
Visibility Metrics API

Calculates and returns visibility scores and share of voice metrics
for brands across AI providers.

Metrics:
- Visibility Score: 0-100 score based on mentions, rankings, and provider coverage
- Share of Voice: % of total brand mentions that belong to each brand
- Provider Coverage: Which AI engines mention the brand
- Trend Direction: Improving, declining, or stable

Scope (2.4.0): exactly one of ``keyword=`` (one keyword, unchanged response),
``group_id=`` (every active keyword in a keyword group) or ``keyword_ids=``
(comma-separated keyword ids). Group and id scopes answer a *group summary*:
the per-keyword metrics are computed in parallel with the same formulas and
averaged, with a per-keyword breakdown and a cross-keyword brand ranking.
"""

import logging
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import boto3
from botocore.config import Config

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import success_response
from shared.constants import UNRANKED_SENTINEL
from shared.decorators import api_handler, validate
from shared.dynamo_decimal import to_int
from shared.providers import get_enabled_provider_count
from shared.scope_params import (
    SCOPE_QUERY_PARAMS,
    ReportScope,
    keywords_table_name,
    query_keyword_rows,
    scope_from_request,
)
from shared.utils import get_brand_config
from shared.visibility_score import (
    calculate_share_of_voice,
    calculate_visibility_score,
    mean,
    sentiment_to_score,
    summarize_group_visibility,
)

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# The group summary fans out one Query per keyword; give boto3 enough pooled
# connections for the thread pool below.
dynamodb = boto3.resource('dynamodb', config=Config(max_pool_connections=50))

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = os.environ['DYNAMODB_TABLE_SEARCH_RESULTS']
KEYWORDS_TABLE = keywords_table_name()

# Parallel per-keyword fan-out for group scopes, and the most keywords one
# group summary covers (the `keyword_ids` cap; keeps the request inside the
# 29s API budget with projected queries).
_SCOPE_MAX_WORKERS = 10
_SCOPE_KEYWORDS_CAP = 100

# Only the fields the metrics use; the full LLM response text stays in the
# table. Without this a 60-keyword group would pull megabytes of prose
# through a 29s API request.
_METRICS_PROJECTION = '#ts, provider, brands, query_prompt_id'


def get_visibility_metrics(
    keyword: str,
    config: dict[str, Any],
    query_prompt_id: str | None = None,
    total_providers: int | None = None,
) -> dict[str, Any]:
    """Calculate visibility metrics for a keyword, optionally filtered by persona."""
    items = query_keyword_rows(dynamodb.Table(SEARCH_RESULTS_TABLE), keyword, _METRICS_PROJECTION)

    if not items:
        return {"error": "No data found for keyword"}

    # Aggregate brand data
    brand_data = {}  # brand_name -> {providers, mentions, ranks, sentiments}
    total_mentions = 0

    # Get latest timestamp for current metrics
    latest_timestamp = max(item.get('timestamp', '') for item in items)
    latest_items = [item for item in items if item.get('timestamp') == latest_timestamp]

    # Filter by persona if specified
    if query_prompt_id:
        latest_items = [item for item in latest_items if item.get('query_prompt_id', 'default') == query_prompt_id]

    for item in latest_items:
        provider = item.get('provider', 'unknown')
        brands = item.get('brands', [])

        for brand in brands:
            name = brand.get('name', '').lower()
            if not name:
                continue

            # Use the classification from brand extraction if available
            brand_classification = brand.get('classification', 'other')

            if name not in brand_data:
                brand_data[name] = {
                    'original_name': brand.get('name'),
                    'classification': brand_classification,  # Store original classification
                    'providers': set(),
                    'mentions': 0,
                    'ranks': [],
                    'sentiments': []
                }

            brand_data[name]['providers'].add(provider)
            mention_count = to_int(brand.get('mention_count'), 1)
            brand_data[name]['mentions'] += mention_count
            brand_data[name]['ranks'].append(to_int(brand.get('rank'), UNRANKED_SENTINEL))
            if brand.get('sentiment'):
                brand_data[name]['sentiments'].append(sentiment_to_score(brand.get('sentiment')))

            total_mentions += mention_count

    # Get enabled provider count for visibility calculation (the group
    # summary passes it in once instead of reading ProviderConfig per keyword)
    if total_providers is None:
        total_providers = get_enabled_provider_count()

    # Calculate metrics for each brand
    brand_metrics = []
    for data in brand_data.values():
        provider_count = len(data['providers'])
        best_rank = min(data['ranks']) if data['ranks'] else UNRANKED_SENTINEL
        avg_sentiment = sum(data['sentiments']) / len(data['sentiments']) if data['sentiments'] else 0.0

        # Ensure all values are native Python types
        mentions = to_int(data['mentions'], 0)

        visibility_score = calculate_visibility_score(
            provider_count=provider_count,
            total_mentions=mentions,
            best_rank=best_rank,
            avg_sentiment_score=float(avg_sentiment),
            total_providers=total_providers
        )

        # Use the classification from brand extraction (already determined during search)
        classification = data.get('classification', 'other')

        brand_metrics.append({
            'name': data['original_name'],
            'visibility_score': visibility_score,
            'provider_count': provider_count,
            'providers': list(data['providers']),
            'total_mentions': mentions,
            'best_rank': best_rank,
            'avg_sentiment': round(float(avg_sentiment), 2),
            'classification': classification
        })

    # Sort by visibility score
    brand_metrics.sort(key=lambda x: x['visibility_score'], reverse=True)

    # Calculate share of voice
    brand_mentions = {b['name']: b['total_mentions'] for b in brand_metrics}
    share_of_voice = calculate_share_of_voice(brand_mentions, total_mentions)

    # Add share of voice to each brand
    for brand in brand_metrics:
        brand['share_of_voice'] = share_of_voice.get(brand['name'], 0)

    # Separate by classification
    first_party_metrics = [b for b in brand_metrics if b['classification'] == 'first_party']
    competitor_metrics = [b for b in brand_metrics if b['classification'] == 'competitor']
    other_metrics = [b for b in brand_metrics if b['classification'] == 'other']

    return {
        'keyword': keyword,
        'timestamp': latest_timestamp,
        'total_brands': len(brand_metrics),
        'total_mentions': total_mentions,
        'total_providers': total_providers,
        'brands': brand_metrics,
        'first_party': first_party_metrics,
        'competitors': competitor_metrics,
        'others': other_metrics,
        'summary': {
            'first_party_avg_score': round(mean(b['visibility_score'] for b in first_party_metrics), 1),
            'competitor_avg_score': round(mean(b['visibility_score'] for b in competitor_metrics), 1),
            'first_party_total_sov': round(sum(b['share_of_voice'] for b in first_party_metrics), 2),
            'competitor_total_sov': round(sum(b['share_of_voice'] for b in competitor_metrics), 2)
        }
    }


def get_scope_visibility_metrics(scope: ReportScope, config: dict[str, Any], query_prompt_id: str | None = None) -> dict[str, Any]:
    """Group summary: per-keyword metrics in parallel, then averaged.

    Keywords without any analysis result are reported but excluded from the
    averages, so a freshly added keyword does not drag a hotel's score to zero.
    """
    total_providers = get_enabled_provider_count()
    keywords = list(scope.keywords)[:_SCOPE_KEYWORDS_CAP]

    def compute(keyword: str) -> dict[str, Any]:
        try:
            return get_visibility_metrics(keyword, config, query_prompt_id=query_prompt_id, total_providers=total_providers)
        except Exception as exc:  # one broken partition must not sink the group
            logger.warning(f"Visibility metrics failed for {keyword!r}: {exc}")
            return {'error': str(exc)}

    per_keyword: list[dict[str, Any]] = []
    if keywords:
        with ThreadPoolExecutor(max_workers=min(_SCOPE_MAX_WORKERS, len(keywords))) as pool:
            per_keyword = list(pool.map(compute, keywords))

    summary = summarize_group_visibility(keywords, per_keyword, total_providers)
    return {
        'scope': scope.describe(),
        'total_providers': total_providers,
        'keywords_truncated': len(scope.keywords) > len(keywords),
        **summary,
    }


@api_handler
@validate({
    **SCOPE_QUERY_PARAMS,
    'brand': {'type': str, 'max_length': 200},
    'query_prompt_id': {'type': str, 'max_length': 100},
})
def handler(event, context, brand=None, query_prompt_id=None, **scope_params):
    """
    API handler for visibility metrics.

    Query params (exactly one scope):
        - keyword: one keyword — the single-keyword response
        - group_id: every active keyword of a keyword group — group summary
        - keyword_ids: comma-separated keyword ids — group summary
    Optional:
        - brand: Filter to specific brand (single keyword only)
        - query_prompt_id: Filter to specific persona
    """
    report_scope, rejected = scope_from_request(event, scope_params, dynamodb.Table(KEYWORDS_TABLE), required=True)
    if rejected:
        return rejected

    config = get_brand_config()
    if report_scope.is_single_keyword:
        metrics = get_visibility_metrics(report_scope.keywords[0], config, query_prompt_id=query_prompt_id)
        # Filter to specific brand if requested
        if brand and 'brands' in metrics:
            metrics['brands'] = [
                b for b in metrics['brands']
                if brand.lower() in b['name'].lower()
            ]
        return success_response(metrics, event)

    return success_response(get_scope_visibility_metrics(report_scope, config, query_prompt_id=query_prompt_id), event)
