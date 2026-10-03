/**
 * What a component sees from a mocked `useBrandConfig()`, for specs that
 * `vi.mock('…/hooks/useBrandConfig', () => ({ useBrandConfig: vi.fn() }))`.
 */
import { vi } from 'vitest';
import type { useBrandConfig } from '../hooks/useBrandConfig';
import { DEFAULT_CONFIG } from '../constants/brandConfigDefaults';

type BrandConfigHookResult = ReturnType<typeof useBrandConfig>;

/** The loaded default config with inert callbacks, plus `overrides`. */
export function buildBrandConfigHookResult(
  overrides: Partial<BrandConfigHookResult> = {}
): BrandConfigHookResult {
  return {
    config: DEFAULT_CONFIG,
    presets: {},
    loading: false,
    error: null,
    saveConfig: vi.fn(),
    resetConfig: vi.fn(),
    refetch: vi.fn(),
    getPromptForIndustry: vi.fn(),
    expandBrand: vi.fn(),
    expandAllBrands: vi.fn(),
    findCompetitors: vi.fn(),
    ...overrides,
  };
}

/** The loaded default config tracking `firstParty` and `competitors`. */
export function buildTrackedBrandsHookResult(firstParty: string[], competitors: string[]): BrandConfigHookResult {
  return buildBrandConfigHookResult({
    config: {
      ...DEFAULT_CONFIG,
      tracked_brands: {
        first_party: firstParty,
        competitors,
      },
    },
  });
}
