import {
  describe, it, expect
} from 'vitest';
import {
  waitFor, act
} from '@testing-library/react';
import { DEFAULT_CONFIG } from '../constants/brandConfigDefaults';
import {
  mockBrandConfig, renderBrandConfig, renderLoadedBrandConfig, runOnLoadedBrandConfig
} from './useBrandConfig-fixtures';
import { EMPTY_INDUSTRY_CONFIG } from './useBrandConfig-defaults-fixtures';
import {
  EXPANSION_ARGUMENT_REQUESTS,
  EXPANSION_FAILURES,
  GENERAL_ALL_BRANDS_EXPANSION,
  GENERAL_COMPETITOR_DISCOVERY,
} from './useBrandConfig-expansion-fixtures';

describe('useBrandConfig', () => {
  describe('initialization', () => {
    it('returns loading true initially', async () => {
      const { result } = renderBrandConfig();
      const loadingAtMount = result.current.loading;

      // Let the initial load settle so no act() warning leaks into other tests
      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(loadingAtMount).toBe(true);
    });

    it('fetches config and presets on mount', async () => {
      const { api } = await renderLoadedBrandConfig();

      expect(api.fetchConfig).toHaveBeenCalledTimes(1);
      expect(api.fetchPresets).toHaveBeenCalledTimes(1);
    });

    it('sets config from API response', async () => {
      const { result } = await renderLoadedBrandConfig();

      expect(result.current.config?.industry).toBe('hospitality');
      expect(result.current.config?.tracked_brands.first_party).toStrictEqual(['MyHotel', 'MyResort']);
    });

    it('preserves Hotels when stored config selects Hotels', async () => {
      const { result } = await renderLoadedBrandConfig({
        configResponse: {
          ...mockBrandConfig,
          industry: 'hotels',
        },
      });

      expect(result.current.config?.industry).toBe('hotels');
    });

    it('sets presets from API response', async () => {
      const { result } = await renderLoadedBrandConfig();

      expect(result.current.presets?.hospitality?.name).toBe('Hospitality');
      expect(result.current.presets?.retail?.name).toBe('Retail');
    });

    it('uses General defaults when the config API fails', async () => {
      const { result } = await renderLoadedBrandConfig({ shouldFailConfig: true });

      expect(result.current.config).toStrictEqual(DEFAULT_CONFIG);
      expect(result.current.config?.industry).toBe('general');
    });

    it('uses the canonical General preset when the preset API fails', async () => {
      const { result } = await renderLoadedBrandConfig({ shouldFailPresets: true });

      expect(result.current.presets?.general).toMatchObject({
        name: 'General',
        description: 'Track brands and companies in any industry',
        example_brands: [],
      });
      expect(result.current.presets?.general?.default_prompt).toContain(
        'INDUSTRY CONTEXT: General\nFOCUS: brand and company recommendations'
      );
    });
  });

  describe('saveConfig', () => {
    it.each([
      {
        name: 'replaces the local config with the config the API returns',
        options: {},
        expectedIndustry: 'hospitality',
      },
      {
        name: 'keeps the locally saved config when the API save fails',
        options: { shouldFailSave: true },
        expectedIndustry: 'retail',
      },
    ])('$name', async ({
      options, expectedIndustry
    }) => {
      const { result } = await runOnLoadedBrandConfig(
        (hook) => hook.saveConfig({ industry: 'retail' }),
        options
      );

      expect(result.current.config?.industry).toBe(expectedIndustry);
    });

    it('calls API saveConfig with new config', async () => {
      const newBrands = {
        tracked_brands: {
          first_party: ['NewBrand'],
          competitors: []
        }
      };

      const { api } = await runOnLoadedBrandConfig((hook) => hook.saveConfig(newBrands));

      expect(api.saveConfig).toHaveBeenCalledWith(newBrands);
    });
  });

  describe('expansion industry fallback', () => {
    it('uses General for every expansion request when stored industry is empty', async () => {
      const {
        api, result
      } = await renderLoadedBrandConfig({ configResponse: EMPTY_INDUSTRY_CONFIG });

      await act(() => GENERAL_ALL_BRANDS_EXPANSION.run(result.current));
      await act(() => GENERAL_COMPETITOR_DISCOVERY.run(result.current));

      expect(api.expandAllBrands).toHaveBeenCalledWith(GENERAL_ALL_BRANDS_EXPANSION.request);
      expect(api.findCompetitors).toHaveBeenCalledWith(GENERAL_COMPETITOR_DISCOVERY.request);
    });
  });

  describe('expandAllBrands', () => {
    it('returns expansion result for all brands', async () => {
      const { value: expansion } = await runOnLoadedBrandConfig((hook) => hook.expandAllBrands(['Brand1']));

      expect(expansion.existing_brands).toStrictEqual(['Brand1']);
      expect(expansion.suggestions).toStrictEqual(['NewBrand1']);
      expect(expansion.parent_companies).toStrictEqual(['Parent1']);
    });
  });

  describe('findCompetitors', () => {
    it('returns discovered competitors', async () => {
      const { value: discovery } = await runOnLoadedBrandConfig((hook) => hook.findCompetitors(['MyBrand']));

      expect(discovery.competitors).toStrictEqual(['Competitor1', 'Competitor2']);
      expect(discovery.first_party_brands).toStrictEqual(['MyBrand']);
    });
  });

  describe('expansion API requests', () => {
    it.each(EXPANSION_ARGUMENT_REQUESTS)('$action passes $argument to API', async ({
      action, run, request
    }) => {
      const { api } = await runOnLoadedBrandConfig(run);

      expect(api[action]).toHaveBeenCalledWith(request);
    });
  });

  describe('expansion API failures', () => {
    it.each(EXPANSION_FAILURES)(
      '$action returns the HTTP failure as the error with no $emptyField when the API fails',
      async ({
        emptyField, failure, run
      }) => {
        const { value } = await runOnLoadedBrandConfig(run, failure);

        expect(value.error).toBe('HTTP 500: Request failed');
        expect(value[emptyField]).toStrictEqual([]);
      }
    );
  });

});
