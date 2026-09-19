"""
Single source of truth for industry preset metadata.

Both ``search/brand_extractor.py`` (the LLM extraction pipeline) and
``api/manage-brand-config.py`` (the dashboard settings API) need the same
industry catalog. Previously each file declared its own ``INDUSTRY_PRESETS``
dict; the two copies drifted in shape (the API version baked a
``default_prompt`` string into every entry, computed from the other fields).

This module holds the structural data. Handlers that need the
``default_prompt`` derive it at request time from the helper they already
own — that keeps this module free of API-specific presentation concerns and
avoids pulling the prompt-template scaffolding into the extraction Lambda.
"""

from __future__ import annotations

from typing import TypedDict


class IndustryPreset(TypedDict):
    """Shape of a single preset entry. The ``default_prompt`` is not part
    of this contract — it's a derived value owned by the dashboard API."""

    name: str
    description: str
    entity_types: list[str]
    example_brands: list[str]
    extraction_focus: str


DEFAULT_INDUSTRY_ID = "general"


INDUSTRY_PRESETS: dict[str, IndustryPreset] = {
    "general": {
        "name": "General",
        "description": "Track brands and companies in any industry",
        "entity_types": [],
        "example_brands": [],
        "extraction_focus": "brand and company recommendations",
    },
    "hotels": {
        "name": "Hotels & Hospitality",
        "description": "Track hotel brands, chains, and individual properties",
        "entity_types": [
            "hotel chains", "hotel brands", "individual properties", "resorts", "boutique hotels",
        ],
        "example_brands": [
            "Marriott", "Hilton", "Hyatt", "InterContinental", "Four Seasons",
        ],
        "extraction_focus": "hotel and accommodation recommendations",
    },
    "restaurants": {
        "name": "Restaurants & Food Service",
        "description": "Track restaurant chains, fast food, and dining brands",
        "entity_types": [
            "restaurant chains", "fast food brands", "casual dining", "fine dining", "coffee shops",
        ],
        "example_brands": [
            "McDonald's", "Starbucks", "Chipotle", "Olive Garden", "Domino's",
        ],
        "extraction_focus": "restaurant and dining recommendations",
    },
    "airlines": {
        "name": "Airlines & Aviation",
        "description": "Track airline brands and aviation companies",
        "entity_types": [
            "airlines", "aviation companies", "low-cost carriers", "premium airlines",
        ],
        "example_brands": [
            "Delta", "United", "American Airlines", "Southwest", "JetBlue", "Ryanair",
        ],
        "extraction_focus": "airline and flight recommendations",
    },
    "retail": {
        "name": "Retail & Consumer Brands",
        "description": "Track retail stores and consumer product brands",
        "entity_types": [
            "retail stores", "e-commerce brands", "consumer products", "fashion brands",
        ],
        "example_brands": [
            "Amazon", "Walmart", "Target", "Nike", "Adidas", "Apple",
        ],
        "extraction_focus": "product and retail recommendations",
    },
    "fashion": {
        "name": "Fashion & Apparel",
        "description": "Track fashion brands, clothing, and footwear",
        "entity_types": [
            "fashion brands", "clothing brands", "footwear brands", "luxury brands", "sportswear",
        ],
        "example_brands": [
            "Nike", "Adidas", "Zara", "H&M", "Gucci", "Louis Vuitton", "Puma",
        ],
        "extraction_focus": "fashion and apparel recommendations",
    },
    "automotive": {
        "name": "Automotive",
        "description": "Track car brands and automotive companies",
        "entity_types": [
            "car manufacturers", "automotive brands", "EV companies", "luxury car brands",
        ],
        "example_brands": [
            "Toyota", "Ford", "Tesla", "BMW", "Mercedes-Benz", "Honda",
        ],
        "extraction_focus": "vehicle and automotive recommendations",
    },
    "technology": {
        "name": "Technology & Software",
        "description": "Track tech companies and software brands",
        "entity_types": [
            "tech companies", "software brands", "SaaS products", "hardware brands",
        ],
        "example_brands": [
            "Apple", "Google", "Microsoft", "Amazon", "Meta", "Salesforce",
        ],
        "extraction_focus": "technology and software recommendations",
    },
    "finance": {
        "name": "Finance & Banking",
        "description": "Track banks, financial services, and fintech",
        "entity_types": [
            "banks", "credit card companies", "fintech", "insurance companies", "investment firms",
        ],
        "example_brands": [
            "Chase", "Bank of America", "PayPal", "Visa", "Mastercard", "Goldman Sachs",
        ],
        "extraction_focus": "financial service recommendations",
    },
    "custom": {
        "name": "Custom Industry",
        "description": "Define your own industry and brand types",
        "entity_types": [],
        "example_brands": [],
        "extraction_focus": "brand and company recommendations",
    },
}


def get_preset(industry_id: str) -> IndustryPreset:
    """Look up a preset by industry id, falling back to ``custom``.

    Both callers (brand extractor, dashboard API) were doing the same
    ``.get(id, presets["custom"])`` lookup inline. Centralizing here keeps
    the fallback consistent and defends against typos in future callers.
    """
    return INDUSTRY_PRESETS.get(industry_id, INDUSTRY_PRESETS["custom"])
