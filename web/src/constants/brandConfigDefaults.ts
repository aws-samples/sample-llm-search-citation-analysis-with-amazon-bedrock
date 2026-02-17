import type {
  BrandConfig, IndustryPresets 
} from '../types';

const generateDefaultPrompt = (
  industryName: string,
  extractionFocus: string,
  entityTypes: string[]
): string => {
  const entityDesc =
    entityTypes.length > 0
      ? entityTypes.map((et) => `- ${et}`).join('\n')
      : '- Brand names and company names';

  return `Extract all brand and company mentions from the following text.

INDUSTRY CONTEXT: ${industryName}
FOCUS: ${extractionFocus}

ENTITY TYPES TO EXTRACT:
${entityDesc}

{{TRACKED_BRANDS}}

For each brand found, provide:
- name: Full brand/company name as mentioned
- parent_company: Parent company if identifiable (or null)
- mention_count: Number of times mentioned
- first_position: Character position of first mention (approximate)
- rank: Order of first appearance (1 = first mentioned)
{{SENTIMENT_FIELDS}}
{{RANKING_CONTEXT_FIELD}}

{{CUSTOM_INSTRUCTIONS}}

Return ONLY a valid JSON array with no additional text. Format:
[
  {
    "name": "Brand Name",
    "parent_company": "Parent Company or null",
    "mention_count": 2,
    "first_position": 150,
    "rank": 1,
    "sentiment": "positive",
    "sentiment_reason": "Praised for quality and value",
    "ranking_context": "Recommended as top choice"
  }
]

If no brands are found, return an empty array: []

TEXT TO ANALYZE:
{{TEXT}}

JSON OUTPUT:`;
};

export const DEFAULT_PRESETS: IndustryPresets = {
  hotels: {
    name: 'Hotels & Hospitality',
    description: 'Track hotel brands, chains, and individual properties',
    entity_types: ['hotel chains', 'hotel brands', 'individual properties', 'resorts', 'boutique hotels'],
    example_brands: ['Brand A', 'Brand B', 'Brand C', 'Brand D', 'Brand E'],
    extraction_focus: 'hotel and accommodation recommendations',
    default_prompt: generateDefaultPrompt(
      'Hotels & Hospitality',
      'hotel and accommodation recommendations',
      ['hotel chains', 'hotel brands', 'individual properties', 'resorts', 'boutique hotels']
    ),
  },
  restaurants: {
    name: 'Restaurants & Food Service',
    description: 'Track restaurant chains, fast food, and dining brands',
    entity_types: ['restaurant chains', 'fast food brands', 'casual dining', 'fine dining', 'coffee shops'],
    example_brands: ["McDonald's", 'Starbucks', 'Chipotle', 'Olive Garden', "Domino's"],
    extraction_focus: 'restaurant and dining recommendations',
    default_prompt: generateDefaultPrompt(
      'Restaurants & Food Service',
      'restaurant and dining recommendations',
      ['restaurant chains', 'fast food brands', 'casual dining', 'fine dining', 'coffee shops']
    ),
  },
  airlines: {
    name: 'Airlines & Aviation',
    description: 'Track airline brands and aviation companies',
    entity_types: ['airlines', 'aviation companies', 'low-cost carriers', 'premium airlines'],
    example_brands: ['Delta', 'United', 'American Airlines', 'Southwest', 'JetBlue', 'Ryanair'],
    extraction_focus: 'airline and flight recommendations',
    default_prompt: generateDefaultPrompt(
      'Airlines & Aviation',
      'airline and flight recommendations',
      ['airlines', 'aviation companies', 'low-cost carriers', 'premium airlines']
    ),
  },
  retail: {
    name: 'Retail & Consumer Brands',
    description: 'Track retail stores and consumer product brands',
    entity_types: ['retail stores', 'e-commerce brands', 'consumer products', 'fashion brands'],
    example_brands: ['Amazon', 'Walmart', 'Target', 'Nike', 'Adidas', 'Apple'],
    extraction_focus: 'product and retail recommendations',
    default_prompt: generateDefaultPrompt(
      'Retail & Consumer Brands',
      'product and retail recommendations',
      ['retail stores', 'e-commerce brands', 'consumer products', 'fashion brands']
    ),
  },
  fashion: {
    name: 'Fashion & Apparel',
    description: 'Track fashion brands, clothing, and footwear',
    entity_types: ['fashion brands', 'clothing brands', 'footwear brands', 'luxury brands', 'sportswear'],
    example_brands: ['Nike', 'Adidas', 'Zara', 'H&M', 'Gucci', 'Louis Vuitton', 'Puma'],
    extraction_focus: 'fashion and apparel recommendations',
    default_prompt: generateDefaultPrompt(
      'Fashion & Apparel',
      'fashion and apparel recommendations',
      ['fashion brands', 'clothing brands', 'footwear brands', 'luxury brands', 'sportswear']
    ),
  },
  automotive: {
    name: 'Automotive',
    description: 'Track car brands and automotive companies',
    entity_types: ['car manufacturers', 'automotive brands', 'EV companies', 'luxury car brands'],
    example_brands: ['Toyota', 'Ford', 'Tesla', 'BMW', 'Mercedes-Benz', 'Honda'],
    extraction_focus: 'vehicle and automotive recommendations',
    default_prompt: generateDefaultPrompt('Automotive', 'vehicle and automotive recommendations', [
      'car manufacturers', 'automotive brands', 'EV companies', 'luxury car brands',
    ]),
  },
  technology: {
    name: 'Technology & Software',
    description: 'Track tech companies and software brands',
    entity_types: ['tech companies', 'software brands', 'SaaS products', 'hardware brands'],
    example_brands: ['Apple', 'Google', 'Microsoft', 'Amazon', 'Meta', 'Salesforce'],
    extraction_focus: 'technology and software recommendations',
    default_prompt: generateDefaultPrompt(
      'Technology & Software',
      'technology and software recommendations',
      ['tech companies', 'software brands', 'SaaS products', 'hardware brands']
    ),
  },
  finance: {
    name: 'Finance & Banking',
    description: 'Track banks, financial services, and fintech',
    entity_types: ['banks', 'credit card companies', 'fintech', 'insurance companies', 'investment firms'],
    example_brands: ['Chase', 'Bank of America', 'PayPal', 'Visa', 'Mastercard', 'Goldman Sachs'],
    extraction_focus: 'financial service recommendations',
    default_prompt: generateDefaultPrompt(
      'Finance & Banking',
      'financial service recommendations',
      ['banks', 'credit card companies', 'fintech', 'insurance companies', 'investment firms']
    ),
  },
  custom: {
    name: 'Custom Industry',
    description: 'Define your own industry and brand types',
    entity_types: [],
    example_brands: [],
    extraction_focus: 'brand and company recommendations',
    default_prompt: generateDefaultPrompt('Custom Industry', 'brand and company recommendations', [
      'brand names', 'company names',
    ]),
  },
};

export const DEFAULT_CONFIG: BrandConfig = {
  config_id: 'default',
  industry: 'hotels',
  extract_brands: true,
  include_sentiment: true,
  include_ranking_context: true,
  max_brands: 20,
  tracked_brands: {
    first_party: [],
    competitors: [] 
  },
  custom_entity_types: [],
  custom_prompt_additions: '',
  // Custom prompts per industry (overrides defaults)
  industry_prompts: {},
};
