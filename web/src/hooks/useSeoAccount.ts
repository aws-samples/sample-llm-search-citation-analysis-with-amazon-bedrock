import {
  fetchSeoAccount, isSeoApiConfigured
} from '../api/seo';
import type { SeoAccount } from '../types/api/seo';
import { useSeoRequest } from './useSeoGeoRequest';

export interface SeoAccountState {
  readonly account: SeoAccount | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * The DataForSEO login and balance (`GET /api/seo/account`, Admin only, a
 * free call). Read once when `enabled` turns on (an administrator with the SEO
 * stack deployed) and again when `refreshKey` changes (a saved key); never on
 * focus. Idle otherwise.
 */
export function useSeoAccount(enabled: boolean, refreshKey: string | null = null): SeoAccountState {
  const {
    data, loading, error
  } = useSeoRequest(enabled && isSeoApiConfigured(), refreshKey ?? '', fetchSeoAccount);
  return {
    account: data,
    loading,
    error,
  };
}
