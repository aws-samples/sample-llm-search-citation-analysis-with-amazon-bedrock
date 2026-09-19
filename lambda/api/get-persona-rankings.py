"""
Persona Rankings API

Returns brand ranking data grouped by persona for a given keyword.
Queries the SearchResults table, groups results by query_prompt_id,
and calculates per-persona brand metrics plus a cross-persona summary.
"""

import logging
import os
import sys
from typing import Any

import boto3

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import success_response, validation_error
from shared.decorators import api_handler, require_keyword, validate
from shared.dynamo_decimal import to_int
from shared.search_results import latest_run, query_keyword_items, search_results_table_name
from shared.visibility_score import calculate_visibility_score, sentiment_to_score

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

# Fail-fast: Required environment variables
SEARCH_RESULTS_TABLE = search_results_table_name()
QUERY_PROMPTS_TABLE = os.environ['QUERY_PROMPTS_TABLE']


def sentiment_to_label(sentiments: list[str]) -> str:
    """Determine the dominant sentiment from a list of sentiment strings."""
    if not sentiments:
        return 'neutral'

    counts: dict[str, int] = {}
    for s in sentiments:
        label = (s or 'neutral').lower()
        counts[label] = counts.get(label, 0) + 1

    return max(counts, key=lambda label: counts[label])


def fetch_persona_names() -> dict[str, str]:
    """
    Fetch all persona names from the QueryPrompts table.

    Returns a mapping of persona id -> persona name.
    """
    table = dynamodb.Table(QUERY_PROMPTS_TABLE)
    response = table.scan(ProjectionExpression='id, #n', ExpressionAttributeNames={'#n': 'name'})
    items: list[dict[str, Any]] = response.get('Items', [])

    return {item['id']: item.get('name', 'Unknown Persona') for item in items}


def get_valid_persona_ids() -> set[str]:
    """Return the set of all persona IDs stored in the QueryPrompts table."""
    table = dynamodb.Table(QUERY_PROMPTS_TABLE)
    response = table.scan(ProjectionExpression='id')
    items: list[dict[str, Any]] = response.get('Items', [])
    return {item['id'] for item in items}



def build_persona_brands(items: list[dict[str, Any]], total_providers: int) -> list[dict[str, Any]]:
    """
    Build per-brand metrics from a list of search result items belonging to one persona.

    Returns a list of brand dicts sorted by rank ascending.
    """
    brand_data: dict[str, dict[str, Any]] = {}

    for item in items:
        provider = item.get('provider', 'unknown')
        brands = item.get('brands', [])

        for brand in brands:
            name = brand.get('name', '')
            if not name:
                continue

            key = name.lower()
            if key not in brand_data:
                brand_data[key] = {
                    'original_name': name,
                    'classification': brand.get('classification', 'other'),
                    'providers': set(),
                    'mentions': 0,
                    'ranks': [],
                    'sentiments': [],
                }

            brand_data[key]['providers'].add(provider)
            brand_data[key]['mentions'] += to_int(brand.get('mention_count'), 1)
            brand_data[key]['ranks'].append(to_int(brand.get('rank'), 999))
            if brand.get('sentiment'):
                brand_data[key]['sentiments'].append(brand.get('sentiment'))

    results = []
    for data in brand_data.values():
        best_rank = min(data['ranks']) if data['ranks'] else 999
        sentiment_scores = [sentiment_to_score(s) for s in data['sentiments']]
        avg_sentiment = sum(sentiment_scores) / len(sentiment_scores) if sentiment_scores else 0.0
        mentions = to_int(data['mentions'], 0)

        visibility = calculate_visibility_score(
            provider_count=len(data['providers']),
            total_mentions=mentions,
            best_rank=best_rank,
            avg_sentiment_score=float(avg_sentiment),
            total_providers=total_providers,
        )

        results.append({
            'name': data['original_name'],
            'rank': best_rank,
            'mention_count': mentions,
            'sentiment': sentiment_to_label(data['sentiments']),
            'visibility_score': visibility,
            'classification': data['classification'],
        })

    results.sort(key=lambda x: x['rank'])
    return results



def build_cross_persona_summary(
    personas: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Build a cross-persona summary with each brand's average rank, best rank,
    worst rank, and the persona that produced the best rank.
    """
    # brand_key -> { ranks: [(rank, persona_name)], classification }
    brand_agg: dict[str, dict[str, Any]] = {}

    for persona in personas:
        persona_name = persona['persona_name']
        for brand in persona.get('brands', []):
            key = brand['name'].lower()
            if key not in brand_agg:
                brand_agg[key] = {
                    'original_name': brand['name'],
                    'classification': brand.get('classification', 'other'),
                    'ranks': [],
                }
            brand_agg[key]['ranks'].append((brand['rank'], persona_name))

    summary_brands = []
    for data in brand_agg.values():
        ranks_only = [r for r, _ in data['ranks']]
        best_rank = min(ranks_only)
        worst_rank = max(ranks_only)
        avg_rank = round(sum(ranks_only) / len(ranks_only), 1)

        # Find the persona that produced the best rank
        best_persona = next(name for r, name in data['ranks'] if r == best_rank)

        summary_brands.append({
            'name': data['original_name'],
            'avg_rank': avg_rank,
            'best_rank': best_rank,
            'worst_rank': worst_rank,
            'best_persona': best_persona,
            'classification': data['classification'],
        })

    summary_brands.sort(key=lambda x: x['avg_rank'])
    return {'brands': summary_brands}


def get_persona_rankings(keyword: str, query_prompt_id: str | None = None) -> dict[str, Any]:
    """
    Calculate persona-grouped brand rankings for a keyword.

    If query_prompt_id is provided, returns only that persona's data.
    """
    items = query_keyword_items(dynamodb.Table(SEARCH_RESULTS_TABLE), keyword)

    if not items:
        return {
            'keyword': keyword,
            'personas': [],
            'cross_persona_summary': {'brands': []},
            'message': 'No search results found for this keyword.',
        }

    # Use the latest timestamp only
    _, latest_items = latest_run(items)

    # Determine total provider count from the data
    all_providers = {item.get('provider', 'unknown') for item in latest_items}
    total_providers = len(all_providers) if all_providers else 1

    # Group items by query_prompt_id
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in latest_items:
        pid = item.get('query_prompt_id', 'default')
        grouped.setdefault(pid, []).append(item)

    # Fetch persona names
    persona_names = fetch_persona_names()

    # Build per-persona brand lists
    personas = []
    for pid, group_items in grouped.items():
        brands = build_persona_brands(group_items, total_providers)
        personas.append({
            'persona_id': pid,
            'persona_name': persona_names.get(pid, pid),
            'brands': brands,
        })

    # Sort personas by name for consistent ordering
    personas.sort(key=lambda p: p['persona_name'])

    # Build cross-persona summary from all personas
    cross_persona_summary = build_cross_persona_summary(personas)

    # If a specific persona was requested, filter to just that one
    if query_prompt_id:
        personas = [p for p in personas if p['persona_id'] == query_prompt_id]

    return {
        'keyword': keyword,
        'personas': personas,
        'cross_persona_summary': cross_persona_summary,
    }


@api_handler
@validate({
    'keyword': require_keyword(),
    'query_prompt_id': {'type': str, 'max_length': 100},
})
def handler(event, context, keyword, query_prompt_id=None):
    """
    API handler for persona rankings.

    Query params:
        - keyword: Search keyword (required)
        - query_prompt_id: Filter to a specific persona (optional)
    """
    # If a persona filter was provided, validate it exists in the QueryPrompts table
    if query_prompt_id:
        valid_ids = get_valid_persona_ids()
        if query_prompt_id not in valid_ids:
            return validation_error(
                f'Persona not found: {query_prompt_id}',
                event,
                'query_prompt_id',
            )

    result = get_persona_rankings(keyword, query_prompt_id)
    return success_response(result, event)
