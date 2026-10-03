import type {
  BrandConfig, IndustryPresets
} from '../types';
import { DEFAULT_PRESETS } from '../constants/brandConfigDefaults';

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
};

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



export const HOTEL_PRESETS = {
  hotels: {
    name: 'Hotels',
    description: 'Hotel brands',
    entity_types: ['hotel chains'],
    example_brands: ['Marriott'],
    extraction_focus: 'hotels',
    default_prompt: 'Extract hotel brands from text.',
  },
} satisfies IndustryPresets;

export const GENERAL_AND_CUSTOM_PRESETS = {
  general: {
    ...DEFAULT_PRESETS.general,
    default_prompt: 'Extract general brand and company mentions.',
  },
  custom: {
    ...DEFAULT_PRESETS.custom,
    default_prompt: 'Extract custom brand and company mentions.',
  },
} satisfies IndustryPresets;