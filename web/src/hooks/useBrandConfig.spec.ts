import {
  describe, it, expect 
} from 'vitest';
import {
  waitFor, act 
} from '@testing-library/react';
import { DEFAULT_CONFIG } from '../constants/brandConfigDefaults';
import {
  mockBrandConfig, renderBrandConfig, renderLoadedBrandConfig 
} from './useBrandConfig-fixtures';

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
      expect(result.current.error).toBeNull();
    });

    it('uses the canonical General preset when the preset API fails', async () => {
      const { result } = await renderLoadedBrandConfig({ shouldFailPresets: true });

      expect(result.current.presets?.general).toMatchObject({
        name: 'General',
        description: 'Track brands and companies in any industry',
        entity_types: [],
        example_brands: [],
        extraction_focus: 'brand and company recommendations',
      });
      expect(result.current.presets?.general?.default_prompt).toContain(
        'INDUSTRY CONTEXT: General\nFOCUS: brand and company recommendations'
      );
    });
  });

  describe('saveConfig', () => {
    it('replaces the local config with the config the API returns', async () => {
      const { result } = await renderLoadedBrandConfig();

      await act(() => result.current.saveConfig({ industry: 'retail' }));

      // API returns original config
      expect(result.current.config?.industry).toBe('hospitality');
    });

    it('calls API saveConfig with new config', async () => {
      const {
        api, result
      } = await renderLoadedBrandConfig();
      const newBrands = {
        tracked_brands: {
          first_party: ['NewBrand'],
          competitors: [] 
        } 
      };

      await act(() => result.current.saveConfig(newBrands));

      expect(api.saveConfig).toHaveBeenCalledWith(newBrands);
    });

    it('keeps the locally saved config when the API save fails', async () => {
      const { result } = await renderLoadedBrandConfig({ shouldFailSave: true });

      await act(() => result.current.saveConfig({ industry: 'retail' }));

      expect(result.current.config?.industry).toBe('retail');
    });
  });

  describe('resetConfig', () => {
    it('resets config to General defaults through the API', async () => {
      const {
        api, result
      } = await renderLoadedBrandConfig();

      await act(() => result.current.resetConfig());

      expect(api.deleteConfig).toHaveBeenCalledTimes(1);
      expect(result.current.config).toStrictEqual(DEFAULT_CONFIG);
      expect(result.current.config?.industry).toBe('general');
    });

    it('resets config to General locally when the API reset fails', async () => {
      const { result } = await renderLoadedBrandConfig({ shouldFailDelete: true });

      await act(() => result.current.resetConfig());

      expect(result.current.config).toStrictEqual(DEFAULT_CONFIG);
      expect(result.current.config?.industry).toBe('general');
    });
  });

  describe('getPromptForIndustry', () => {
    const promptCases = [
      {
        condition: 'a custom prompt is set in config',
        industry: 'hospitality',
        apiOptions: {
          configResponse: {
            ...mockBrandConfig,
            industry_prompts: { hospitality: 'Custom hospitality prompt' },
          },
        },
        expectedPrompt: 'Custom hospitality prompt',
      },
      {
        condition: 'no custom prompt is set',
        industry: 'hospitality',
        apiOptions: {},
        expectedPrompt: 'Extract hotel brand mentions',
      },
      {
        condition: 'the industry is unknown',
        industry: 'unknown',
        apiOptions: {},
        expectedPrompt: 'Extract brand and company mentions',
      },
    ];

    it.each(promptCases)('returns "$expectedPrompt" when $condition', async ({
      industry, apiOptions, expectedPrompt 
    }) => {
      const { result } = await renderLoadedBrandConfig(apiOptions);

      expect(result.current.getPromptForIndustry(industry)).toBe(expectedPrompt);
    });
  });

  describe('expansion industry fallback', () => {
    it('uses General for every expansion request when stored industry is empty', async () => {
      const {
        api, result
      } = await renderLoadedBrandConfig({
        configResponse: {
          ...mockBrandConfig,
          industry: '',
        },
      });

      await act(() => result.current.expandBrand('TestBrand'));
      await act(() => result.current.expandAllBrands(['Brand1']));
      await act(() => result.current.findCompetitors(['MyBrand']));

      expect(api.expandBrand).toHaveBeenCalledWith({
        brand_name: 'TestBrand',
        industry: 'general',
        existing_brands: [],
      });
      expect(api.expandAllBrands).toHaveBeenCalledWith({
        existing_brands: ['Brand1'],
        industry: 'general',
        brand_type: 'first_party',
      });
      expect(api.findCompetitors).toHaveBeenCalledWith({
        first_party_brands: ['MyBrand'],
        industry: 'general',
        existing_competitors: [],
      });
    });
  });

  describe('expandBrand', () => {
    it('returns expansion result with suggestions', async () => {
      const { result } = await renderLoadedBrandConfig();

      const expansion = await act(() => result.current.expandBrand('TestBrand'));

      expect(expansion.main_brand).toBe('TestBrand');
      expect(expansion.suggestions).toStrictEqual(['SubBrand1', 'SubBrand2']);
      expect(expansion.parent_company).toBe('ParentCo');
    });

    it('passes existing brands to API', async () => {
      const {
        api, result
      } = await renderLoadedBrandConfig();

      await act(() => result.current.expandBrand('TestBrand', ['ExistingBrand']));

      expect(api.expandBrand).toHaveBeenCalledWith({
        brand_name: 'TestBrand',
        industry: 'hospitality',
        existing_brands: ['ExistingBrand'],
      });
    });

    it('returns the HTTP failure as the error with no suggestions when the API fails', async () => {
      const { result } = await renderLoadedBrandConfig({ shouldFailExpand: true });

      const expansion = await act(() => result.current.expandBrand('TestBrand'));

      expect(expansion.error).toBe('HTTP 500: Request failed');
      expect(expansion.suggestions).toStrictEqual([]);
    });
  });

  describe('expandAllBrands', () => {
    it('returns expansion result for all brands', async () => {
      const { result } = await renderLoadedBrandConfig();

      const expansion = await act(() => result.current.expandAllBrands(['Brand1']));

      expect(expansion.existing_brands).toStrictEqual(['Brand1']);
      expect(expansion.suggestions).toStrictEqual(['NewBrand1']);
      expect(expansion.parent_companies).toStrictEqual(['Parent1']);
    });

    it('passes brand type to API', async () => {
      const {
        api, result
      } = await renderLoadedBrandConfig();

      await act(() => result.current.expandAllBrands(['Brand1'], 'competitor'));

      expect(api.expandAllBrands).toHaveBeenCalledWith({
        existing_brands: ['Brand1'],
        industry: 'hospitality',
        brand_type: 'competitor',
      });
    });

    it('returns the HTTP failure as the error with no suggestions when the API fails', async () => {
      const { result } = await renderLoadedBrandConfig({ shouldFailExpandAll: true });

      const expansion = await act(() => result.current.expandAllBrands(['Brand1']));

      expect(expansion.error).toBe('HTTP 500: Request failed');
      expect(expansion.suggestions).toStrictEqual([]);
    });
  });

  describe('findCompetitors', () => {
    it('returns discovered competitors', async () => {
      const { result } = await renderLoadedBrandConfig();

      const discovery = await act(() => result.current.findCompetitors(['MyBrand']));

      expect(discovery.competitors).toStrictEqual(['Competitor1', 'Competitor2']);
      expect(discovery.first_party_brands).toStrictEqual(['MyBrand']);
    });

    it('passes existing competitors to API', async () => {
      const {
        api, result
      } = await renderLoadedBrandConfig();

      await act(() => result.current.findCompetitors(['MyBrand'], ['ExistingCompetitor']));

      expect(api.findCompetitors).toHaveBeenCalledWith({
        first_party_brands: ['MyBrand'],
        industry: 'hospitality',
        existing_competitors: ['ExistingCompetitor'],
      });
    });

    it('returns the HTTP failure as the error with no competitors when the API fails', async () => {
      const { result } = await renderLoadedBrandConfig({ shouldFailFindCompetitors: true });

      const discovery = await act(() => result.current.findCompetitors(['MyBrand']));

      expect(discovery.error).toBe('HTTP 500: Request failed');
      expect(discovery.competitors).toStrictEqual([]);
    });
  });

  describe('refetch', () => {
    it('refetches config from API', async () => {
      const {
        api, result
      } = await renderLoadedBrandConfig();
      const initialCallCount = api.fetchConfig.mock.calls.length;

      await act(() => result.current.refetch());

      expect(api.fetchConfig.mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });
});
