import {
  useState, useEffect, useCallback
} from 'react';
import {
  apiGet, apiPost
} from '../api/client';
import type {
  BrandConfig, IndustryPresets, BrandExpansionAllResult, CompetitorDiscoveryResult
} from '../types';
import {
  DEFAULT_BRAND_INDUSTRY, DEFAULT_CONFIG, DEFAULT_PRESETS
} from '../constants/brandConfigDefaults';
import { decodeSuggestedDomains } from '../api/competitorDomainsDecoders';

/** The config a mutation echoes back; the hook fills in the defaults for anything it omits. */
export interface BrandConfigResponse {config?: Partial<BrandConfig>;}

export interface PresetsResponse {presets: IndustryPresets;}

export interface ExpandAllBrandsResponse {
  existing_brands?: string[];
  parent_companies?: string[];
  suggestions?: string[];
  duplicates_found?: BrandExpansionAllResult['duplicates_found'];
  notes?: string;
  error?: string;
}

export interface FindCompetitorsResponse {
  first_party_brands: string[];
  competitors?: string[];
  competitor_details?: unknown;
  notes?: string;
  error?: string;
}

/**
 * The brand-config routes, each answering its decoded JSON body and rejecting
 * a non-2xx status with an `ApiRequestError`; injectable for testing.
 */
export interface BrandConfigApi {
  /** The stored config; the hook fills in the defaults for anything it omits. */
  fetchConfig: () => Promise<Partial<BrandConfig>>;
  fetchPresets: () => Promise<PresetsResponse>;
  saveConfig: (config: Partial<BrandConfig>) => Promise<BrandConfigResponse>;
  expandAllBrands: (body: {
    existing_brands: string[];
    industry: string;
    brand_type: string
  }) => Promise<ExpandAllBrandsResponse>;
  findCompetitors: (body: {
    first_party_brands: string[];
    industry: string;
    existing_competitors: string[]
  }) => Promise<FindCompetitorsResponse>;
}

const BRAND_CONFIG_PATH = '/brand-config';

/** The routes as the shared API client calls them. */
const defaultBrandConfigApi: BrandConfigApi = {
  fetchConfig: () => apiGet(BRAND_CONFIG_PATH),
  fetchPresets: () => apiGet(`${BRAND_CONFIG_PATH}/presets`),
  saveConfig: (config) => apiPost(BRAND_CONFIG_PATH, config),
  expandAllBrands: (body) => apiPost(`${BRAND_CONFIG_PATH}/expand-all`, body),
  findCompetitors: (body) => apiPost(`${BRAND_CONFIG_PATH}/find-competitors`, body),
};

/**
 * One brand-expansion call: the decoded answer on success; on any failure the
 * error is logged and `fallback` builds the result from its message.
 */
async function runExpansion<TResponse, TResult>(
  request: () => Promise<TResponse>,
  adopt: (data: TResponse) => TResult,
  failure: {
    log: string;
    message: string;
    fallback: (error: string) => TResult;
  }
): Promise<TResult> {
  try {
    return adopt(await request());
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
      const data = await api.fetchConfig();
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
      const data = await api.fetchPresets();
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
   * Replaces the local config with the one a mutation echoes back; a failed
   * request leaves the optimistic local state as is.
   */
  const adoptServerConfig = useCallback(async (request: () => Promise<BrandConfigResponse>, failureNote: string) => {
    try {
      const data = await request();
      setConfig({
        ...DEFAULT_CONFIG,
        ...data.config
      });
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
