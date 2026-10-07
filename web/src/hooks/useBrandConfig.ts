import {
  useState, useEffect, useCallback
} from 'react';
import {
  API_BASE_URL, authenticatedFetch, ApiRequestError
} from '../infrastructure';
import type {
  BrandConfig, IndustryPresets, BrandExpansionAllResult, CompetitorDiscoveryResult
} from '../types';
import {
  DEFAULT_BRAND_INDUSTRY, DEFAULT_CONFIG, DEFAULT_PRESETS
} from '../constants/brandConfigDefaults';
import { decodeSuggestedDomains } from '../api/competitorDomainsDecoders';

interface BrandConfigResponse {config?: BrandConfig;}

interface PresetsResponse {presets: IndustryPresets;}

interface ExpandAllBrandsResponse {
  existing_brands?: string[];
  parent_companies?: string[];
  suggestions?: string[];
  duplicates_found?: BrandExpansionAllResult['duplicates_found'];
  notes?: string;
  error?: string;
}

interface FindCompetitorsResponse {
  first_party_brands: string[];
  competitors?: string[];
  competitor_details?: unknown;
  notes?: string;
  error?: string;
}

/** API functions for brand config - injectable for testing */
export interface BrandConfigApi {
  fetchConfig: () => Promise<Response>;
  fetchPresets: () => Promise<Response>;
  saveConfig: (config: Partial<BrandConfig>) => Promise<Response>;
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
        suggested_domains: decodeSuggestedDomains(data.competitor_details),
        notes: data.notes ?? '',
        error: data.error,
      }),
      {
        log: 'Error finding competitors:',
        message: 'Failed to find competitors',
        fallback: (error) => ({
          first_party_brands: firstPartyBrands,
          competitors: [],
          suggested_domains: {},
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
    saveConfig,
    expandAllBrands,
    findCompetitors,
  };
};
