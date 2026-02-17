"""
Brand Mention Extractor

Uses LLM (Bedrock) to intelligently extract brand mentions from search responses.
Supports multiple industries with configurable extraction prompts and brand tracking.

Classification is done entirely by the LLM using brand examples as guidelines,
not exact string matching. This allows the LLM to understand brand hierarchies
(e.g., sub-brands belonging to parent companies).
"""

import json
import logging
import os
import boto3
from typing import List, Dict, Any, Optional

# Import shared utilities from Lambda layer
from shared.utils import get_brand_config

logger = logging.getLogger(__name__)

# Initialize AWS clients - no region needed for global inference profiles
bedrock = boto3.client('bedrock-runtime')

# Use Haiku 4.5 for brand extraction - same model used in content-studio
DEFAULT_MODEL_ID = "global.anthropic.claude-haiku-4-5-20251001-v1:0"


def invoke_converse(prompt: str, model_id: str = DEFAULT_MODEL_ID, max_tokens: int = 2000, temperature: float = 0) -> str:
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
    logger.info(f"Invoking Bedrock Converse API with model: {model_id}")
    try:
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
        result = content_blocks[0].get('text', '') if content_blocks else ''
        logger.info(f"Bedrock response received, length: {len(result)} chars")
        return result
    except Exception as e:
        logger.error(f"Bedrock Converse API call failed: {str(e)}")
        raise

# Industry presets with pre-built extraction prompts
INDUSTRY_PRESETS = {
    "hotels": {
        "name": "Hotels & Hospitality",
        "description": "Track hotel brands, chains, and individual properties",
        "entity_types": ["hotel chains", "hotel brands", "individual properties", "resorts", "boutique hotels"],
        "example_brands": ["Brand A", "Brand B", "Brand C", "Brand D", "Brand E"],
        "extraction_focus": "hotel and accommodation recommendations"
    },
    "restaurants": {
        "name": "Restaurants & Food Service",
        "description": "Track restaurant chains, fast food, and dining brands",
        "entity_types": ["restaurant chains", "fast food brands", "casual dining", "fine dining", "coffee shops"],
        "example_brands": ["McDonald's", "Starbucks", "Chipotle", "Olive Garden", "Domino's"],
        "extraction_focus": "restaurant and dining recommendations"
    },
    "airlines": {
        "name": "Airlines & Aviation",
        "description": "Track airline brands and aviation companies",
        "entity_types": ["airlines", "aviation companies", "low-cost carriers", "premium airlines"],
        "example_brands": ["Delta", "United", "American Airlines", "Southwest", "JetBlue", "Ryanair"],
        "extraction_focus": "airline and flight recommendations"
    },
    "retail": {
        "name": "Retail & Consumer Brands",
        "description": "Track retail stores and consumer product brands",
        "entity_types": ["retail stores", "e-commerce brands", "consumer products", "fashion brands"],
        "example_brands": ["Amazon", "Walmart", "Target", "Nike", "Adidas", "Apple"],
        "extraction_focus": "product and retail recommendations"
    },
    "fashion": {
        "name": "Fashion & Apparel",
        "description": "Track fashion brands, clothing, and footwear",
        "entity_types": ["fashion brands", "clothing brands", "footwear brands", "luxury brands", "sportswear"],
        "example_brands": ["Nike", "Adidas", "Zara", "H&M", "Gucci", "Louis Vuitton", "Puma"],
        "extraction_focus": "fashion and apparel recommendations"
    },
    "automotive": {
        "name": "Automotive",
        "description": "Track car brands and automotive companies",
        "entity_types": ["car manufacturers", "automotive brands", "EV companies", "luxury car brands"],
        "example_brands": ["Toyota", "Ford", "Tesla", "BMW", "Mercedes-Benz", "Honda"],
        "extraction_focus": "vehicle and automotive recommendations"
    },
    "technology": {
        "name": "Technology & Software",
        "description": "Track tech companies and software brands",
        "entity_types": ["tech companies", "software brands", "SaaS products", "hardware brands"],
        "example_brands": ["Apple", "Google", "Microsoft", "Amazon", "Meta", "Salesforce"],
        "extraction_focus": "technology and software recommendations"
    },
    "finance": {
        "name": "Finance & Banking",
        "description": "Track banks, financial services, and fintech",
        "entity_types": ["banks", "credit card companies", "fintech", "insurance companies", "investment firms"],
        "example_brands": ["Chase", "Bank of America", "PayPal", "Visa", "Mastercard", "Goldman Sachs"],
        "extraction_focus": "financial service recommendations"
    },
    "custom": {
        "name": "Custom Industry",
        "description": "Define your own industry and brand types",
        "entity_types": [],
        "example_brands": [],
        "extraction_focus": "brand and company recommendations"
    }
}

# Default extraction configuration
DEFAULT_EXTRACTION_CONFIG = {
    "industry": "hotels",
    "extract_brands": True,
    "include_sentiment": True,
    "include_ranking_context": True,
    "max_brands": 20,
    "tracked_brands": {
        "first_party": [],  # Your own brands
        "competitors": []   # Competitor brands to track
    },
    "custom_entity_types": [],
    "custom_prompt_additions": ""
}


class LLMBrandExtractor:
    """Extract brand mentions using LLM for intelligent parsing and classification."""
    
    def __init__(self, model_id: str = DEFAULT_MODEL_ID, config: Optional[Dict] = None):
        self.model_id = model_id
        # Use default config if None or empty dict
        self.config = config if config else DEFAULT_EXTRACTION_CONFIG
        self.industry = self.config.get("industry", "hotels")
        self.industry_preset = INDUSTRY_PRESETS.get(self.industry, INDUSTRY_PRESETS["custom"])
    
    def extract_mentions(self, text: str) -> List[Dict[str, Any]]:
        """
        Extract brand mentions from text using LLM.
        
        Returns:
            List of dicts with brand information
        """
        if not text:
            return []
        
        logger.info(f"Brand extraction input text length: {len(text)} chars")
        
        # Build extraction prompt based on config
        prompt = self._build_extraction_prompt(text)
        
        try:
            # Call Bedrock using Converse API
            response_text = invoke_converse(prompt, self.model_id, max_tokens=2000, temperature=0)
            
            if not response_text:
                logger.warning("Empty response from Bedrock")
                return []
            brands = self._parse_llm_response(response_text)
            
            # Classify brands as first_party, competitor, or other
            brands = self._classify_brands(brands)
            
            logger.info(f"LLM extracted {len(brands)} brand mentions")
            return brands
            
        except Exception as e:
            logger.error(f"Error calling Bedrock for brand extraction: {str(e)}")
            return []
    
    def _build_extraction_prompt(self, text: str) -> str:
        """Build the extraction prompt based on configuration."""
        
        # Get entity types from preset or custom config
        entity_types = self.industry_preset.get("entity_types", [])
        custom_types = self.config.get("custom_entity_types", [])
        all_entity_types = entity_types + custom_types
        
        # Build entity type description
        if all_entity_types:
            entity_desc = "\n".join([f"- {et}" for et in all_entity_types])
        else:
            entity_desc = "- Brand names and company names"
        
        # Get tracked brands for classification
        tracked_brands = self.config.get("tracked_brands", {})
        first_party = tracked_brands.get("first_party", [])
        competitors = tracked_brands.get("competitors", [])
        
        # Build classification instruction - LLM-based using examples as guidelines
        classification_instruction = """
BRAND CLASSIFICATION (CRITICAL - READ CAREFULLY):
For each brand mentioned, classify it into one of these categories:
- "first_party": Brands that belong to or are affiliated with the user's company
- "competitor": Brands that compete with the user's company  
- "other": All other brands not related to first_party or competitors"""
        
        if first_party or competitors:
            classification_instruction += f"""

FIRST PARTY BRAND EXAMPLES (classify as "first_party"):
{', '.join(first_party) if first_party else 'None specified'}

COMPETITOR BRAND EXAMPLES (classify as "competitor"):
{', '.join(competitors) if competitors else 'None specified'}

CRITICAL CLASSIFICATION RULES - USE INTELLIGENT MATCHING:
1. The brand names above are EXAMPLES, not exact matches required
2. Match by brand family/parent company:
   - If a parent company is tracked, ALL its sub-brands and subsidiaries should be classified the same way
   - Use your knowledge of corporate ownership and brand portfolios in this industry
   - Sub-brands, loyalty programs, and acquired brands all inherit the parent classification
3. Match by ownership knowledge:
   - Use your knowledge of which brands own which properties or subsidiaries
   - Individual property or product names may belong to larger groups
4. When genuinely uncertain about ownership, classify as "other"
5. DO NOT require exact string matches - use semantic understanding
"""
        else:
            classification_instruction += """

No first_party or competitor brands have been configured yet.
Classify all brands as "other" until the user configures their brand tracking.
"""
        
        # Sentiment instruction
        sentiment_instruction = ""
        if self.config.get("include_sentiment", True):
            sentiment_instruction = """
- sentiment: Overall sentiment about this brand (positive/neutral/negative/mixed)
- sentiment_reason: Brief reason for the sentiment (1 sentence)"""
        
        # Ranking context instruction
        ranking_instruction = ""
        if self.config.get("include_ranking_context", True):
            ranking_instruction = """
- ranking_context: How this brand is positioned (e.g., "recommended as #1", "mentioned as budget option", "noted for quality")"""
        
        # Custom prompt additions
        custom_additions = self.config.get("custom_prompt_additions", "")
        if custom_additions:
            custom_additions = f"\n\nADDITIONAL INSTRUCTIONS:\n{custom_additions}"
        
        # Industry-specific focus
        extraction_focus = self.industry_preset.get("extraction_focus", "brand recommendations")
        
        prompt = f"""Extract all brand and company mentions from the following text.

INDUSTRY CONTEXT: {self.industry_preset.get('name', 'General')}
FOCUS: {extraction_focus}

ENTITY TYPES TO EXTRACT:
{entity_desc}
{classification_instruction}

For each brand found, provide:
- name: Full brand/company name as mentioned
- parent_company: Parent company if identifiable (or null)
- classification: REQUIRED - must be "first_party", "competitor", or "other" based on the rules above
- mention_count: Number of times mentioned
- first_position: Character position of first mention (approximate)
- rank: Order of first appearance (1 = first mentioned){sentiment_instruction}{ranking_instruction}
{custom_additions}
Return ONLY a valid JSON array with no additional text. Format:
[
  {{
    "name": "Brand Name",
    "parent_company": "Parent Company or null",
    "classification": "first_party|competitor|other",
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
{text}

JSON OUTPUT:"""
        
        return prompt
    
    def _classify_brands(self, brands: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Validate brand classifications from LLM.
        We trust the LLM's classification entirely - no fuzzy matching fallback.
        This method just ensures the classification field exists.
        """
        for brand in brands:
            # Ensure classification exists, default to "other" if missing
            if brand.get("classification") not in ["first_party", "competitor", "other"]:
                brand["classification"] = "other"
        
        return brands
    
    def _parse_llm_response(self, response_text: str) -> List[Dict[str, Any]]:
        """Parse the LLM's JSON response."""
        try:
            # Strip markdown code blocks if present (```json ... ``` or ``` ... ```)
            cleaned_text = response_text.strip()
            
            # Handle markdown code blocks (with or without language specifier)
            if '```' in cleaned_text:
                # Find the first ``` and remove everything up to and including the newline after it
                start_fence = cleaned_text.find('```')
                if start_fence != -1:
                    # Find the newline after the opening fence
                    newline_after_fence = cleaned_text.find('\n', start_fence)
                    if newline_after_fence != -1:
                        cleaned_text = cleaned_text[newline_after_fence + 1:]
                    # Remove closing fence
                    end_fence = cleaned_text.rfind('```')
                    if end_fence != -1:
                        cleaned_text = cleaned_text[:end_fence].strip()
            
            # Try to extract JSON from response
            start_idx = cleaned_text.find('[')
            end_idx = cleaned_text.rfind(']') + 1
            
            if start_idx == -1 or end_idx == 0:
                logger.warning(f"No JSON array found in LLM response. Response preview: {response_text[:500]}")
                return []
            
            json_str = cleaned_text[start_idx:end_idx]
            brands = json.loads(json_str)
            
            # Validate structure
            if not isinstance(brands, list):
                logger.warning("LLM response is not a list")
                return []
            
            return brands
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse LLM JSON response: {str(e)}")
            logger.error(f"Response text preview: {response_text[:500]}")
            return []


def get_industry_presets() -> Dict[str, Any]:
    """Return all available industry presets."""
    return INDUSTRY_PRESETS


def extract_brands_from_response(response_text: str, config: Optional[Dict] = None) -> Dict[str, Any]:
    """
    Extract brand mentions from LLM response using Bedrock.
    
    Args:
        response_text: The full LLM response text
        config: Optional extraction configuration (if None or empty, loads from DynamoDB)
    
    Returns:
        Dict with 'brands' (list of mentions) and 'brand_count'
    """
    # Try to load config from DynamoDB if not provided or empty
    if not config:
        loaded_config = get_brand_config()
        # Use loaded config only if it has actual content
        config = loaded_config if loaded_config else None
        logger.info(f"Loaded brand config from DynamoDB: {bool(config)}, industry: {config.get('industry') if config else 'default'}")
    
    logger.info(f"Starting brand extraction for text of {len(response_text)} chars")
    
    extractor = LLMBrandExtractor(config=config)
    mentions = extractor.extract_mentions(response_text)
    
    logger.info(f"Brand extraction complete: {len(mentions)} brands found")
    
    # Separate by classification
    first_party = [b for b in mentions if b.get("classification") == "first_party"]
    competitors = [b for b in mentions if b.get("classification") == "competitor"]
    others = [b for b in mentions if b.get("classification") == "other"]
    
    return {
        'brands': mentions,
        'brand_count': len(mentions),
        'first_party_count': len(first_party),
        'competitor_count': len(competitors),
        'other_count': len(others),
        'extraction_config': config or DEFAULT_EXTRACTION_CONFIG
    }


def expand_brand_names(brand_name: str, industry: str = "hotels") -> Dict[str, Any]:
    """
    Use LLM to expand a brand name into related sub-brands, variations, and owned properties.
    
    This helps users configure comprehensive brand tracking by suggesting all the
    brand variations that should be tracked together.
    
    Args:
        brand_name: The main brand name to expand
        industry: The industry context for better suggestions
    
    Returns:
        Dict with 'suggestions' (list of related brand names) and metadata
    """
    industry_preset = INDUSTRY_PRESETS.get(industry, INDUSTRY_PRESETS.get("custom", {}))
    industry_name = industry_preset.get("name", "General")
    
    prompt = f"""You are a brand expert for the {industry_name} industry.

Given the brand name "{brand_name}", list ALL related brand names that should be tracked together.

Include:
1. Sub-brands and brand tiers
2. Owned/acquired brands and subsidiaries
3. Common variations, abbreviations, and alternate spellings
4. Loyalty program names if relevant
5. Regional variations if any

DO NOT include:
- Competitor brands
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
  "notes": "Brief explanation of the brand structure"
}}

JSON OUTPUT:"""

    try:
        # Call Bedrock using Converse API
        response_text = invoke_converse(prompt, DEFAULT_MODEL_ID, max_tokens=1500, temperature=0)
        
        if not response_text:
            logger.warning("Empty response from Bedrock for brand expansion")
            return {"main_brand": brand_name, "suggestions": [], "error": "Empty response"}
        
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
            logger.warning(f"No JSON object found in brand expansion response")
            return {"main_brand": brand_name, "suggestions": [], "error": "Invalid response format"}
        
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
