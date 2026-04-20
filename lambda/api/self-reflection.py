"""
Self-Reflection API

Triggers LLM self-reflection analysis for a keyword, brand, and persona.
The LLM explains why a brand was ranked in its position and provides
actionable content recommendations.

Endpoints:
- POST /self-reflection  - Trigger a new analysis (with 24h caching)
- GET  /self-reflection   - Retrieve stored results
"""

import json
import os
import sys
import time
import logging
from datetime import datetime, timedelta

import boto3
from boto3.dynamodb.conditions import Key, Attr

sys.path.insert(0, '/opt/python')

from shared.decorators import api_handler, parse_json_body, validate, require_keyword
from shared.api_response import success_response, validation_error
from shared.utils import get_brand_config
from shared.models import ModelRole, invoke_bedrock
from shared.llm_json import parse_llm_json

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

dynamodb = boto3.resource('dynamodb')

SEARCH_RESULTS_TABLE = os.environ['DYNAMODB_TABLE_SEARCH_RESULTS']
SELF_REFLECTION_TABLE = os.environ['DYNAMODB_TABLE_SELF_REFLECTION']
QUERY_PROMPTS_TABLE = os.environ['QUERY_PROMPTS_TABLE']
CACHE_TTL_HOURS = 24

SELF_REFLECTION_PROMPT = """You are analysing an AI search response to explain brand ranking decisions.

Industry: {industry}
Keyword: {keyword}
Persona/Query: {persona_template}

Original AI Response:
{response_text}

Brand Extraction Data:
{brand_data_json}

Brand being analysed: {brand_name}
Current rank: {current_rank}
Brand classification: {classification}

Tracked brands configuration:
First-party: {first_party_brands}
Competitors: {competitor_brands}

Please provide a JSON response with this exact structure:
{{
  "explanation": "Why this brand was ranked at position {current_rank}...",
  "content_contributions": "What the brand's online content contributed to this ranking...",
  "competitor_advantages": "What competitor content showed that influenced their higher/lower rankings...",
  "missing_data_points": "What data or content was missing from this brand that would improve its ranking...",
  "recommendations": [
    {{
      "title": "Short action title",
      "description": "Detailed description of what to create or improve",
      "priority": "high|medium|low",
      "content_type": "landing page|blog post|FAQ section|data page|review page",
      "gap_reference": "The specific gap this addresses"
    }}
  ]
}}

Rank recommendations by estimated impact on improving the brand's position for this specific persona.
Be specific about what content changes would help. Reference concrete gaps you identified.
Return ONLY the JSON object. Do not include any text before or after the JSON."""


def get_persona_info(query_prompt_id: str) -> dict:
    """Look up persona name and template from the QueryPrompts table."""
    table = dynamodb.Table(QUERY_PROMPTS_TABLE)
    response = table.get_item(Key={'id': query_prompt_id})
    item = response.get('Item', {})
    return {
        'name': item.get('name', query_prompt_id),
        'template': item.get('template', ''),
    }


def check_cache(keyword: str, brand: str, query_prompt_id: str):
    """Return a cached self-reflection result if one exists within the TTL window."""
    table = dynamodb.Table(SELF_REFLECTION_TABLE)
    pk = f"{keyword}#{brand.lower()}"
    response = table.query(
        KeyConditionExpression=(
            Key('keyword_brand').eq(pk) &
            Key('persona_timestamp').begins_with(f"{query_prompt_id}#")
        ),
        ScanIndexForward=False, Limit=1
    )
    items = response.get('Items', [])
    if not items:
        return None
    item = items[0]
    created_at = item.get('created_at', '')
    try:
        created_dt = datetime.fromisoformat(created_at.replace('Z', '+00:00')).replace(tzinfo=None)
        if datetime.utcnow() - created_dt < timedelta(hours=CACHE_TTL_HOURS):
            return item
    except (ValueError, TypeError):
        pass
    return None


def fetch_search_data(keyword: str, query_prompt_id: str):
    """Fetch the latest search response and brand data for a keyword + persona."""
    table = dynamodb.Table(SEARCH_RESULTS_TABLE)
    response = table.query(KeyConditionExpression=Key('keyword').eq(keyword))
    items = response.get('Items', [])
    if not items:
        return None, None

    latest_ts = max(item.get('timestamp', '') for item in items)
    persona_items = [
        item for item in items
        if item.get('timestamp') == latest_ts
        and (query_prompt_id in (None, '', 'all') or item.get('query_prompt_id', 'default') == query_prompt_id)
    ]
    if not persona_items:
        return None, None

    response_texts, all_brands = [], []
    for item in persona_items[:4]:
        text = item.get('response', '')
        if text:
            response_texts.append(f"[{item.get('provider', 'unknown')}]: {text[:2000]}")
        all_brands.extend(item.get('brands', []))

    return '\n\n'.join(response_texts), all_brands


def find_brand_in_results(brand: str, brands_list: list):
    """Find a brand in the extracted brands list. Returns (brand_data, rank) or (None, None)."""
    if not brands_list:
        return None, None
    brand_lower = brand.lower()
    for b in brands_list:
        name = b.get('name', '')
        if name.lower() == brand_lower or brand_lower in name.lower():
            return b, b.get('rank', None)
    return None, None


def store_reflection(keyword, brand, query_prompt_id, persona_name,
                     reflection, config, current_rank):
    """Store a self-reflection result in DynamoDB with a 24-hour TTL."""
    table = dynamodb.Table(SELF_REFLECTION_TABLE)
    timestamp = datetime.utcnow().isoformat() + 'Z'
    item = {
        'keyword_brand': f"{keyword}#{brand.lower()}",
        'persona_timestamp': f"{query_prompt_id}#{timestamp}",
        'keyword': keyword,
        'brand': brand,
        'query_prompt_id': query_prompt_id,
        'query_prompt_name': persona_name,
        'current_rank': current_rank,
        'explanation': reflection.get('explanation', ''),
        'content_contributions': reflection.get('content_contributions', ''),
        'competitor_advantages': reflection.get('competitor_advantages', ''),
        'missing_data_points': reflection.get('missing_data_points', ''),
        'recommendations': reflection.get('recommendations', []),
        'industry': config.get('industry', 'general'),
        'created_at': timestamp,
        'ttl': int(time.time()) + (CACHE_TTL_HOURS * 3600),
    }
    table.put_item(Item=item)
    return item


def strip_internal_keys(item: dict) -> dict:
    """Remove DynamoDB composite keys from the API response."""
    cleaned = dict(item)
    cleaned.pop('keyword_brand', None)
    cleaned.pop('persona_timestamp', None)
    return cleaned


# ---------------------------------------------------------------------------
# POST /self-reflection
# ---------------------------------------------------------------------------

@parse_json_body
@validate({
    'keyword': {'required': True, 'type': str, 'max_length': 500, 'source': 'body'},
    'brand': {'required': True, 'type': str, 'max_length': 200, 'source': 'body'},
    'query_prompt_id': {'required': False, 'type': str, 'max_length': 100, 'source': 'body'},
    'force_refresh': {'type': bool, 'default': False, 'source': 'body'},
})
def post_self_reflection(event, context, body, keyword, brand, query_prompt_id=None, force_refresh=False):
    """Trigger a self-reflection analysis for a keyword / brand / persona."""
    query_prompt_id = query_prompt_id or 'all'

    # 1. Check cache (skip if force_refresh)
    if not force_refresh:
        cached = check_cache(keyword, brand, query_prompt_id)
        if cached:
            logger.info("Returning cached self-reflection result")
            return success_response(strip_internal_keys(cached), event)

    # 2. Fetch search data
    response_text, brands_list = fetch_search_data(keyword, query_prompt_id)
    if not response_text:
        return success_response({
            'keyword': keyword, 'brand': brand,
            'query_prompt_id': query_prompt_id, 'current_rank': None,
            'explanation': (
                f'No search results found for keyword "{keyword}" with the specified persona. '
                'Run an analysis first to generate data for self-reflection.'
            ),
            'content_contributions': '', 'competitor_advantages': '',
            'missing_data_points': '', 'recommendations': [],
        }, event)

    # 3. Look up brand in results
    brand_data, current_rank = find_brand_in_results(brand, brands_list)
    classification = brand_data.get('classification', 'other') if brand_data else 'not_found'

    # 4. If brand is absent, return an absence explanation
    if brand_data is None:
        config = get_brand_config()
        persona_info = get_persona_info(query_prompt_id)
        absence_result = {
            'explanation': (
                f'The brand "{brand}" did not appear in any AI search results for '
                f'"{keyword}" under this persona. None of the queried AI engines '
                'mentioned or recommended this brand for the given query.'
            ),
            'content_contributions': 'No content from this brand was referenced by any AI engine.',
            'competitor_advantages': (
                'Competitor brands that did appear likely have stronger topical authority, '
                'more relevant content, or better structured data for this query.'
            ),
            'missing_data_points': (
                'The brand needs content that directly addresses this keyword and persona. '
                'Consider creating authoritative, well-structured pages targeting this topic.'
            ),
            'recommendations': [{
                'title': f'Create targeted content for "{keyword}"',
                'description': (
                    f'Create a comprehensive page that directly addresses "{keyword}" '
                    "from this persona's perspective to gain initial visibility."
                ),
                'priority': 'high',
                'content_type': 'landing page',
                'gap_reference': 'Brand completely absent from results',
            }],
        }
        stored = store_reflection(
            keyword, brand, query_prompt_id, persona_info['name'],
            absence_result, config, current_rank,
        )
        return success_response(strip_internal_keys(stored), event)

    # 5. Load brand config for industry context
    config = get_brand_config()
    tracked_brands = config.get('tracked_brands', {})
    first_party = tracked_brands.get('first_party', [])
    competitors = tracked_brands.get('competitors', [])

    # 6. Build the prompt and call Bedrock
    persona_info = get_persona_info(query_prompt_id)
    prompt = SELF_REFLECTION_PROMPT.format(
        industry=config.get('industry', 'general'),
        keyword=keyword,
        persona_template=persona_info['template'] or persona_info['name'],
        response_text=response_text[:4000],
        brand_data_json=json.dumps(brands_list, default=str)[:2000],
        brand_name=brand,
        current_rank=current_rank if current_rank else 'N/A',
        classification=classification,
        first_party_brands=', '.join(first_party),
        competitor_brands=', '.join(competitors),
    )
    raw_response = invoke_bedrock(prompt, ModelRole.ANALYSIS, max_tokens=4000, temperature=0)
    reflection = parse_llm_json(raw_response, expect="object") or {
        'explanation': raw_response, 'content_contributions': '',
        'competitor_advantages': '', 'missing_data_points': '',
        'recommendations': [],
    }

    # 7. Store and return
    stored = store_reflection(
        keyword, brand, query_prompt_id, persona_info['name'],
        reflection, config, current_rank,
    )
    return success_response(strip_internal_keys(stored), event)


# ---------------------------------------------------------------------------
# GET /self-reflection
# ---------------------------------------------------------------------------

@validate({
    'keyword': require_keyword(),
    'brand': {'type': str, 'max_length': 200},
    'query_prompt_id': {'type': str, 'max_length': 100},
})
def get_self_reflection(event, context, keyword, brand=None, query_prompt_id=None):
    """Retrieve stored self-reflection results with optional filters."""
    table = dynamodb.Table(SELF_REFLECTION_TABLE)

    if brand:
        pk = f"{keyword}#{brand.lower()}"
        key_cond = Key('keyword_brand').eq(pk)
        if query_prompt_id:
            key_cond = key_cond & Key('persona_timestamp').begins_with(f"{query_prompt_id}#")
        response = table.query(KeyConditionExpression=key_cond, ScanIndexForward=False)
        items = response.get('Items', [])
    else:
        response = table.scan(FilterExpression=Attr('keyword').eq(keyword))
        items = response.get('Items', [])
        if query_prompt_id:
            items = [i for i in items if i.get('query_prompt_id') == query_prompt_id]
        items.sort(key=lambda x: x.get('created_at', ''), reverse=True)

    return success_response({'keyword': keyword, 'results': items, 'count': len(items)}, event)


# ---------------------------------------------------------------------------
# Lambda handler
# ---------------------------------------------------------------------------

@api_handler
def handler(event, context):
    """
    POST /self-reflection  - Trigger a new analysis
    GET  /self-reflection   - Retrieve stored results
    """
    method = event.get('httpMethod', 'GET').upper()
    if method == 'POST':
        return post_self_reflection(event, context)
    elif method == 'GET':
        return get_self_reflection(event, context)
    return validation_error('Method not allowed', event)
