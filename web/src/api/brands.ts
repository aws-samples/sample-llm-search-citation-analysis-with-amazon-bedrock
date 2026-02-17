/**
 * Brand-related API client functions.
 */
import {
  apiGet, apiPost, apiDelete 
} from './client';
import type {
  BrandMentionsResponse, BrandConfig, IndustryPresets 
} from '../types';
import type {
  BrandExpansionResult,
  BrandExpansionAllResult,
  CompetitorDiscoveryResult,
  PresetsResponse,
} from '../types/api/brandConfig';

interface FetchBrandMentionsOptions {
  keyword: string;
  classificationFilter?: string | null;
  signal?: AbortSignal;
}

/**
 * Fetches brand mentions for a keyword.
 */
export async function fetchBrandMentions(
  options: FetchBrandMentionsOptions
): Promise<BrandMentionsResponse> {
  const {
    keyword, classificationFilter, signal 
  } = options;
  const params: Record<string, string> = { keyword };
  if (classificationFilter) {
    params.classification = classificationFilter;
  }
  return apiGet<BrandMentionsResponse>('/brand-mentions', {
    params,
    signal 
  });
}

/**
 * Fetches brand configuration.
 */
export function fetchBrandConfig(signal?: AbortSignal): Promise<BrandConfig> {
  return apiGet<BrandConfig>('/brand-config', { signal });
}

/**
 * Fetches industry presets for brand configuration.
 */
export async function fetchBrandPresets(signal?: AbortSignal): Promise<IndustryPresets> {
  const response = await apiGet<PresetsResponse>('/brand-config/presets', { signal });
  return response.presets;
}

/**
 * Saves brand configuration.
 */
export function saveBrandConfig(config: BrandConfig): Promise<BrandConfig> {
  return apiPost<BrandConfig>('/brand-config', config);
}

/**
 * Deletes brand configuration.
 */
export function deleteBrandConfig(): Promise<{ message: string }> {
  return apiDelete<{ message: string }>('/brand-config');
}

/**
 * Expands a single brand to find related brands.
 */
export function expandBrand(
  brandName: string,
  existingBrands: string[] = []
): Promise<BrandExpansionResult> {
  return apiPost<BrandExpansionResult>('/brand-config/expand', {
    brand_name: brandName,
    existing_brands: existingBrands,
  });
}

/**
 * Expands all tracked brands to find related brands.
 */
export function expandAllBrands(
  existingBrands: string[],
  brandType: 'first_party' | 'competitor' = 'first_party'
): Promise<BrandExpansionAllResult> {
  return apiPost<BrandExpansionAllResult>('/brand-config/expand-all', {
    existing_brands: existingBrands,
    brand_type: brandType,
  });
}

/**
 * Discovers competitors based on first-party brands.
 */
export function findCompetitors(
  firstPartyBrands: string[],
  existingCompetitors: string[] = []
): Promise<CompetitorDiscoveryResult> {
  return apiPost<CompetitorDiscoveryResult>('/brand-config/find-competitors', {
    first_party_brands: firstPartyBrands,
    existing_competitors: existingCompetitors,
  });
}
