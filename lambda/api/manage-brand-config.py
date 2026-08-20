"""
Manage Brand Configuration API

CRUD operations for brand tracking configuration.
Supports industry presets and custom brand tracking.
Includes brand expansion using LLM to suggest related sub-brands.
"""

import json
import logging
import os
import sys
from collections.abc import Callable
from typing import Any

import boto3

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.api_response import success_response, validation_error
from shared.auth import ADMIN_GROUP, require_group
from shared.decorators import api_handler, cors_preflight, parse_json_body, route_handler, validate
from shared.industry_presets import INDUSTRY_PRESETS as _BASE_PRESETS
from shared.industry_presets import get_preset as get_shared_preset
from shared.llm_json import parse_llm_json
from shared.prompt_safety import untrusted_input_system_instruction, wrap_user_input
from shared.utils import get_timestamp

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Add parent directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'search'))

dynamodb = boto3.resource('dynamodb')

# Import centralized Bedrock invocation (ModelRole.ANALYSIS -> Sonnet by default)
from shared.models import ModelRole, invoke_bedrock  # noqa: E402

# Fail-fast: Required environment variables
DYNAMODB_TABLE_BRAND_CONFIG = os.environ['DYNAMODB_TABLE_BRAND_CONFIG']


def _run_brand_prompt(
    prompt: str,
    *,
    max_tokens: int,
    error_defaults: dict[str, Any],
    shape: Callable[[dict[str, Any]], dict[str, Any]],
    log_context: str,
) -> dict[str, Any]:
    """Invoke Bedrock, parse the JSON object, and shape the success payload.

    The three brand-suggestion endpoints (expand_brands, expand_brand,
    find_competitors) each hand-rolled this same invoke -> guard-empty ->
    parse -> guard-invalid -> shape -> except ladder (bugs.md §5).
    `error_defaults` is what the endpoint returns when the model response is
    unusable; `shape` builds the success payload from the parsed object and
    runs inside the try so shaping bugs degrade to the same defaults instead
    of crashing the handler.
    """
    try:
        response_text = invoke_bedrock(prompt, ModelRole.ANALYSIS, max_tokens=max_tokens, temperature=0)

        if not response_text:
            return {**error_defaults, "error": "Empty response"}

        result = parse_llm_json(response_text, expect="object")
        if result is None:
            return {**error_defaults, "error": "Invalid response format"}

        return shape(result)

    except Exception as e:
        logger.error(f"Error {log_context}: {e!s}")
        return {**error_defaults, "error": str(e)}

def generate_default_prompt(industry_name: str, extraction_focus: str, entity_types: list) -> str:
    """Generate a default extraction prompt for an industry."""
    entity_desc = '\n'.join([f"- {et}" for et in entity_types]) if entity_types else "- Brand names and company names"

    return f"""Extract all brand and company mentions from the following text.

INDUSTRY CONTEXT: {industry_name}
FOCUS: {extraction_focus}

ENTITY TYPES TO EXTRACT:
{entity_desc}

{{{{TRACKED_BRANDS}}}}

For each brand found, provide:
- name: Full brand/company name as mentioned
- parent_company: Parent company if identifiable (or null)
- mention_count: Number of times mentioned
- first_position: Character position of first mention (approximate)
- rank: Order of first appearance (1 = first mentioned)
{{{{SENTIMENT_FIELDS}}}}
{{{{RANKING_CONTEXT_FIELD}}}}

{{{{CUSTOM_INSTRUCTIONS}}}}

Return ONLY a valid JSON array with no additional text. Format:
[
  {{
    "name": "Brand Name",
    "parent_company": "Parent Company or null",
    "mention_count": 2,
    "first_position": 150,
    "rank": 1,
    "sentiment": "positive",
    "sentiment_reason": "Praised for quality and value",
    "ranking_context": "Recommended as top choice"
  }}
]

If no brands are found, return an empty array: []

TEXT TO ANALYZE:
{{{{TEXT}}}}

JSON OUTPUT:"""


# Industry preset structural data is owned by shared.industry_presets. The
# dashboard API returns the same base fields plus a derived `default_prompt`
# computed at request time via `_preset_with_prompt`, avoiding drift between
# this file's copy and the extraction Lambda's.


def _preset_with_prompt(preset: dict) -> dict:
    """Decorate a shared preset with a `default_prompt` string.

    Dashboard clients consume both the structural fields and a ready-to-use
    prompt. Computing the prompt here keeps the shared module free of
    API-specific concerns and lets us change the prompt template without
    touching the extraction Lambda.
    """
    return {
        **preset,
        "default_prompt": generate_default_prompt(
            preset["name"],
            preset["extraction_focus"],
            preset.get("entity_types", []),
        ),
    }


def get_preset_with_prompt(industry_id: str) -> dict:
    """Look up an industry preset and decorate it with its default prompt.

    Uses `shared.industry_presets.get_preset` for the base lookup (which
    falls back to ``custom`` on unknown ids).
    """
    return _preset_with_prompt(get_shared_preset(industry_id))


def normalize_brand(name: str) -> str:
    """Normalize brand name for comparison - remove accents, lowercase, trim."""
    import unicodedata
    normalized = unicodedata.normalize('NFD', name)
    without_accents = ''.join(c for c in normalized if unicodedata.category(c) != 'Mn')
    return without_accents.lower().strip()


def find_duplicates(brands: list) -> list:
    """Find potential duplicates in a brand list based on normalized comparison."""
    duplicates = []
    seen = {}

    for brand in brands:
        normalized = normalize_brand(brand)
        if normalized in seen:
            duplicates.append({
                "brand": brand,
                "duplicate_of": seen[normalized],
                "reason": "Same name after removing accents/case"
            })
        else:
            seen[normalized] = brand

    return duplicates


def expand_brands(existing_brands: list, industry: str = "hotels", brand_type: str = "first_party") -> dict[str, Any]:
    """
    Use LLM to expand ALL existing brands into related sub-brands, variations, and owned properties.
    Returns deduplicated suggestions and flags existing duplicates.

    Args:
        existing_brands: List of brands already added
        industry: Industry context for better suggestions
        brand_type: 'first_party' or 'competitor' - affects the prompt
    """
    if not existing_brands:
        return {
            "suggestions": [],
            "duplicates_found": [],
            "notes": "No brands provided to expand",
            "error": "Please add at least one brand first"
        }

    industry_preset = get_shared_preset(industry)
    industry_name = industry_preset.get("name", "General")
    entity_types = industry_preset.get("entity_types", ["brands", "companies"])

    entity_types_str = ", ".join(entity_types) if entity_types else "brands and companies"
    # Wrap each user-supplied brand in `<brand>` tags so malicious names
    # cannot escape into the surrounding prompt instructions.
    brands_list = ", ".join(wrap_user_input(b, "brand") for b in existing_brands if b)

    # Check for existing duplicates first
    existing_duplicates = find_duplicates(existing_brands)

    # Normalize existing brands for filtering
    existing_normalized = {normalize_brand(b) for b in existing_brands}

    prompt = f"""{untrusted_input_system_instruction()}

You are a brand expert for the {industry_name} industry.

INDUSTRY CONTEXT:
- Entity types: {entity_types_str}

BRANDS ALREADY BEING TRACKED (DO NOT INCLUDE THESE IN YOUR RESPONSE):
{brands_list}

Your task: Find MISSING sub-brands, brand tiers, and variations that belong to the same parent companies as the brands above.

For each brand in the list above, think about:
1. What sub-brands or brand tiers does this company own?
2. What other brands has this company acquired?
3. What loyalty programs or membership brands do they have?
4. What regional or market-specific brand variations exist?

CRITICAL RULES:
- ONLY suggest brands that are NOT in the "already tracked" list above
- ONLY suggest brands owned by the SAME parent companies
- Do NOT suggest competitor brands (brands owned by different companies)
- Do NOT repeat any brand from the existing list, even with different spelling

Return ONLY a JSON object:
{{
  "parent_companies": ["Parent Company 1", "Parent Company 2"],
  "suggestions": [
    "Missing Sub-brand 1",
    "Missing Sub-brand 2"
  ],
  "notes": "Brief explanation of what was found. If all sub-brands are already tracked, say so."
}}

If ALL sub-brands are already being tracked, return an empty suggestions array and explain in notes.

JSON OUTPUT:"""

    def shape(result: dict[str, Any]) -> dict[str, Any]:
        suggestions = result.get("suggestions", [])

        # Filter out any suggestions that match existing brands (normalized)
        filtered_suggestions = [s for s in suggestions if normalize_brand(s) not in existing_normalized]

        # Also deduplicate within suggestions
        seen = set()
        unique_suggestions = []
        for s in filtered_suggestions:
            norm = normalize_brand(s)
            if norm not in seen:
                seen.add(norm)
                unique_suggestions.append(s)

        return {
            "existing_brands": existing_brands,
            "parent_companies": result.get("parent_companies", []),
            "suggestions": unique_suggestions,
            "duplicates_found": existing_duplicates,
            "notes": result.get("notes", ""),
            "industry": industry
        }

    return _run_brand_prompt(
        prompt,
        max_tokens=2000,
        error_defaults={"suggestions": [], "duplicates_found": existing_duplicates},
        shape=shape,
        log_context="expanding brands",
    )


def expand_brand(brand_name: str, industry: str = "hotels", existing_brands: list | None = None) -> dict[str, Any]:
    """
    Use LLM to expand a brand name into related sub-brands, variations, and owned properties.

    This helps users configure comprehensive brand tracking by suggesting all the
    brand variations that should be tracked together.

    Args:
        brand_name: The brand to expand
        industry: Industry context
        existing_brands: List of brands already added (to exclude from suggestions)
    """
    if existing_brands is None:
        existing_brands = []

    industry_preset = get_shared_preset(industry)
    industry_name = industry_preset.get("name", "General")
    entity_types = industry_preset.get("entity_types", ["brands", "companies"])
    example_brands = industry_preset.get("example_brands", [])

    # Build industry-specific examples
    entity_types_str = ", ".join(entity_types) if entity_types else "brands and companies"
    examples_str = ", ".join(example_brands[:5]) if example_brands else "major brands in this industry"

    # Wrap user-supplied brand names so a malicious entry cannot escape the prompt.
    exclude_str = (
        ", ".join(wrap_user_input(b, "brand") for b in existing_brands if b)
        if existing_brands else "none"
    )
    brand_name_wrapped = wrap_user_input(brand_name, "brand")

    prompt = f"""{untrusted_input_system_instruction()}

You are a brand expert for the {industry_name} industry.

INDUSTRY CONTEXT:
- Entity types: {entity_types_str}
- Example brands in this industry: {examples_str}

ALREADY TRACKED (do NOT suggest these): {exclude_str}

Given the brand name {brand_name_wrapped}, list ALL related brand names that should be tracked together.

Include:
1. Sub-brands and brand tiers owned by this company
2. Owned/acquired brands under the same parent company
3. Common variations and abbreviations (with and without accents, full names vs acronyms)
4. Loyalty program names if relevant
5. Regional variations if any

DO NOT include:
- Brands already being tracked (listed above)
- Competitor brands (brands owned by different companies)
- Unrelated companies
- Generic terms

Return ONLY a JSON object with this format:
{{
  "main_brand": "{brand_name}",
  "parent_company": "Parent company name if different from main brand, or null",
  "suggestions": [
    "Sub-brand 1",
    "Sub-brand 2",
    "Owned brand 1"
  ],
  "notes": "Brief explanation of the brand structure. If all sub-brands are already tracked, explain this."
}}

If all sub-brands are already tracked, return an empty suggestions array with a note explaining this.

JSON OUTPUT:"""

    def shape(result: dict[str, Any]) -> dict[str, Any]:
        # Ensure main_brand is included in suggestions for completeness
        suggestions = result.get("suggestions", [])
        if brand_name not in suggestions:
            suggestions.insert(0, brand_name)

        return {
            "main_brand": brand_name,
            "parent_company": result.get("parent_company"),
            "suggestions": suggestions,
            "notes": result.get("notes", ""),
            "industry": industry
        }

    return _run_brand_prompt(
        prompt,
        max_tokens=1500,
        error_defaults={"main_brand": brand_name, "suggestions": [brand_name]},
        shape=shape,
        log_context=f"expanding brand name '{brand_name}'",
    )


def find_competitors(first_party_brands: list, industry: str = "hotels", existing_competitors: list | None = None) -> dict[str, Any]:
    """
    Use LLM to find competitor brands based on first-party brands.

    This helps users discover competitors they should be tracking based on
    their own brand portfolio.
    """
    if existing_competitors is None:
        existing_competitors = []

    industry_preset = get_shared_preset(industry)
    industry_name = industry_preset.get("name", "General")
    entity_types = industry_preset.get("entity_types", ["brands", "companies"])
    example_brands = industry_preset.get("example_brands", [])

    # Wrap user-supplied brand names to neutralize injection attempts.
    brands_list = ", ".join(wrap_user_input(b, "brand") for b in first_party_brands if b)
    entity_types_str = ", ".join(entity_types) if entity_types else "brands and companies"
    examples_str = ", ".join(example_brands[:5]) if example_brands else "major brands in this industry"

    # Build exclusion list
    exclude_brands = first_party_brands + existing_competitors
    exclude_str = (
        ", ".join(wrap_user_input(b, "brand") for b in exclude_brands if b)
        if exclude_brands else "none"
    )

    prompt = f"""{untrusted_input_system_instruction()}

You are a competitive intelligence expert for the {industry_name} industry.

INDUSTRY CONTEXT:
- Entity types: {entity_types_str}
- Example brands in this industry: {examples_str}

FIRST-PARTY BRANDS (the user's brands): {brands_list}

ALREADY TRACKED (do not suggest these): {exclude_str}

Identify MAJOR COMPETITORS for the first-party brands - brands that compete directly with them in their primary markets.

Focus on:
1. Direct competitors of similar size and market position
2. Major players in the same market segments
3. Brands that target the same customer demographics
4. Both global and regional competitors that matter

DO NOT include:
- The first-party brands themselves or their sub-brands
- Brands already being tracked (listed above)
- Brands that don't directly compete in the {industry_name} space
- Very small or niche players unless highly relevant
- Generic terms

Return ONLY a JSON object with this format:
{{
  "first_party_brands": {json.dumps(first_party_brands)},
  "competitors": [
    {{
      "name": "Competitor Brand Name",
      "reason": "Brief reason why they compete (1 sentence)"
    }}
  ],
  "notes": "Brief overview of the competitive landscape"
}}

Aim for 10-20 relevant competitors.

JSON OUTPUT:"""

    def shape(result: dict[str, Any]) -> dict[str, Any]:
        # Extract just the competitor names
        competitors = result.get("competitors", [])
        competitor_names = [c.get("name") if isinstance(c, dict) else c for c in competitors]

        return {
            "first_party_brands": first_party_brands,
            "competitors": competitor_names,
            "competitor_details": competitors,
            "notes": result.get("notes", ""),
            "industry": industry
        }

    return _run_brand_prompt(
        prompt,
        max_tokens=2000,
        error_defaults={"first_party_brands": first_party_brands, "competitors": []},
        shape=shape,
        log_context="finding competitors",
    )


def get_config() -> dict[str, Any]:
    """Get the current brand configuration."""
    table = dynamodb.Table(DYNAMODB_TABLE_BRAND_CONFIG)
    response = table.get_item(Key={'config_id': 'default'})
    return response.get('Item')


def save_config(config: dict[str, Any]) -> dict[str, Any]:
    """Save brand configuration."""
    table = dynamodb.Table(DYNAMODB_TABLE_BRAND_CONFIG)

    config['config_id'] = 'default'
    config['updated_at'] = get_timestamp()

    table.put_item(Item=config)
    return config


# --- Route Handlers ---

def _get_presets(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """GET /brand-config/presets - Return industry presets decorated
    with derived default prompts for the dashboard."""
    presets_with_prompts = {
        industry_id: _preset_with_prompt(preset)
        for industry_id, preset in _BASE_PRESETS.items()
    }
    return success_response({'presets': presets_with_prompts}, event)


@require_group(ADMIN_GROUP)
@parse_json_body
@validate({
    'brand_name': {'required': True, 'type': str, 'max_length': 200, 'source': 'body'},
    'industry': {'type': str, 'max_length': 50, 'default': 'hotels', 'source': 'body'},
    'existing_brands': {'type': list, 'default': [], 'source': 'body'}
})
def _expand_brand(event: dict[str, Any], context: Any, body: dict, brand_name: str, industry: str, existing_brands: list) -> dict[str, Any]:
    """POST /brand-config/expand - Expand a brand name to related sub-brands."""
    result = expand_brand(brand_name.strip(), industry, existing_brands)
    return success_response(result, event)


@require_group(ADMIN_GROUP)
@parse_json_body
@validate({
    'existing_brands': {'required': True, 'type': list, 'source': 'body'},
    'industry': {'type': str, 'max_length': 50, 'default': 'hotels', 'source': 'body'},
    'brand_type': {'type': str, 'choices': ['first_party', 'competitor'], 'default': 'first_party', 'source': 'body'}
})
def _expand_all_brands(event: dict[str, Any], context: Any, body: dict, existing_brands: list, industry: str, brand_type: str) -> dict[str, Any]:
    """POST /brand-config/expand-all - Expand ALL brands to find missing sub-brands."""
    if not existing_brands:
        return validation_error('Please add at least one brand first', event, 'existing_brands')

    result = expand_brands(existing_brands, industry, brand_type)
    return success_response(result, event)


@require_group(ADMIN_GROUP)
@parse_json_body
@validate({
    'first_party_brands': {'required': True, 'type': list, 'source': 'body'},
    'industry': {'type': str, 'max_length': 50, 'default': 'hotels', 'source': 'body'},
    'existing_competitors': {'type': list, 'default': [], 'source': 'body'}
})
def _find_competitors(event: dict[str, Any], context: Any, body: dict, first_party_brands: list, industry: str, existing_competitors: list) -> dict[str, Any]:
    """POST /brand-config/find-competitors - Find competitors based on first-party brands."""
    if not first_party_brands:
        return validation_error('Missing required field: first_party_brands', event, 'first_party_brands')

    result = find_competitors(first_party_brands, industry, existing_competitors)
    return success_response(result, event)


def _get_config(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """GET /brand-config - Get current configuration."""
    config = get_config()

    if not config:
        # Return default config
        config = {
            'config_id': 'default',
            'industry': 'hotels',
            'extract_brands': True,
            'include_sentiment': True,
            'include_ranking_context': True,
            'max_brands': 20,
            'tracked_brands': {
                'first_party': [],
                'competitors': []
            },
            'first_party_domains': [],
            'custom_entity_types': [],
            'custom_prompt_additions': '',
            'industry_prompts': {},
            'created_at': get_timestamp()
        }

    return success_response(config, event)


@require_group(ADMIN_GROUP)
@parse_json_body
@validate({
    'industry': {'required': True, 'type': str, 'source': 'body'}
})
def _save_config(event: dict[str, Any], context: Any, body: dict, industry: str) -> dict[str, Any]:
    """POST/PUT /brand-config - Create or update configuration.

    Admin-only. The reads (`_get_config`, `_get_presets`) stay open — the
    dashboard needs the tracked-brand list to render every other view.
    """
    # Validate industry
    if industry not in _BASE_PRESETS:
        return validation_error(
            f"Invalid industry. Must be one of: {', '.join(_BASE_PRESETS.keys())}",
            event,
            'industry'
        )

    # Build config object
    config = {
        'industry': industry,
        'extract_brands': body.get('extract_brands', True),
        'include_sentiment': body.get('include_sentiment', True),
        'include_ranking_context': body.get('include_ranking_context', True),
        'max_brands': body.get('max_brands', 20),
        'tracked_brands': {
            'first_party': body.get('tracked_brands', {}).get('first_party', []),
            'competitors': body.get('tracked_brands', {}).get('competitors', [])
        },
        'first_party_domains': body.get('first_party_domains', []),
        'custom_entity_types': body.get('custom_entity_types', []),
        'custom_prompt_additions': body.get('custom_prompt_additions', ''),
        'industry_prompts': body.get('industry_prompts', {})
    }

    saved_config = save_config(config)

    return success_response({
        'message': 'Configuration saved successfully',
        'config': saved_config
    }, event)


@require_group(ADMIN_GROUP)
def _reset_config(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """DELETE /brand-config - Reset to defaults.

    Admin-only and destructive: it overwrites `tracked_brands`,
    `first_party_domains`, `custom_entity_types` and `industry_prompts`.
    """
    default_config = {
        'industry': 'hotels',
        'extract_brands': True,
        'include_sentiment': True,
        'include_ranking_context': True,
        'max_brands': 20,
        'tracked_brands': {
            'first_party': [],
            'competitors': []
        },
        'first_party_domains': [],
        'custom_entity_types': [],
        'custom_prompt_additions': '',
        'industry_prompts': {}
    }

    saved_config = save_config(default_config)

    return success_response({
        'message': 'Configuration reset to defaults',
        'config': saved_config
    }, event)


@api_handler
@cors_preflight
@route_handler({
    # Path-specific routes (checked first, order matters for expand-all vs expand)
    ('GET', '/presets'): _get_presets,
    ('POST', '/expand-all'): _expand_all_brands,
    ('POST', '/find-competitors'): _find_competitors,
    ('POST', '/expand'): _expand_brand,
    # Method-only routes (fallback)
    'GET': _get_config,
    'POST': _save_config,
    'PUT': _save_config,
    'DELETE': _reset_config,
})
def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    """
    API handler for brand configuration management.

    GET /brand-config - Get current configuration
    GET /brand-config/presets - Get all industry presets
    POST /brand-config - Create/update configuration
    POST /brand-config/expand - Expand a brand name to related sub-brands
    POST /brand-config/expand-all - Expand ALL brands to find missing sub-brands
    POST /brand-config/find-competitors - Find competitors based on first-party brands
    PUT /brand-config - Update configuration
    DELETE /brand-config - Reset to defaults
    """
    pass  # Routes handle everything
