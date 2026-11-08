import { fetchSeoGeo } from '../api/seo';
import type { SeoGeoResponse } from '../types/api/seo';
import {
  useSeoScopeRequest, type SeoScopeRequest
} from './useSeoGeoRequest';

export interface SeoGeoState extends SeoScopeRequest<SeoGeoResponse> {
  /** Settled: printed reports may print. */
  readonly ready: boolean;
}

/**
 * The SEO vs GEO table (`GET /api/seo/seo-geo`, no DataForSEO call) of the
 * header market (the global market when every market is combined) and, with
 * `groupId`, of one keyword group. Fetched on mount and again when the market
 * or the group changes.
 */
export function useSeoGeo(groupId: string | null): SeoGeoState {
  const request = useSeoScopeRequest(groupId, fetchSeoGeo);
  return {
    ...request,
    ready: !request.loading,
  };
}
