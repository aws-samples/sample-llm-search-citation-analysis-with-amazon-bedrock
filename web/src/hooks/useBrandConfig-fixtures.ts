import { expect } from 'vitest';
import {
  renderHook, waitFor 
} from '@testing-library/react';
import type {
  BrandConfig, IndustryPresets 
} from '../types';
import { createMockEndpoint } from './injectableApi-fixtures';
import {
  useBrandConfig, type BrandConfigApi 
} from './useBrandConfig';

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

const mockPresets: IndustryPresets = {
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
  custom: {
    name: 'Custom Industry',
    description: 'Define your own industry and brand types',
    entity_types: [],
    example_brands: [],
    extraction_focus: 'brand and company recommendations',
    default_prompt: 'Extract brand and company mentions',
  },
};

/** Payload of `POST /brand-config/expand` for the fixture brand. */
const mockBrandExpansion = {
  main_brand: 'TestBrand',
  parent_company: 'ParentCo',
  suggestions: ['SubBrand1', 'SubBrand2'],
  notes: 'Test notes',
};

/** Payload of `POST /brand-config/expand-all` for the fixture brand list. */
const mockAllBrandsExpansion = {
  existing_brands: ['Brand1'],
  parent_companies: ['Parent1'],
  suggestions: ['NewBrand1'],
  duplicates_found: [],
  notes: 'All brands expanded',
};

/** Payload of `POST /brand-config/find-competitors` for the fixture brand list. */
const mockCompetitorDiscovery = {
  first_party_brands: ['MyBrand'],
  competitors: ['Competitor1', 'Competitor2'],
  notes: 'Found competitors',
};

interface BrandConfigMockApiOptions {
  /** Stored config returned by GET and echoed back by POST `/brand-config`. */
  configResponse?: BrandConfig;
  shouldFailConfig?: boolean;
  shouldFailPresets?: boolean;
  shouldFailSave?: boolean;
  shouldFailDelete?: boolean;
  shouldFailExpand?: boolean;
  shouldFailExpandAll?: boolean;
  shouldFailFindCompetitors?: boolean;
}

function createMockApi(options: BrandConfigMockApiOptions = {}) {
  const storedConfig = options.configResponse ?? mockBrandConfig;
  return {
    fetchConfig: createMockEndpoint(options.shouldFailConfig, storedConfig),
    fetchPresets: createMockEndpoint(options.shouldFailPresets, { presets: mockPresets }),
    saveConfig: createMockEndpoint(options.shouldFailSave, { config: storedConfig }),
    deleteConfig: createMockEndpoint(options.shouldFailDelete, { config: {} }),
    expandBrand: createMockEndpoint(options.shouldFailExpand, mockBrandExpansion),
    expandAllBrands: createMockEndpoint(options.shouldFailExpandAll, mockAllBrandsExpansion),
    findCompetitors: createMockEndpoint(options.shouldFailFindCompetitors, mockCompetitorDiscovery),
  } satisfies BrandConfigApi;
}

/** Renders the hook against a mocked API without waiting for the initial load. */
export function renderBrandConfig(options: BrandConfigMockApiOptions = {}) {
  const api = createMockApi(options);
  const { result } = renderHook(() => useBrandConfig(api));
  return {
    api,
    result,
  };
}

/** Renders the hook and waits until config and presets have loaded. */
export async function renderLoadedBrandConfig(options: BrandConfigMockApiOptions = {}) {
  const rendered = renderBrandConfig(options);
  await waitFor(() => expect(rendered.result.current.loading).toBe(false));
  return rendered;
}
