"""
Manage Brand Configuration API

CRUD operations for brand tracking configuration.
Supports industry presets and custom brand tracking.
Includes brand expansion using LLM to suggest related sub-brands.
"""

import json
import os
import sys
import logging
import boto3
from datetime import datetime
from typing import Dict, Any

# Add shared module to path
sys.path.insert(0, '/opt/python')

from shared.decorators import api_handler, parse_json_body, validate, cors_preflight, route_handler
from shared.api_response import success_response, validation_error

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Add parent directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'search'))

dynamodb = boto3.resource('dynamodb')
bedrock = boto3.client('bedrock-runtime')

# Fail-fast: Required environment variables
DYNAMODB_TABLE_BRAND_CONFIG = os.environ['DYNAMODB_TABLE_BRAND_CONFIG']

# Model for brand expansion
EXPANSION_MODEL_ID = "global.anthropic.claude-sonnet-4-5-20250929-v1:0"


def invoke_converse(prompt: str, model_id: str = EXPANSION_MODEL_ID, max_tokens: int = 2000, temperature: float = 0) -> str:
    """
    Invoke Bedrock using the Converse API.
    
    Args:
        prompt: The prompt to send
        model_id: Model ID to use
        max_tokens: Maximum tokens in response
        temperature: Temperature for generation
        
    Returns:
        Response text from the model
    """
    response = bedrock.converse(
        modelId=model_id,
        messages=[
            {'role': 'user', 'content': [{'text': prompt}]}
        ],
        inferenceConfig={
            'maxTokens': max_tokens,
            'temperature': temperature
        }
    )
    
    output = response.get('output', {})
    message = output.get('message', {})
    content_blocks = message.get('content', [])
    return content_blocks[0].get('text', '') if content_blocks else ''

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


# Industry presets with default prompts
INDUSTRY_PRESETS = {
    "hotels": {
        "name": "Hotels & Hospitality",
        "description": "Track hotel brands, chains, and individual properties",
        "entity_types": ["hotel chains", "hotel brands", "individual properties", "resorts", "boutique hotels"],
        "example_brands": ["Brand A", "Brand B", "Brand C", "Brand D", "Brand E"],
        "extraction_focus": "hotel and accommodation recommendations",
        "default_prompt": generate_default_prompt(
            "Hotels & Hospitality",
            "hotel and accommodation recommendations",
            ["hotel chains", "hotel brands", "individual properties", "resorts", "boutique hotels"]
        )
    },
    "restaurants": {
        "name": "Restaurants & Food Service",
        "description": "Track restaurant chains, fast food, and dining brands",
        "entity_types": ["restaurant chains", "fast food brands", "casual dining", "fine dining", "coffee shops"],
        "example_brands": ["McDonald's", "Starbucks", "Chipotle", "Olive Garden", "Domino's"],
        "extraction_focus": "restaurant and dining recommendations",
        "default_prompt": generate_default_prompt(
            "Restaurants & Food Service",
            "restaurant and dining recommendations",
            ["restaurant chains", "fast food brands", "casual dining", "fine dining", "coffee shops"]
        )
    },
    "airlines": {
        "name": "Airlines & Aviation",
        "description": "Track airline brands and aviation companies",
        "entity_types": ["airlines", "aviation companies", "low-cost carriers", "premium airlines"],
        "example_brands": ["Delta", "United", "American Airlines", "Southwest", "JetBlue", "Ryanair"],
        "extraction_focus": "airline and flight recommendations",
        "default_prompt": generate_default_prompt(
            "Airlines & Aviation",
            "airline and flight recommendations",
            ["airlines", "aviation companies", "low-cost carriers", "premium airlines"]
        )
    },
    "retail": {
        "name": "Retail & Consumer Brands",
        "description": "Track retail stores and consumer product brands",
        "entity_types": ["retail stores", "e-commerce brands", "consumer products", "fashion brands"],
        "example_brands": ["Amazon", "Walmart", "Target", "Nike", "Adidas", "Apple"],
        "extraction_focus": "product and retail recommendations",
        "default_prompt": generate_default_prompt(
            "Retail & Consumer Brands",
            "product and retail recommendations",
            ["retail stores", "e-commerce brands", "consumer products", "fashion brands"]
        )
    },
    "fashion": {
        "name": "Fashion & Apparel",
        "description": "Track fashion brands, clothing, and footwear",
        "entity_types": ["fashion brands", "clothing brands", "footwear brands", "luxury brands", "sportswear"],
        "example_brands": ["Nike", "Adidas", "Zara", "H&M", "Gucci", "Louis Vuitton", "Puma"],
        "extraction_focus": "fashion and apparel recommendations",
        "default_prompt": generate_default_prompt(
            "Fashion & Apparel",
            "fashion and apparel recommendations",
            ["fashion brands", "clothing brands", "footwear brands", "luxury brands", "sportswear"]
        )
    },
    "automotive": {
        "name": "Automotive",
        "description": "Track car brands and automotive companies",
        "entity_types": ["car manufacturers", "automotive brands", "EV companies", "luxury car brands"],
        "example_brands": ["Toyota", "Ford", "Tesla", "BMW", "Mercedes-Benz", "Honda"],
        "extraction_focus": "vehicle and automotive recommendations",
        "default_prompt": generate_default_prompt(
            "Automotive",
            "vehicle and automotive recommendations",
            ["car manufacturers", "automotive brands", "EV companies", "luxury car brands"]
        )
    },
    "technology": {
        "name": "Technology & Software",
        "description": "Track tech companies and software brands",
        "entity_types": ["tech companies", "software brands", "SaaS products", "hardware brands"],
        "example_brands": ["Apple", "Google", "Microsoft", "Amazon", "Meta", "Salesforce"],
        "extraction_focus": "technology and software recommendations",
        "default_prompt": generate_default_prompt(
            "Technology & Software",
            "technology and software recommendations",
            ["tech companies", "software brands", "SaaS products", "hardware brands"]
        )
    },
    "finance": {
        "name": "Finance & Banking",
        "description": "Track banks, financial services, and fintech",
        "entity_types": ["banks", "credit card companies", "fintech", "insurance companies", "investment firms"],
        "example_brands": ["Chase", "Bank of America", "PayPal", "Visa", "Mastercard", "Goldman Sachs"],
        "extraction_focus": "financial service recommendations",
        "default_prompt": generate_default_prompt(
            "Finance & Banking",
            "financial service recommendations",
            ["banks", "credit card companies", "fintech", "insurance companies", "investment firms"]
        )
    },
    "custom": {
        "name": "Custom Industry",
        "description": "Define your own industry and brand types",
        "entity_types": [],
        "example_brands": [],
        "extraction_focus": "brand and company recommendations",
        "default_prompt": generate_default_prompt(
            "Custom Industry",
            "brand and company recommendations",
            ["brand names", "company names"]
        )
    }
}


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


def expand_brands(existing_brands: list, industry: str = "hotels", brand_type: str = "first_party") -> Dict[str, Any]:
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
    
    industry_preset = INDUSTRY_PRESETS.get(industry, INDUSTRY_PRESETS.get("custom", {}))
    industry_name = industry_preset.get("name", "General")
    entity_types = industry_preset.get("entity_types", ["brands", "companies"])
    
    entity_types_str = ", ".join(entity_types) if entity_types else "brands and companies"
    brands_list = ", ".join(existing_brands)
    
    # Check for existing duplicates first
    existing_duplicates = find_duplicates(existing_brands)
    
    # Normalize existing brands for filtering
    existing_normalized = {normalize_brand(b) for b in existing_brands}
    
    prompt = f"""You are a brand expert for the {industry_name} industry.

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

    try:
        response_text = invoke_converse(prompt, EXPANSION_MODEL_ID, max_tokens=2000, temperature=0)
        
        if not response_text:
            return {"suggestions": [], "duplicates_found": existing_duplicates, "error": "Empty response"}
        
        # Parse JSON from response
        cleaned_text = response_text.strip()
        if '```' in cleaned_text:
            start_fence = cleaned_text.find('```')
            if start_fence != -1:
                newline_after_fence = cleaned_text.find('\n', start_fence)
                if newline_after_fence != -1:
                    cleaned_text = cleaned_text[newline_after_fence + 1:]
                end_fence = cleaned_text.rfind('```')
                if end_fence != -1:
                    cleaned_text = cleaned_text[:end_fence].strip()
        
        start_idx = cleaned_text.find('{')
        end_idx = cleaned_text.rfind('}') + 1
        
        if start_idx == -1 or end_idx == 0:
            return {"suggestions": [], "duplicates_found": existing_duplicates, "error": "Invalid response format"}
        
        json_str = cleaned_text[start_idx:end_idx]
        result = json.loads(json_str)
        
        suggestions = result.get("suggestions", [])
        
        # Filter out any suggestions that match existing brands (normalized)
        existing_normalized = {normalize_brand(b) for b in existing_brands}
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
        
    except Exception as e:
        logger.error(f"Error expanding brands: {str(e)}")
        return {
            "suggestions": [],
            "duplicates_found": existing_duplicates,
            "error": str(e)
        }


def expand_brand(brand_name: str, industry: str = "hotels", existing_brands: list = None) -> Dict[str, Any]:
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
    
    industry_preset = INDUSTRY_PRESETS.get(industry, INDUSTRY_PRESETS.get("custom", {}))
    industry_name = industry_preset.get("name", "General")
    entity_types = industry_preset.get("entity_types", ["brands", "companies"])
    example_brands = industry_preset.get("example_brands", [])
    
    # Build industry-specific examples
    entity_types_str = ", ".join(entity_types) if entity_types else "brands and companies"
    examples_str = ", ".join(example_brands[:5]) if example_brands else "major brands in this industry"
    
    # Build exclusion list for the prompt
    exclude_str = ", ".join(existing_brands) if existing_brands else "none"
    
    prompt = f"""You are a brand expert for the {industry_name} industry.

INDUSTRY CONTEXT:
- Entity types: {entity_types_str}
- Example brands in this industry: {examples_str}

ALREADY TRACKED (do NOT suggest these): {exclude_str}

Given the brand name "{brand_name}", list ALL related brand names that should be tracked together.

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

    try:
        response_text = invoke_converse(prompt, EXPANSION_MODEL_ID, max_tokens=1500, temperature=0)
        
        if not response_text:
            return {"main_brand": brand_name, "suggestions": [brand_name], "error": "Empty response"}
        
        # Parse JSON from response
        cleaned_text = response_text.strip()
        if '```' in cleaned_text:
            start_fence = cleaned_text.find('```')
            if start_fence != -1:
                newline_after_fence = cleaned_text.find('\n', start_fence)
                if newline_after_fence != -1:
                    cleaned_text = cleaned_text[newline_after_fence + 1:]
                end_fence = cleaned_text.rfind('```')
                if end_fence != -1:
                    cleaned_text = cleaned_text[:end_fence].strip()
        
        start_idx = cleaned_text.find('{')
        end_idx = cleaned_text.rfind('}') + 1
        
        if start_idx == -1 or end_idx == 0:
            return {"main_brand": brand_name, "suggestions": [brand_name], "error": "Invalid response format"}
        
        json_str = cleaned_text[start_idx:end_idx]
        result = json.loads(json_str)
        
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
        
    except Exception as e:
        logger.error(f"Error expanding brand name '{brand_name}': {str(e)}")
        return {
            "main_brand": brand_name,
            "suggestions": [brand_name],
            "error": str(e)
        }


def find_competitors(first_party_brands: list, industry: str = "hotels", existing_competitors: list = None) -> Dict[str, Any]:
    """
    Use LLM to find competitor brands based on first-party brands.
    
    This helps users discover competitors they should be tracking based on
    their own brand portfolio.
    """
    if existing_competitors is None:
        existing_competitors = []
    
    industry_preset = INDUSTRY_PRESETS.get(industry, INDUSTRY_PRESETS.get("custom", {}))
    industry_name = industry_preset.get("name", "General")
    entity_types = industry_preset.get("entity_types", ["brands", "companies"])
    example_brands = industry_preset.get("example_brands", [])
    
    brands_list = ", ".join(first_party_brands)
    entity_types_str = ", ".join(entity_types) if entity_types else "brands and companies"
    examples_str = ", ".join(example_brands[:5]) if example_brands else "major brands in this industry"
    
    # Build exclusion list
    exclude_brands = first_party_brands + existing_competitors
    exclude_str = ", ".join(exclude_brands) if exclude_brands else "none"
    
    prompt = f"""You are a competitive intelligence expert for the {industry_name} industry.

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

    try:
        response_text = invoke_converse(prompt, EXPANSION_MODEL_ID, max_tokens=2000, temperature=0)
        
        if not response_text:
            return {"first_party_brands": first_party_brands, "competitors": [], "error": "Empty response"}
        
        # Parse JSON from response
        cleaned_text = response_text.strip()
        if '```' in cleaned_text:
            start_fence = cleaned_text.find('```')
            if start_fence != -1:
                newline_after_fence = cleaned_text.find('\n', start_fence)
                if newline_after_fence != -1:
                    cleaned_text = cleaned_text[newline_after_fence + 1:]
                end_fence = cleaned_text.rfind('```')
                if end_fence != -1:
                    cleaned_text = cleaned_text[:end_fence].strip()
        
        start_idx = cleaned_text.find('{')
        end_idx = cleaned_text.rfind('}') + 1
        
        if start_idx == -1 or end_idx == 0:
            return {"first_party_brands": first_party_brands, "competitors": [], "error": "Invalid response format"}
        
        json_str = cleaned_text[start_idx:end_idx]
        result = json.loads(json_str)
        
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
        
    except Exception as e:
        logger.error(f"Error finding competitors: {str(e)}")
        return {
            "first_party_brands": first_party_brands,
            "competitors": [],
            "error": str(e)
        }


def get_config() -> Dict[str, Any]:
    """Get the current brand configuration."""
    table = dynamodb.Table(DYNAMODB_TABLE_BRAND_CONFIG)
    response = table.get_item(Key={'config_id': 'default'})
    return response.get('Item')


def save_config(config: Dict[str, Any]) -> Dict[str, Any]:
    """Save brand configuration."""
    table = dynamodb.Table(DYNAMODB_TABLE_BRAND_CONFIG)
    
    config['config_id'] = 'default'
    config['updated_at'] = datetime.utcnow().isoformat() + 'Z'
    
    table.put_item(Item=config)
    return config


# --- Route Handlers ---

def _get_presets(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """GET /brand-config/presets - Return industry presets."""
    return success_response({'presets': INDUSTRY_PRESETS}, event)


@parse_json_body
@validate({
    'brand_name': {'required': True, 'type': str, 'max_length': 200, 'source': 'body'},
    'industry': {'type': str, 'max_length': 50, 'default': 'hotels', 'source': 'body'},
    'existing_brands': {'type': list, 'default': [], 'source': 'body'}
})
def _expand_brand(event: Dict[str, Any], context: Any, body: Dict, brand_name: str, industry: str, existing_brands: list) -> Dict[str, Any]:
    """POST /brand-config/expand - Expand a brand name to related sub-brands."""
    result = expand_brand(brand_name.strip(), industry, existing_brands)
    return success_response(result, event)


@parse_json_body
@validate({
    'existing_brands': {'required': True, 'type': list, 'source': 'body'},
    'industry': {'type': str, 'max_length': 50, 'default': 'hotels', 'source': 'body'},
    'brand_type': {'type': str, 'choices': ['first_party', 'competitor'], 'default': 'first_party', 'source': 'body'}
})
def _expand_all_brands(event: Dict[str, Any], context: Any, body: Dict, existing_brands: list, industry: str, brand_type: str) -> Dict[str, Any]:
    """POST /brand-config/expand-all - Expand ALL brands to find missing sub-brands."""
    if not existing_brands:
        return validation_error('Please add at least one brand first', event, 'existing_brands')
    
    result = expand_brands(existing_brands, industry, brand_type)
    return success_response(result, event)


@parse_json_body
@validate({
    'first_party_brands': {'required': True, 'type': list, 'source': 'body'},
    'industry': {'type': str, 'max_length': 50, 'default': 'hotels', 'source': 'body'},
    'existing_competitors': {'type': list, 'default': [], 'source': 'body'}
})
def _find_competitors(event: Dict[str, Any], context: Any, body: Dict, first_party_brands: list, industry: str, existing_competitors: list) -> Dict[str, Any]:
    """POST /brand-config/find-competitors - Find competitors based on first-party brands."""
    if not first_party_brands:
        return validation_error('Missing required field: first_party_brands', event, 'first_party_brands')
    
    result = find_competitors(first_party_brands, industry, existing_competitors)
    return success_response(result, event)


def _get_config(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
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
            'created_at': datetime.utcnow().isoformat() + 'Z'
        }
    
    return success_response(config, event)


@parse_json_body
@validate({
    'industry': {'required': True, 'type': str, 'source': 'body'}
})
def _save_config(event: Dict[str, Any], context: Any, body: Dict, industry: str) -> Dict[str, Any]:
    """POST/PUT /brand-config - Create or update configuration."""
    # Validate industry
    if industry not in INDUSTRY_PRESETS:
        return validation_error(
            f"Invalid industry. Must be one of: {', '.join(INDUSTRY_PRESETS.keys())}",
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


def _reset_config(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """DELETE /brand-config - Reset to defaults."""
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
def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
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
