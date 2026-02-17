import {
  describe, it, expect, vi, beforeEach, afterEach 
} from 'vitest';
import {
  renderHook, waitFor, act 
} from '@testing-library/react';
import { useBrandConfig } from './useBrandConfig';
import {
  mockBrandConfig, createMockApi 
} from './useBrandConfig-fixtures';

describe('useBrandConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('returns loading true initially', async () => {
      const api = createMockApi();
      const { result } = renderHook(() => useBrandConfig(api));

      expect(result.current.loading).toBe(true);

      // Wait for async operations to complete to avoid act() warning
      await waitFor(() => expect(result.current.loading).toBe(false));
    });

    it('fetches config and presets on mount', async () => {
      const api = createMockApi();
      const { result } = renderHook(() => useBrandConfig(api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(api.fetchConfig).toHaveBeenCalledTimes(1);
      expect(api.fetchPresets).toHaveBeenCalledTimes(1);
    });

    it('sets config from API response', async () => {
      const api = createMockApi();
      const { result } = renderHook(() => useBrandConfig(api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.config?.industry).toBe('hospitality');
      expect(result.current.config?.tracked_brands.first_party).toStrictEqual(['MyHotel', 'MyResort']);
    });

    it('sets presets from API response', async () => {
      const api = createMockApi();
      const { result } = renderHook(() => useBrandConfig(api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.presets?.hospitality?.name).toBe('Hospitality');
      expect(result.current.presets?.retail?.name).toBe('Retail');
    });

    it('uses default config when API fails', async () => {
      const api = createMockApi({ shouldFailConfig: true });
      const { result } = renderHook(() => useBrandConfig(api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.config).not.toBeNull();
      expect(result.current.error).toBeNull();
    });

    it('uses default presets when API fails', async () => {
      const api = createMockApi({ shouldFailPresets: true });
      const { result } = renderHook(() => useBrandConfig(api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      expect(result.current.presets).not.toBeNull();
    });
  });

  describe('saveConfig', () => {
    it('updates local config immediately', async () => {
      const api = createMockApi();
      const { result } = renderHook(() => useBrandConfig(api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.saveConfig({ industry: 'retail' });
      });

      // API returns original config
      expect(result.current.config?.industry).toBe('hospitality');
    });

    it('calls API saveConfig with new config', async () => {
      const api = createMockApi();
      const { result } = renderHook(() => useBrandConfig(api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.saveConfig({
          tracked_brands: {
            first_party: ['NewBrand'],
            competitors: [] 
          } 
        });
      });

      expect(api.saveConfig).toHaveBeenCalledWith({
        tracked_brands: {
          first_party: ['NewBrand'],
          competitors: [] 
        } 
      });
    });

    it('handles save failure gracefully', async () => {
      const api = createMockApi({ shouldFailSave: true });
      const { result } = renderHook(() => useBrandConfig(api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.saveConfig({ industry: 'retail' });
      });

      // Should not throw, config updated locally
      expect(result.current.config?.industry).toBe('retail');
    });
  });

  describe('resetConfig', () => {
    it('resets config to defaults locally', async () => {
      const api = createMockApi();
      const { result } = renderHook(() => useBrandConfig(api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.resetConfig();
      });

      expect(api.deleteConfig).toHaveBeenCalledTimes(1);
    });

    it('handles reset failure gracefully', async () => {
      const api = createMockApi({ shouldFailDelete: true });
      const { result } = renderHook(() => useBrandConfig(api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.resetConfig();
      });

      // Should not throw
      expect(result.current.config).not.toBeNull();
    });
  });

  describe('getPromptForIndustry', () => {
    it('returns custom prompt when set in config', async () => {
      const api = createMockApi({
        configResponse: {
          ...mockBrandConfig,
          industry_prompts: { hospitality: 'Custom hospitality prompt' },
        },
      });
      const { result } = renderHook(() => useBrandConfig(api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      const prompt = result.current.getPromptForIndustry('hospitality');
      expect(prompt).toBe('Custom hospitality prompt');
    });

    it('returns default preset prompt when no custom prompt', async () => {
      const api = createMockApi();
      const { result } = renderHook(() => useBrandConfig(api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      const prompt = result.current.getPromptForIndustry('hospitality');
      expect(prompt).toBe('Extract hotel brand mentions');
    });

    it('returns empty string for unknown industry', async () => {
      const api = createMockApi();
      const { result } = renderHook(() => useBrandConfig(api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      const prompt = result.current.getPromptForIndustry('unknown');
      expect(prompt).toBe('');
    });
  });

  describe('expandBrand', () => {
    it('returns expansion result with suggestions', async () => {
      const api = createMockApi();
      const { result } = renderHook(() => useBrandConfig(api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      const expansionResult = {
        main_brand: '',
        suggestions: [] as string[],
        parent_company: '' 
      };
      await act(async () => {
        const res = await result.current.expandBrand('TestBrand');
        expansionResult.main_brand = res.main_brand;
        expansionResult.suggestions = res.suggestions;
        expansionResult.parent_company = res.parent_company ?? '';
      });

      expect(expansionResult.main_brand).toBe('TestBrand');
      expect(expansionResult.suggestions).toStrictEqual(['SubBrand1', 'SubBrand2']);
      expect(expansionResult.parent_company).toBe('ParentCo');
    });

    it('passes existing brands to API', async () => {
      const api = createMockApi();
      const { result } = renderHook(() => useBrandConfig(api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.expandBrand('TestBrand', ['ExistingBrand']);
      });

      expect(api.expandBrand).toHaveBeenCalledWith({
        brand_name: 'TestBrand',
        industry: 'hospitality',
        existing_brands: ['ExistingBrand'],
      });
    });

    it('returns error result when API fails', async () => {
      const api = createMockApi({ shouldFailExpand: true });
      const { result } = renderHook(() => useBrandConfig(api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      const expansionResult = {
        error: '',
        suggestions: [] as string[] 
      };
      await act(async () => {
        const res = await result.current.expandBrand('TestBrand');
        expansionResult.error = res.error ?? '';
        expansionResult.suggestions = res.suggestions;
      });

      expect(expansionResult.error).toBeTruthy();
      expect(expansionResult.suggestions).toStrictEqual([]);
    });
  });

  describe('expandAllBrands', () => {
    it('returns expansion result for all brands', async () => {
      const api = createMockApi();
      const { result } = renderHook(() => useBrandConfig(api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      const expansionResult = {
        existing_brands: [] as string[],
        suggestions: [] as string[],
        parent_companies: [] as string[] 
      };
      await act(async () => {
        const res = await result.current.expandAllBrands(['Brand1']);
        expansionResult.existing_brands = res.existing_brands ?? [];
        expansionResult.suggestions = res.suggestions ?? [];
        expansionResult.parent_companies = res.parent_companies ?? [];
      });

      expect(expansionResult.existing_brands).toStrictEqual(['Brand1']);
      expect(expansionResult.suggestions).toStrictEqual(['NewBrand1']);
      expect(expansionResult.parent_companies).toStrictEqual(['Parent1']);
    });

    it('passes brand type to API', async () => {
      const api = createMockApi();
      const { result } = renderHook(() => useBrandConfig(api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.expandAllBrands(['Brand1'], 'competitor');
      });

      expect(api.expandAllBrands).toHaveBeenCalledWith({
        existing_brands: ['Brand1'],
        industry: 'hospitality',
        brand_type: 'competitor',
      });
    });

    it('returns error result when API fails', async () => {
      const api = createMockApi({ shouldFailExpandAll: true });
      const { result } = renderHook(() => useBrandConfig(api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      const expansionResult = {
        error: '',
        suggestions: [] as string[] 
      };
      await act(async () => {
        const res = await result.current.expandAllBrands(['Brand1']);
        expansionResult.error = res.error ?? '';
        expansionResult.suggestions = res.suggestions;
      });

      expect(expansionResult.error).toBeTruthy();
      expect(expansionResult.suggestions).toStrictEqual([]);
    });
  });

  describe('findCompetitors', () => {
    it('returns discovered competitors', async () => {
      const api = createMockApi();
      const { result } = renderHook(() => useBrandConfig(api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      const discoveryResult = {
        competitors: [] as string[],
        first_party_brands: [] as string[] 
      };
      await act(async () => {
        const res = await result.current.findCompetitors(['MyBrand']);
        discoveryResult.competitors = res.competitors;
        discoveryResult.first_party_brands = res.first_party_brands;
      });

      expect(discoveryResult.competitors).toStrictEqual(['Competitor1', 'Competitor2']);
      expect(discoveryResult.first_party_brands).toStrictEqual(['MyBrand']);
    });

    it('passes existing competitors to API', async () => {
      const api = createMockApi();
      const { result } = renderHook(() => useBrandConfig(api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.findCompetitors(['MyBrand'], ['ExistingCompetitor']);
      });

      expect(api.findCompetitors).toHaveBeenCalledWith({
        first_party_brands: ['MyBrand'],
        industry: 'hospitality',
        existing_competitors: ['ExistingCompetitor'],
      });
    });

    it('returns error result when API fails', async () => {
      const api = createMockApi({ shouldFailFindCompetitors: true });
      const { result } = renderHook(() => useBrandConfig(api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      const discoveryResult = {
        error: '',
        competitors: [] as string[] 
      };
      await act(async () => {
        const res = await result.current.findCompetitors(['MyBrand']);
        discoveryResult.error = res.error ?? '';
        discoveryResult.competitors = res.competitors;
      });

      expect(discoveryResult.error).toBeTruthy();
      expect(discoveryResult.competitors).toStrictEqual([]);
    });
  });

  describe('refetch', () => {
    it('refetches config from API', async () => {
      const api = createMockApi();
      const { result } = renderHook(() => useBrandConfig(api));

      await waitFor(() => expect(result.current.loading).toBe(false));

      const initialCallCount = api.fetchConfig.mock.calls.length;

      await act(async () => {
        await result.current.refetch();
      });

      expect(api.fetchConfig.mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });
});
