import {
  beforeEach, describe, it, expect, vi
} from 'vitest';
import { act } from '@testing-library/react';
import { useBrandConfig } from './useBrandConfig';
import {
  brandConfigPostInit, mockBrandConfig
} from './useBrandConfig-fixtures';
import { createMockJsonResponse } from '../test/fetchResponses';
import { renderLoadedHook } from '../test/loadedHook';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

type BrandConfigHook = ReturnType<typeof useBrandConfig>;

const BRAND_CONFIG_URL = 'https://api.test.com/brand-config';

describe('useBrandConfig default API', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockImplementation((url) => Promise.resolve(
      createMockJsonResponse(url === BRAND_CONFIG_URL ? mockBrandConfig : { config: mockBrandConfig })
    ));
  });

  it('loads the stored config and the presets from the brand-config routes', async () => {
    await renderLoadedHook(() => useBrandConfig());

    expect(mockAuthenticatedFetch.mock.calls).toStrictEqual([
      [BRAND_CONFIG_URL],
      [`${BRAND_CONFIG_URL}/presets`],
    ]);
  });

  it.each<[route: string, run: (hook: BrandConfigHook) => Promise<unknown>, request: readonly unknown[]]>([
    ['saves the config with a POST to', (hook) => hook.saveConfig({ industry: 'travel' }), [BRAND_CONFIG_URL, brandConfigPostInit({ industry: 'travel' })]],
    ['resets the config with a DELETE to', (hook) => hook.resetConfig(), [BRAND_CONFIG_URL, { method: 'DELETE' }]],
    ['expands a brand through', (hook) => hook.expandBrand('TestBrand'), [`${BRAND_CONFIG_URL}/expand`, brandConfigPostInit({
      brand_name: 'TestBrand',
      industry: 'hospitality',
      existing_brands: [],
    })]],
    ['expands every brand through', (hook) => hook.expandAllBrands(['Brand1']), [`${BRAND_CONFIG_URL}/expand-all`, brandConfigPostInit({
      existing_brands: ['Brand1'],
      industry: 'hospitality',
      brand_type: 'first_party',
    })]],
    ['finds competitors through', (hook) => hook.findCompetitors(['MyBrand']), [`${BRAND_CONFIG_URL}/find-competitors`, brandConfigPostInit({
      first_party_brands: ['MyBrand'],
      industry: 'hospitality',
      existing_competitors: [],
    })]],
  ])('%s its brand-config route', async (_route, run, request) => {
    const { result } = await renderLoadedHook(() => useBrandConfig());

    await act(() => run(result.current));

    expect(mockAuthenticatedFetch).toHaveBeenLastCalledWith(...request);
  });
});
