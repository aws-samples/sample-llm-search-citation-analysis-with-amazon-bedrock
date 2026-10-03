import {
  useState, useEffect, useCallback
} from 'react';
import {
  API_BASE_URL, authenticatedFetch, ApiRequestError
} from '../infrastructure';
import type {
  BrandConfig, IndustryPresets, BrandExpansionResult, BrandExpansionAllResult, CompetitorDiscoveryResult
} from '../types';
import {
  DEFAULT_BRAND_INDUSTRY, DEFAULT_CONFIG, DEFAULT_PRESETS, resolveBrandIndustryPreset
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

const BRAND_CONFIG_URL = `${API_BASE_URL}/brand-config`;

function postBrandConfig(path: string, body: unknown): Promise<Response> {
  return authenticatedFetch(`${BRAND_CONFIG_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Default API implementation using authenticatedFetch */
const defaultBrandConfigApi: BrandConfigApi = {
  fetchConfig: () => authenticatedFetch(BRAND_CONFIG_URL),
  fetchPresets: () => authenticatedFetch(`${BRAND_CONFIG_URL}/presets`),
  saveConfig: (config) => postBrandConfig('', config),
  deleteConfig: () => authenticatedFetch(BRAND_CONFIG_URL, { method: 'DELETE' }),
  expandBrand: (body) => postBrandConfig('/expand', body),
  expandAllBrands: (body) => postBrandConfig('/expand-all', body),
  findCompetitors: (body) => postBrandConfig('/find-competitors', body),
};

/** Parses a JSON body, refusing a non-2xx status the same way for every route. */
async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new ApiRequestError(`HTTP ${response.status}: ${response.statusText}`, response.status);
  }
  return await response.json() as T;
}

/**
 * One brand-expansion call: the decoded answer on success; on any failure the
 * error is logged and `fallback` builds the result from its message.
 */
async function runExpansion<TResponse, TResult>(
  request: () => Promise<Response>,
  adopt: (data: TResponse) => TResult,
  failure: {
    log: string;
    message: string;
    fallback: (error: string) => TResult;
  }
): Promise<TResult> {
  try {
    return adopt(await readJson<TResponse>(await request()));
  } catch (err) {
    console.error(failure.log, err);
    return failure.fallback(err instanceof Error ? err.message : failure.message);
  }
}

/**
 * Hook for managing brand tracking configuration.
 * Provides CRUD operations for brand config and access to industry presets.
 * @param api - Optional API implementation for testing
 */
export const useBrandConfig = (api: BrandConfigApi = defaultBrandConfigApi) => {
  const [config, setConfig] = useState<BrandConfig>(DEFAULT_CONFIG);
  const [presets, setPresets] = useState<IndustryPresets | null>(DEFAULT_PRESETS);
  const [loading, setLoading] = useState(true);
  const [error] = useState<string | null>(null);
  const expansionIndustry = config.industry === '' ? DEFAULT_BRAND_INDUSTRY : config.industry;

  const fetchConfig = useCallback(async () => {
    try {
      const data = await readJson<BrandConfig>(await api.fetchConfig());
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
      const data = await readJson<PresetsResponse>(await api.fetchPresets());
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

  /**
   * Replaces the local config with the one a mutation echoes back, when the
   * API answers OK; a failed request leaves the optimistic local state as is.
   */
  const adoptServerConfig = useCallback(async (request: () => Promise<Response>, failureNote: string) => {
    try {
      const response = await request();

      if (response.ok) {
        const data = await response.json() as BrandConfigResponse;
        setConfig({
          ...DEFAULT_CONFIG,
          ...data.config
        });
      }
    } catch {
      console.warn(failureNote);
    }
  }, []);

  const saveConfig = useCallback(async (newConfig: Partial<BrandConfig>) => {
    const mergedConfig = {
      ...DEFAULT_CONFIG,
      ...config,
      ...newConfig
    };
    setConfig(mergedConfig);
    await adoptServerConfig(() => api.saveConfig(newConfig), 'Could not save to API, config saved locally only');
  }, [config, api, adoptServerConfig]);

  const resetConfig = useCallback(async () => {
    setConfig(DEFAULT_CONFIG);
    await adoptServerConfig(() => api.deleteConfig(), 'Could not reset via API, using local defaults');
  }, [api, adoptServerConfig]);

  const getPromptForIndustry = useCallback(
    (industryKey: string): string => {
      if (config.industry_prompts[industryKey]) {
        return config.industry_prompts[industryKey];
      }
      return resolveBrandIndustryPreset(presets, industryKey)?.default_prompt ?? '';
    },
    [config, presets]
  );

  const expandBrand = useCallback(
    async (brandName: string, existingBrands: string[] = []): Promise<BrandExpansionResult> => runExpansion<ExpandBrandResponse, BrandExpansionResult>(
      () => api.expandBrand({
        brand_name: brandName,
        industry: expansionIndustry,
        existing_brands: existingBrands,
      }),
      (data) => ({
        main_brand: data.main_brand,
        parent_company: data.parent_company,
        suggestions: data.suggestions ?? [],
        notes: data.notes ?? '',
        error: data.error,
      }),
      {
        log: 'Error expanding brand:',
        message: 'Failed to expand brand',
        fallback: (error) => ({
          main_brand: brandName,
          suggestions: [],
          error,
        }),
      }
    ),
    [expansionIndustry, api]
  );

  const expandAllBrands = useCallback(
    async (existingBrands: string[], brandType: 'first_party' | 'competitor' = 'first_party'): Promise<BrandExpansionAllResult> => runExpansion<ExpandAllBrandsResponse, BrandExpansionAllResult>(
      () => api.expandAllBrands({
        existing_brands: existingBrands,
        industry: expansionIndustry,
        brand_type: brandType,
      }),
      (data) => ({
        existing_brands: data.existing_brands ?? existingBrands,
        parent_companies: data.parent_companies ?? [],
        suggestions: data.suggestions ?? [],
        duplicates_found: data.duplicates_found ?? [],
        notes: data.notes ?? '',
        error: data.error,
      }),
      {
        log: 'Error expanding all brands:',
        message: 'Failed to expand brands',
        fallback: (error) => ({
          existing_brands: existingBrands,
          suggestions: [],
          duplicates_found: [],
          error,
        }),
      }
    ),
    [expansionIndustry, api]
  );

  const findCompetitors = useCallback(
    async (firstPartyBrands: string[], existingCompetitors: string[] = []): Promise<CompetitorDiscoveryResult> => runExpansion<FindCompetitorsResponse, CompetitorDiscoveryResult>(
      () => api.findCompetitors({
        first_party_brands: firstPartyBrands,
        industry: expansionIndustry,
        existing_competitors: existingCompetitors,
      }),
      (data) => ({
        first_party_brands: data.first_party_brands,
        competitors: data.competitors ?? [],
        notes: data.notes ?? '',
        error: data.error,
      }),
      {
        log: 'Error finding competitors:',
        message: 'Failed to find competitors',
        fallback: (error) => ({
          first_party_brands: firstPartyBrands,
          competitors: [],
          error,
        }),
      }
    ),
    [expansionIndustry, api]
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
