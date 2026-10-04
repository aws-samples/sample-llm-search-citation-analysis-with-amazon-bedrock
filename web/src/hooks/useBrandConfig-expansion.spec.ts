import {
  describe, it, expect, vi
} from 'vitest';
import { runOnLoadedBrandConfig } from './useBrandConfig-fixtures';
import type { BrandConfigMockApiOptions } from './useBrandConfig-fixtures';
import {
  expandBrand1, findMyBrandCompetitors
} from './useBrandConfig-expansion-fixtures';

type ExpansionRun = typeof expandBrand1;

describe('useBrandConfig expansion answers', () => {
  it.each<[action: string, run: ExpansionRun, options: BrandConfigMockApiOptions, expected: unknown]>([
    ['expandAllBrands', expandBrand1, { expandAllResponse: {} }, {
      existing_brands: ['Brand1'],
      parent_companies: [],
      suggestions: [],
      duplicates_found: [],
      notes: '',
      error: undefined,
    }],
    ['findCompetitors', findMyBrandCompetitors, { findCompetitorsResponse: { first_party_brands: ['MyBrand'] } }, {
      first_party_brands: ['MyBrand'],
      competitors: [],
      notes: '',
      error: undefined,
    }],
  ])('%s fills every list and the notes with empty defaults when the answer omits them', async (_action, run, options, expected) => {
    const { value } = await runOnLoadedBrandConfig(run, options);

    expect(value).toStrictEqual(expected);
  });

  it.each([
    ['expandAllBrands', expandBrand1, 'Failed to expand brands'],
    ['findCompetitors', findMyBrandCompetitors, 'Failed to find competitors'],
  ])('%s reports "%s" when the request rejects with a non-Error', async (_action, run, message) => {
    vi.spyOn(console, 'error').mockImplementation(vi.fn());

    const { value } = await runOnLoadedBrandConfig(run, { expansionRejection: 'offline' });

    expect(value.error).toBe(message);
  });

  it.each([
    ['expandAllBrands', expandBrand1, 'Error expanding all brands:'],
    ['findCompetitors', findMyBrandCompetitors, 'Error finding competitors:'],
  ])('%s logs "%s" with the rejection', async (_action, run, log) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());

    await runOnLoadedBrandConfig(run, { expansionRejection: 'offline' });

    expect(consoleError).toHaveBeenCalledWith(log, 'offline');
  });
});
