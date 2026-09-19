"""
Get Brand Mentions API

Retrieves brand mentions from search results for a specific keyword.
Supports multiple industries and brand classification (first_party, competitor, other).
"""

import logging
import sys
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import boto3
from boto3.dynamodb.conditions import Key

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import not_found_response, success_response, validation_error
from shared.decorators import api_handler, optional_provider, validate
from shared.dynamo_decimal import to_int
from shared.dynamodb_batch import collect_all_items
from shared.scope_params import (
    SCOPE_QUERY_PARAMS,
    ReportScope,
    keywords_table_name,
    query_keyword_rows,
    scope_from_request,
)
from shared.search_results import latest_run, search_results_table_name
from shared.utils import get_brand_config

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Scopes resolve against the Keywords table; every row a report reads comes from SearchResults.
SEARCH_RESULTS_TABLE = search_results_table_name()
KEYWORDS_TABLE = keywords_table_name()

# Group aggregates fan out one projected Query per keyword (no LLM response
# text), in parallel.
_SCOPE_MAX_WORKERS = 10
_AVAILABLE_RUN_LIMIT = 50
_SCOPE_PROJECTION = 'keyword, #ts, provider, brands, query_prompt_id, metadata'


def _result_model(result: dict[str, Any], provider: str) -> str:
    """Return the stored model identifier, falling back to its provider."""
    metadata = result.get('metadata')
    if isinstance(metadata, dict):
        model = metadata.get('model')
        if isinstance(model, str) and model:
            return model
    return provider


def aggregate_brand_mentions(results: list[dict[str, Any]], config: dict[str, Any] | None = None) -> dict[str, Any]:
    """
    Aggregate brand mentions across all providers.

    Returns:
        Dict with aggregated brand data including cross-provider rankings
    """
    brand_scores = {}  # brand_name -> {providers: [], total_mentions: int, best_rank: int}

    for result in results:
        provider = result.get('provider') or 'unknown'
        brands = result.get('brands', [])

        for brand in brands:
            name = brand.get('name')
            if not name:
                continue

            normalized_name = name.lower()

            if normalized_name not in brand_scores:
                # Use the LLM-assigned classification directly
                # The LLM has already classified brands based on ownership knowledge
                classification = brand.get('classification', 'other')

                brand_scores[normalized_name] = {
                    'name': name,  # Keep original casing from first mention
                    'parent_company': brand.get('parent_company'),
                    'providers': [],
                    'keywords': set(),
                    'total_mentions': 0,
                    'best_rank': to_int(brand.get('rank'), 999),
                    'classification': classification,
                    'appearances': []
                }

            brand_scores[normalized_name]['providers'].append(provider)
            if result.get('keyword'):
                brand_scores[normalized_name]['keywords'].add(result['keyword'])
            brand_scores[normalized_name]['total_mentions'] += to_int(brand.get('mention_count'), 1)
            brand_scores[normalized_name]['best_rank'] = min(
                brand_scores[normalized_name]['best_rank'],
                to_int(brand.get('rank'), 999)
            )
            brand_scores[normalized_name]['appearances'].append({
                'keyword': result.get('keyword') or '',
                'provider': provider,
                'model': _result_model(result, provider),
                'rank': brand.get('rank'),
                'mention_count': brand.get('mention_count'),
                'first_position': brand.get('first_position'),
                'sentiment': brand.get('sentiment'),
                'sentiment_reason': brand.get('sentiment_reason'),
                'ranking_context': brand.get('ranking_context')
            })

    # Convert to list and calculate aggregate score
    aggregated = []
    for brand_data in brand_scores.values():
        # Score: number of providers * 10 + inverse of best rank + total mentions
        provider_count = len(set(brand_data['providers']))
        score = (provider_count * 10) + (10 - brand_data['best_rank']) + brand_data['total_mentions']

        brand_data['provider_count'] = provider_count
        brand_data['aggregate_score'] = score
        # Distinct keywords mentioning the brand (meaningful for group scopes).
        brand_data['keyword_count'] = len(brand_data['keywords'])
        brand_data['keywords'] = sorted(brand_data['keywords'])
        aggregated.append(brand_data)

    # Sort by aggregate score
    aggregated.sort(key=lambda x: x['aggregate_score'], reverse=True)

    # Add overall rank
    for idx, brand in enumerate(aggregated, 1):
        brand['overall_rank'] = idx

    # Separate by classification
    first_party_brands = [b for b in aggregated if b.get('classification') == 'first_party']
    competitor_brands = [b for b in aggregated if b.get('classification') == 'competitor']
    other_brands = [b for b in aggregated if b.get('classification') == 'other']

    return {
        'brands': aggregated,
        'total_unique_brands': len(aggregated),
        'first_party_brands': first_party_brands,
        'competitor_brands': competitor_brands,
        'summary': {
            'first_party_count': len(first_party_brands),
            'competitor_count': len(competitor_brands),
            'other_count': len(other_brands)
        }
    }


def _available_runs(items: list[dict[str, Any]]) -> list[str]:
    """Newest distinct analysis timestamps represented by loaded rows."""
    timestamps = {
        timestamp
        for item in items
        if isinstance((timestamp := item.get('timestamp')), str) and timestamp
    }
    return sorted(timestamps, reverse=True)[:_AVAILABLE_RUN_LIMIT]


def _scope_run_items(
    keyword: str,
    timestamp: str | None,
    query_prompt_id: str | None,
    provider: str | None,
) -> tuple[list[dict[str, Any]], list[str]]:
    """Load projected rows and select one run for a keyword in a report scope."""
    items = query_keyword_rows(dynamodb.Table(SEARCH_RESULTS_TABLE), keyword, _SCOPE_PROJECTION)
    available_runs = _available_runs(items)
    selected_timestamp = timestamp or (available_runs[0] if available_runs else None)
    selected_items = [item for item in items if item.get('timestamp') == selected_timestamp]
    if query_prompt_id:
        selected_items = [item for item in selected_items if item.get('query_prompt_id', 'default') == query_prompt_id]
    if provider:
        selected_items = [item for item in selected_items if item.get('provider') == provider]
    return selected_items, available_runs


def get_scope_brand_mentions(
    scope: ReportScope,
    brand_config: dict[str, Any],
    query_prompt_id: str | None,
    provider: str | None,
    classification: str | None,
    timestamp: str | None = None,
) -> dict[str, Any]:
    """Brand mentions aggregated over the selected run for every keyword.

    With no explicit timestamp, each keyword keeps its latest-run behavior.
    With one, only rows from that shared run are included, so keywords absent
    from the run count as having no data. Full LLM responses (`by_provider`)
    are not part of a group answer.
    """
    keywords = list(scope.keywords)
    loaded: list[tuple[list[dict[str, Any]], list[str]]] = []
    if keywords:
        with ThreadPoolExecutor(max_workers=min(_SCOPE_MAX_WORKERS, len(keywords))) as pool:
            loaded = list(pool.map(
                lambda keyword: _scope_run_items(keyword, timestamp, query_prompt_id, provider),
                keywords,
            ))

    per_keyword = [rows for rows, _runs in loaded]
    items = [item for rows in per_keyword for item in rows]
    available_runs = sorted(
        {run for _rows, runs in loaded for run in runs},
        reverse=True,
    )[:_AVAILABLE_RUN_LIMIT]
    aggregated = aggregate_brand_mentions(items, brand_config)
    if classification:
        aggregated['brands'] = [b for b in aggregated['brands'] if b.get('classification') == classification]

    return {
        'scope': scope.describe(),
        'keyword': None,
        'timestamp': timestamp or max((item.get('timestamp', '') for item in items), default=None),
        'available_runs': available_runs,
        'keywords_analyzed': len(keywords),
        'keywords_with_data': sum(1 for rows in per_keyword if rows),
        'config': brand_config,
        'by_provider': [],
        'aggregated': aggregated,
    }


def _query_full_keyword_rows(table: Any, keyword: str) -> list[dict[str, Any]]:
    """Load every full response row in one keyword partition."""
    return collect_all_items(
        table.query,
        KeyConditionExpression=Key('keyword').eq(keyword),
    )


@api_handler
@validate({
    **SCOPE_QUERY_PARAMS,
    'timestamp': {'type': str, 'max_length': 50},
    'provider': optional_provider(),
    'classification': {'type': str, 'choices': ['first_party', 'competitor', 'other']},
    'query_prompt_id': {'type': str, 'max_length': 100},
})
def handler(event: dict[str, Any], context: Any, timestamp: str | None = None, provider: str | None = None,
            classification: str | None = None, query_prompt_id: str | None = None, **scope_params: str | None) -> dict[str, Any]:
    """
    API handler to get brand mentions for a keyword or a keyword group.

    Query params (exactly one scope):
        - keyword: The search keyword — per-provider responses + aggregate
        - group_id / keyword_ids: a keyword group / id set — aggregate across keywords
        - timestamp: Specific analysis run (optional, defaults to latest)
        - provider: Filter by specific provider (optional)
        - classification: Filter by classification (first_party, competitor, other) (optional)
        - query_prompt_id: Filter by persona (optional)

    Returns:
        Brand mention aggregates, available run timestamps, and per-provider
        response details for single-keyword requests.
    """
    report_scope, rejected = scope_from_request(event, scope_params, dynamodb.Table(KEYWORDS_TABLE), required=True)
    if report_scope is None:
        # required=True answers a missing scope with a rejection; the fallback only satisfies the type checker.
        return rejected or validation_error('Provide keyword, group_id or keyword_ids', event, 'keyword')

    # Get brand tracking configuration
    brand_config = get_brand_config()

    if not report_scope.is_single_keyword:
        result = get_scope_brand_mentions(
            report_scope,
            brand_config,
            query_prompt_id,
            provider,
            classification,
            timestamp,
        )
        return success_response(result, event)

    keyword = report_scope.keywords[0]
    # Every stored run is read (paginated) so `available_runs` lists them all,
    # even when a timestamp narrows the answer to one of them.
    items = _query_full_keyword_rows(dynamodb.Table(SEARCH_RESULTS_TABLE), keyword)

    if not items:
        return not_found_response('Results for keyword', event)

    available_runs = _available_runs(items)
    result_timestamp = timestamp

    if timestamp:
        items = [item for item in items if item.get('timestamp') == timestamp]
        if not items:
            return not_found_response('Results for keyword', event)
    else:
        result_timestamp, items = latest_run(items)

    # Filter by persona if specified
    if query_prompt_id:
        items = [item for item in items if item.get('query_prompt_id', 'default') == query_prompt_id]

    # Filter by provider if specified
    if provider:
        items = [item for item in items if item.get('provider') == provider]

    # Format response by provider
    by_provider = []
    for item in items:
        full_response = item.get('response', '')
        by_provider.append({
            'provider': item.get('provider'),
            'timestamp': item.get('timestamp'),
            'brands': item.get('brands', []),
            'response_preview': full_response[:200] + '...' if len(full_response) > 200 else full_response,
            'full_response': full_response,
            'seo_feedback': item.get('seo_feedback', ''),
            'geo_feedback': item.get('geo_feedback', ''),
            'citations': item.get('citations', [])
        })

    # Aggregate across providers
    aggregated = aggregate_brand_mentions(items, brand_config)

    # Apply classification filter if specified
    if classification:
        aggregated['brands'] = [b for b in aggregated['brands'] if b.get('classification') == classification]

    result = {
        'keyword': keyword,
        'timestamp': result_timestamp,
        'available_runs': available_runs,
        'config': brand_config,
        'by_provider': by_provider,
        'aggregated': aggregated
    }

    return success_response(result, event)
