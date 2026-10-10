import {
  expect, vi
} from 'vitest';
import {
  act, renderHook, waitFor
} from '@testing-library/react';
import { buildJsonRequestInit } from '../api/contentStudio-fixtures';
import { ApiRequestError } from '../infrastructure';
import type {
  BrandConfig, IndustryPresets
} from '../types';
import {
  useBrandConfig,
  type BrandConfigApi,
  type ExpandAllBrandsResponse,
  type FindCompetitorsResponse,
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
    example_brands: ['Marriott', 'Hilton'],
    default_prompt: 'Extract hotel brand mentions',
  },
  retail: {
    name: 'Retail',
    description: 'Retail stores',
    example_brands: ['Amazon'],
    default_prompt: 'Extract retail brand mentions',
  },
  custom: {
    name: 'Custom Industry',
    description: 'Define your own industry and brand types',
    example_brands: [],
    default_prompt: 'Extract brand and company mentions',
  },
};

/** Payload of `POST /brand-config/expand-all` for the fixture brand list. */
const mockAllBrandsExpansion: ExpandAllBrandsResponse = {
  existing_brands: ['Brand1'],
  parent_companies: ['Parent1'],
  suggestions: ['NewBrand1'],
  duplicates_found: [],
  notes: 'All brands expanded',
};

/** Payload of `POST /brand-config/find-competitors` for the fixture brand list. */
const mockCompetitorDiscovery: FindCompetitorsResponse = {
  first_party_brands: ['MyBrand'],
  competitors: ['Competitor1', 'Competitor2'],
  notes: 'Found competitors',
};

export interface BrandConfigMockApiOptions {
  /** Partial stored config returned by GET and echoed back by POST `/brand-config`. */
  configResponse?: Partial<BrandConfig>;
  presetsResponse?: IndustryPresets;
  shouldFailConfig?: boolean;
  shouldFailPresets?: boolean;
  shouldFailSave?: boolean;
  shouldFailExpandAll?: boolean;
  shouldFailFindCompetitors?: boolean;
  /** Bodies of the two expansion routes, replacing the full default answers. */
  expandAllResponse?: ExpandAllBrandsResponse;
  findCompetitorsResponse?: FindCompetitorsResponse;
  /** Makes every expansion request reject with this value instead of answering. */
  expansionRejection?: unknown;
}

/**
 * One brand-config route as the shared API client answers it: the decoded
 * `payload`, or the `ApiRequestError` of an HTTP 500 when `shouldFail`.
 */
function mockJsonEndpoint<TPayload>(shouldFail: boolean | undefined, payload: TPayload) {
  return vi.fn(() => (shouldFail
    ? Promise.reject(new ApiRequestError('HTTP 500: Request failed', 500))
    : Promise.resolve(payload)));
}

/** An expansion route: rejects with `options.expansionRejection` when set, else a `mockJsonEndpoint`. */
function mockExpansionEndpoint<TPayload>(options: BrandConfigMockApiOptions, shouldFail: boolean | undefined, payload: TPayload) {
  if (options.expansionRejection === undefined) return mockJsonEndpoint(shouldFail, payload);
  const rejection: unknown = options.expansionRejection;
  return vi.fn(() => Promise.reject<TPayload>(rejection));
}

function createMockApi(options: BrandConfigMockApiOptions = {}) {
  const storedConfig = options.configResponse ?? mockBrandConfig;
  const presets = options.presetsResponse ?? mockPresets;
  return {
    fetchConfig: mockJsonEndpoint(options.shouldFailConfig, storedConfig),
    fetchPresets: mockJsonEndpoint(options.shouldFailPresets, { presets }),
    saveConfig: mockJsonEndpoint(options.shouldFailSave, { config: storedConfig }),
    expandAllBrands: mockExpansionEndpoint(options, options.shouldFailExpandAll, options.expandAllResponse ?? mockAllBrandsExpansion),
    findCompetitors: mockExpansionEndpoint(options, options.shouldFailFindCompetitors, options.findCompetitorsResponse ?? mockCompetitorDiscovery),
  } satisfies BrandConfigApi;
}

/** Renders the hook, waits for the initial load, then runs one hook action inside `act`. */
export async function runOnLoadedBrandConfig<TValue>(
  run: (hook: ReturnType<typeof useBrandConfig>) => Promise<TValue>,
  options: BrandConfigMockApiOptions = {}
) {
  const rendered = await renderLoadedBrandConfig(options);
  const value = await act(() => run(rendered.result.current));
  return {
    ...rendered,
    value,
  };
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

/** The init the default API's POST routes send with `body`. */
export function brandConfigPostInit(body: unknown) {
  return buildJsonRequestInit('POST', body);
}
