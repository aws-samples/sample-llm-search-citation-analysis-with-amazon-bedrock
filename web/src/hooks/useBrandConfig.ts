import {
  useState, useEffect, useCallback 
} from 'react';
import {
  API_BASE_URL, authenticatedFetch, ApiRequestError 
} from '../infrastructure';
import type {
  BrandConfig, IndustryPresets 
} from '../types';
import {
  DEFAULT_CONFIG, DEFAULT_PRESETS 
} from '../constants/brandConfigDefaults';

interface BrandConfigResponse {config?: BrandConfig;}

interface PresetsResponse {presets: IndustryPresets;}

interface ExpandBrandResponse {
  main_brand: string;
  parent_company?: string | null;
  suggestions?: string[];
  notes?: string;
  error?: string;
}

interface ExpandAllBrandsResponse {
  existing_brands?: string[];
  parent_companies?: string[];
  suggestions?: string[];
  duplicates_found?: Array<{
    brand: string;
    duplicate_of: string;
    reason: string 
  }>;
  notes?: string;
  error?: string;
}

interface FindCompetitorsResponse {
  first_party_brands: string[];
  competitors?: string[];
  notes?: string;
  error?: string;
}

/** API functions for brand config - injectable for testing */
export interface BrandConfigApi {
  fetchConfig: () => Promise<Response>;
  fetchPresets: () => Promise<Response>;
  saveConfig: (config: Partial<BrandConfig>) => Promise<Response>;
  deleteConfig: () => Promise<Response>;
  expandBrand: (body: {
    brand_name: string;
    industry: string;
    existing_brands: string[] 
  }) => Promise<Response>;
  expandAllBrands: (body: {
    existing_brands: string[];
    industry: string;
    brand_type: string 
  }) => Promise<Response>;
  findCompetitors: (body: {
    first_party_brands: string[];
    industry: string;
    existing_competitors: string[] 
  }) => Promise<Response>;
}

/** Default API implementation using authenticatedFetch */
export const defaultBrandConfigApi: BrandConfigApi = {
  fetchConfig: () => authenticatedFetch(`${API_BASE_URL}/brand-config`),
  fetchPresets: () => authenticatedFetch(`${API_BASE_URL}/brand-config/presets`),
  saveConfig: (config) => authenticatedFetch(`${API_BASE_URL}/brand-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  }),
  deleteConfig: () => authenticatedFetch(`${API_BASE_URL}/brand-config`, { method: 'DELETE' }),
  expandBrand: (body) => authenticatedFetch(`${API_BASE_URL}/brand-config/expand`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  expandAllBrands: (body) => authenticatedFetch(`${API_BASE_URL}/brand-config/expand-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  findCompetitors: (body) => authenticatedFetch(`${API_BASE_URL}/brand-config/find-competitors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
};

/**
 * Hook for managing brand tracking configuration.
 * Provides CRUD operations for brand config and access to industry presets.
 * @param api - Optional API implementation for testing
 */
export const useBrandConfig = (api: BrandConfigApi = defaultBrandConfigApi) => {
  const [config, setConfig] = useState<BrandConfig | null>(DEFAULT_CONFIG);
  const [presets, setPresets] = useState<IndustryPresets | null>(DEFAULT_PRESETS);
  const [loading, setLoading] = useState(true);
  const [error] = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const response = await api.fetchConfig();
      if (!response.ok) {
        throw new ApiRequestError(`HTTP ${response.status}: ${response.statusText}`, response.status);
      }
      const data = await response.json() as BrandConfig;
      setConfig({
        ...DEFAULT_CONFIG,
        ...data 
      });
    } catch {
      // Use default config if API fails (e.g., not deployed yet)
      console.warn('Using default brand config (API not available)');
      setConfig(DEFAULT_CONFIG);
    }
  }, [api]);

  const fetchPresets = useCallback(async () => {
    try {
      const response = await api.fetchPresets();
      if (!response.ok) {
        throw new ApiRequestError(`HTTP ${response.status}: ${response.statusText}`, response.status);
      }
      const data = await response.json() as PresetsResponse;
      setPresets(data.presets);
    } catch {
      // Use default presets if API fails (e.g., not deployed yet)
      console.warn('Using default presets (API not available)');
      setPresets(DEFAULT_PRESETS);
    }
  }, [api]);

  useEffect(() => {
    const controller = new AbortController();
    
    const loadData = async () => {
      setLoading(true);
      await Promise.all([fetchConfig(), fetchPresets()]);
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    };
    loadData();
    
    return () => controller.abort();
  }, [fetchConfig, fetchPresets]);

  const saveConfig = useCallback(async (newConfig: Partial<BrandConfig>) => {
    const mergedConfig = {
      ...DEFAULT_CONFIG,
      ...config,
      ...newConfig 
    };
    setConfig(mergedConfig);

    try {
      const response = await api.saveConfig(newConfig);

      if (response.ok) {
        const data = await response.json() as BrandConfigResponse;
        setConfig({
          ...DEFAULT_CONFIG,
          ...data.config 
        });
      }
    } catch {
      console.warn('Could not save to API, config saved locally only');
    }
  }, [config, api]);

  const resetConfig = useCallback(async () => {
    setConfig(DEFAULT_CONFIG);

    try {
      const response = await api.deleteConfig();

      if (response.ok) {
        const data = await response.json() as BrandConfigResponse;
        setConfig({
          ...DEFAULT_CONFIG,
          ...data.config 
        });
      }
    } catch {
      console.warn('Could not reset via API, using local defaults');
    }
  }, [api]);

  const getPromptForIndustry = useCallback(
    (industryKey: string): string => {
      if (config?.industry_prompts?.[industryKey]) {
        return config.industry_prompts[industryKey];
      }
      return presets?.[industryKey]?.default_prompt ?? '';
    },
    [config, presets]
  );

  const expandBrand = useCallback(
    async (brandName: string, existingBrands: string[] = []): Promise<BrandExpansionResult> => {
      try {
        const response = await api.expandBrand({
          brand_name: brandName,
          industry: config?.industry ?? 'hotels',
          existing_brands: existingBrands,
        });

        if (!response.ok) {
          throw new ApiRequestError(`HTTP ${response.status}: ${response.statusText}`, response.status);
        }

        const data = await response.json() as ExpandBrandResponse;
        return {
          main_brand: data.main_brand,
          parent_company: data.parent_company,
          suggestions: data.suggestions ?? [],
          notes: data.notes ?? '',
          error: data.error,
        };
      } catch (err) {
        console.error('Error expanding brand:', err);
        return {
          main_brand: brandName,
          suggestions: [],
          error: err instanceof Error ? err.message : 'Failed to expand brand',
        };
      }
    },
    [config?.industry, api]
  );

  const expandAllBrands = useCallback(
    async (existingBrands: string[], brandType: 'first_party' | 'competitor' = 'first_party'): Promise<BrandExpansionAllResult> => {
      try {
        const response = await api.expandAllBrands({
          existing_brands: existingBrands,
          industry: config?.industry ?? 'hotels',
          brand_type: brandType,
        });

        if (!response.ok) {
          throw new ApiRequestError(`HTTP ${response.status}: ${response.statusText}`, response.status);
        }

        const data = await response.json() as ExpandAllBrandsResponse;
        return {
          existing_brands: data.existing_brands ?? existingBrands,
          parent_companies: data.parent_companies ?? [],
          suggestions: data.suggestions ?? [],
          duplicates_found: data.duplicates_found ?? [],
          notes: data.notes ?? '',
          error: data.error,
        };
      } catch (err) {
        console.error('Error expanding all brands:', err);
        return {
          existing_brands: existingBrands,
          suggestions: [],
          duplicates_found: [],
          error: err instanceof Error ? err.message : 'Failed to expand brands',
        };
      }
    },
    [config?.industry, api]
  );

  const findCompetitors = useCallback(
    async (firstPartyBrands: string[], existingCompetitors: string[] = []): Promise<CompetitorDiscoveryResult> => {
      try {
        const response = await api.findCompetitors({
          first_party_brands: firstPartyBrands,
          industry: config?.industry ?? 'hotels',
          existing_competitors: existingCompetitors,
        });

        if (!response.ok) {
          throw new ApiRequestError(`HTTP ${response.status}: ${response.statusText}`, response.status);
        }

        const data = await response.json() as FindCompetitorsResponse;
        return {
          first_party_brands: data.first_party_brands,
          competitors: data.competitors ?? [],
          notes: data.notes ?? '',
          error: data.error,
        };
      } catch (err) {
        console.error('Error finding competitors:', err);
        return {
          first_party_brands: firstPartyBrands,
          competitors: [],
          error: err instanceof Error ? err.message : 'Failed to find competitors',
        };
      }
    },
    [config?.industry, api]
  );

  return {
    config,
    presets,
    loading,
    error,
    saveConfig,
    resetConfig,
    refetch: fetchConfig,
    getPromptForIndustry,
    expandBrand,
    expandAllBrands,
    findCompetitors,
  };
};

/**
 * Result from expanding a single brand.
 * Contains suggested sub-brands and variations.
 */
export interface BrandExpansionResult {
  /** The main brand that was expanded */
  main_brand: string;
  /** Parent company if identified */
  parent_company?: string | null;
  /** Suggested sub-brands and variations */
  suggestions: string[];
  /** Additional notes about the expansion */
  notes?: string;
  /** Error message if expansion failed */
  error?: string;
}

/**
 * Result from expanding all tracked brands.
 * Contains suggestions for missing sub-brands across all brands.
 */
export interface BrandExpansionAllResult {
  /** Original list of brands */
  existing_brands: string[];
  /** Identified parent companies */
  parent_companies?: string[];
  /** Suggested brands to add */
  suggestions: string[];
  /** Duplicates found in the existing list */
  duplicates_found: Array<{
    brand: string;
    duplicate_of: string;
    reason: string;
  }>;
  /** Additional notes */
  notes?: string;
  /** Error message if expansion failed */
  error?: string;
}

/**
 * Result from competitor discovery.
 * Contains suggested competitors based on first-party brands.
 */
export interface CompetitorDiscoveryResult {
  /** First-party brands used for discovery */
  first_party_brands: string[];
  /** Discovered competitor brands */
  competitors: string[];
  /** Additional notes about the discovery */
  notes?: string;
  /** Error message if discovery failed */
  error?: string;
}
