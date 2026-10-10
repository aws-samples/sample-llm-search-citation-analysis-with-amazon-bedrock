import type {
  BrandConfig, IndustryPresets 
} from '../types';

export const DEFAULT_BRAND_INDUSTRY = 'general';

export const resolveBrandIndustryPreset = (
  presets: IndustryPresets | null | undefined,
  industry: string
): IndustryPresets[string] | undefined => presets?.[industry] ?? presets?.custom;

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
- name: The company's canonical name (when it is one of the tracked brands, use that tracked spelling exactly)
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
    "sentiment_quote": "Brand Name is the best choice for families, with spacious rooms.",
    "sentiment_reason": "The answer recommends the brand for families and praises its rooms.",
    "ranking_context": "Recommended as top choice"
  }
]

If no brands are found, return an empty array: []

TEXT TO ANALYZE:
{{TEXT}}

JSON OUTPUT:`;
};

export const DEFAULT_PRESETS: IndustryPresets = {
  general: {
    name: 'General',
    description: 'Track brands and companies in any industry',
    example_brands: [],
    default_prompt: generateDefaultPrompt(
      'General',
      'brand and company recommendations',
      []
    ),
  },
  hotels: {
    name: 'Hotels & Hospitality',
    description: 'Track hotel brands, chains, and individual properties',
    example_brands: ['Marriott', 'Hilton', 'Hyatt', 'InterContinental', 'Four Seasons'],
    default_prompt: generateDefaultPrompt(
      'Hotels & Hospitality',
      'hotel and accommodation recommendations',
      ['hotel chains', 'hotel brands', 'individual properties', 'resorts', 'boutique hotels']
    ),
  },
  restaurants: {
    name: 'Restaurants & Food Service',
    description: 'Track restaurant chains, fast food, and dining brands',
    example_brands: ["McDonald's", 'Starbucks', 'Chipotle', 'Olive Garden', "Domino's"],
    default_prompt: generateDefaultPrompt(
      'Restaurants & Food Service',
      'restaurant and dining recommendations',
      ['restaurant chains', 'fast food brands', 'casual dining', 'fine dining', 'coffee shops']
    ),
  },
  airlines: {
    name: 'Airlines & Aviation',
    description: 'Track airline brands and aviation companies',
    example_brands: ['Delta', 'United', 'American Airlines', 'Southwest', 'JetBlue', 'Ryanair'],
    default_prompt: generateDefaultPrompt(
      'Airlines & Aviation',
      'airline and flight recommendations',
      ['airlines', 'aviation companies', 'low-cost carriers', 'premium airlines']
    ),
  },
  retail: {
    name: 'Retail & Consumer Brands',
    description: 'Track retail stores and consumer product brands',
    example_brands: ['Amazon', 'Walmart', 'Target', 'Nike', 'Adidas', 'Apple'],
    default_prompt: generateDefaultPrompt(
      'Retail & Consumer Brands',
      'product and retail recommendations',
      ['retail stores', 'e-commerce brands', 'consumer products', 'fashion brands']
    ),
  },
  fashion: {
    name: 'Fashion & Apparel',
    description: 'Track fashion brands, clothing, and footwear',
    example_brands: ['Nike', 'Adidas', 'Zara', 'H&M', 'Gucci', 'Louis Vuitton', 'Puma'],
    default_prompt: generateDefaultPrompt(
      'Fashion & Apparel',
      'fashion and apparel recommendations',
      ['fashion brands', 'clothing brands', 'footwear brands', 'luxury brands', 'sportswear']
    ),
  },
  automotive: {
    name: 'Automotive',
    description: 'Track car brands and automotive companies',
    example_brands: ['Toyota', 'Ford', 'Tesla', 'BMW', 'Mercedes-Benz', 'Honda'],
    default_prompt: generateDefaultPrompt('Automotive', 'vehicle and automotive recommendations', [
      'car manufacturers', 'automotive brands', 'EV companies', 'luxury car brands',
    ]),
  },
  technology: {
    name: 'Technology & Software',
    description: 'Track tech companies and software brands',
    example_brands: ['Apple', 'Google', 'Microsoft', 'Amazon', 'Meta', 'Salesforce'],
    default_prompt: generateDefaultPrompt(
      'Technology & Software',
      'technology and software recommendations',
      ['tech companies', 'software brands', 'SaaS products', 'hardware brands']
    ),
  },
  finance: {
    name: 'Finance & Banking',
    description: 'Track banks, financial services, and fintech',
    example_brands: ['Chase', 'Bank of America', 'PayPal', 'Visa', 'Mastercard', 'Goldman Sachs'],
    default_prompt: generateDefaultPrompt(
      'Finance & Banking',
      'financial service recommendations',
      ['banks', 'credit card companies', 'fintech', 'insurance companies', 'investment firms']
    ),
  },
  custom: {
    name: 'Custom Industry',
    description: 'Define your own industry and brand types',
    example_brands: [],
    default_prompt: generateDefaultPrompt('Custom Industry', 'brand and company recommendations', [
      'brand names', 'company names',
    ]),
  },
};

export const DEFAULT_CONFIG: BrandConfig = {
  config_id: 'default',
  industry: DEFAULT_BRAND_INDUSTRY,
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
