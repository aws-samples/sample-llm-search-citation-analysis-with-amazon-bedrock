import type { BrandConfig } from '../types';

const BRAND_CONFIG_DEFAULTS: BrandConfig = {
  industry: 'hotels',
  tracked_brands: {
    first_party: ['Marriott'],
    competitors: ['Hilton'] 
  },
  first_party_domains: ['marriott.com'],
  custom_entity_types: [],
  custom_prompt_additions: '',
  include_sentiment: true,
  include_ranking_context: true,
  max_brands: 20,
  extract_brands: true,
  industry_prompts: {},
} as const;

export function buildBrandConfig(overrides: Partial<BrandConfig> = {}): BrandConfig {
  return {
    ...BRAND_CONFIG_DEFAULTS,
    ...overrides 
  };
}

export function buildBrandConfigWithBrands(
  firstParty: string[],
  competitors: string[] = []
): BrandConfig {
  return buildBrandConfig({
    tracked_brands: {
      first_party: firstParty,
      competitors 
    },
  });
}

export function buildEmptyBrandConfig(): BrandConfig {
  return buildBrandConfig({
    tracked_brands: {
      first_party: [],
      competitors: [] 
    },
    first_party_domains: [],
  });
}
