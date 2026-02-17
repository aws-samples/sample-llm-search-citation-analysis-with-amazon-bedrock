import { vi } from 'vitest';
import type {
  BrandConfig, IndustryPresets 
} from '../types';

export const mockBrandConfig: BrandConfig = {
  industry: 'hospitality',
  extract_brands: true,
  include_sentiment: false,
  include_ranking_context: false,
  max_brands: 10,
  tracked_brands: {
    first_party: ['MyHotel', 'MyResort'],
    competitors: ['Marriott', 'Hilton'],
  },
  first_party_domains: ['myhotel.com', 'myresort.com'],
  custom_entity_types: [],
  custom_prompt_additions: '',
  industry_prompts: {},
};

export const mockPresets: IndustryPresets = {
  hospitality: {
    name: 'Hospitality',
    description: 'Hotels and travel',
    entity_types: ['hotel', 'resort'],
    example_brands: ['Marriott', 'Hilton'],
    extraction_focus: 'hotel brands',
    default_prompt: 'Extract hotel brand mentions',
  },
  retail: {
    name: 'Retail',
    description: 'Retail stores',
    entity_types: ['store'],
    example_brands: ['Amazon'],
    extraction_focus: 'retail brands',
    default_prompt: 'Extract retail brand mentions',
  },
};

export function createMockApi(options: {
  configResponse?: BrandConfig;
  presetsResponse?: IndustryPresets;
  shouldFailConfig?: boolean;
  shouldFailPresets?: boolean;
  shouldFailSave?: boolean;
  shouldFailDelete?: boolean;
  expandBrandResponse?: unknown;
  expandAllResponse?: unknown;
  findCompetitorsResponse?: unknown;
  shouldFailExpand?: boolean;
  shouldFailExpandAll?: boolean;
  shouldFailFindCompetitors?: boolean;
} = {}) {
  return {
    fetchConfig: vi.fn().mockImplementation(() => {
      if (options.shouldFailConfig) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Server Error' 
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(options.configResponse ?? mockBrandConfig),
      });
    }),
    fetchPresets: vi.fn().mockImplementation(() => {
      if (options.shouldFailPresets) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Server Error' 
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ presets: options.presetsResponse ?? mockPresets }),
      });
    }),
    saveConfig: vi.fn().mockImplementation(() => {
      if (options.shouldFailSave) {
        return Promise.resolve({
          ok: false,
          status: 500 
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ config: options.configResponse ?? mockBrandConfig }),
      });
    }),
    deleteConfig: vi.fn().mockImplementation(() => {
      if (options.shouldFailDelete) {
        return Promise.resolve({
          ok: false,
          status: 500 
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ config: {} }),
      });
    }),
    expandBrand: vi.fn().mockImplementation(() => {
      if (options.shouldFailExpand) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Server Error' 
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(options.expandBrandResponse ?? {
          main_brand: 'TestBrand',
          parent_company: 'ParentCo',
          suggestions: ['SubBrand1', 'SubBrand2'],
          notes: 'Test notes',
        }),
      });
    }),
    expandAllBrands: vi.fn().mockImplementation(() => {
      if (options.shouldFailExpandAll) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Server Error' 
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(options.expandAllResponse ?? {
          existing_brands: ['Brand1'],
          parent_companies: ['Parent1'],
          suggestions: ['NewBrand1'],
          duplicates_found: [],
          notes: 'All brands expanded',
        }),
      });
    }),
    findCompetitors: vi.fn().mockImplementation(() => {
      if (options.shouldFailFindCompetitors) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Server Error' 
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(options.findCompetitorsResponse ?? {
          first_party_brands: ['MyBrand'],
          competitors: ['Competitor1', 'Competitor2'],
          notes: 'Found competitors',
        }),
      });
    }),
  };
}
