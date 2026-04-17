"""
Brand Mention Extractor

Uses LLM (Bedrock) to intelligently extract brand mentions from search responses.
Supports multiple industries with configurable extraction prompts and brand tracking.

Classification is done entirely by the LLM using brand examples as guidelines,
not exact string matching. This allows the LLM to understand brand hierarchies
(e.g., sub-brands belonging to parent companies).
"""

import logging
from typing import List, Dict, Any, Optional

# Import shared utilities from Lambda layer
from shared.utils import get_brand_config
from shared.models import ModelRole, invoke_bedrock
from shared.llm_json import parse_llm_json

logger = logging.getLogger(__name__)

# Industry presets with pre-built extraction prompts
INDUSTRY_PRESETS = {
    "hotels": {
        "name": "Hotels & Hospitality",
        "description": "Track hotel brands, chains, and individual properties",
        "entity_types": ["hotel chains", "hotel brands", "individual properties", "resorts", "boutique hotels"],
        "example_brands": ["Marriott", "Hilton", "Hyatt", "InterContinental", "Four Seasons"],
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
    
    def __init__(self, model_id: Optional[str] = None, config: Optional[Dict] = None):
        # model_id is accepted for backward compatibility but ignored.
        # Model resolution now flows through shared.models.ModelRole.EXTRACTION.
        if model_id is not None:
            logger.debug("model_id argument to LLMBrandExtractor is ignored; "
                         "models are resolved via shared.models.ModelRole.EXTRACTION")
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
            # Call shared Bedrock client with EXTRACTION role
            response_text = invoke_bedrock(prompt, ModelRole.EXTRACTION, max_tokens=4000, temperature=0)
            
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
        """Parse the LLM's JSON array response via the shared helper."""
        brands = parse_llm_json(response_text, expect="array")
        if brands is None:
            logger.warning(
                "brand_extraction_parse_failed preview=%r",
                response_text[:300],
            )
            return []
        return brands


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
    # Try to load config from DynamoDB if not provided
    if config is None:
        loaded_config = get_brand_config()
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
