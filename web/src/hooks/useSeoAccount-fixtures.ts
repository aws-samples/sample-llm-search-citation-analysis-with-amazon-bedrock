/**
 * Shared replacement for `../api/seo` in the specs of the SEO hooks, the
 * Settings provider cards and the SEO vs GEO report:
 *
 * ```ts
 * vi.mock('../../api/seo', () => import('../../hooks/useSeoAccount-fixtures'));
 * import { mockIsSeoApiConfigured, mockFetchSeoGeo } from '../../hooks/useSeoAccount-fixtures';
 * ```
 *
 * Every function of the client is a typed `vi.fn`; `isSeoApiConfigured`
 * answers `false` until a spec says otherwise, like an undeployed SEO stack.
 */
import { vi } from 'vitest';
import type {
  fetchSeoAccount, fetchSeoGeo, fetchSerp, isSeoApiConfigured, researchKeywords
} from '../api/seo';
import type { SeoAccount } from '../types/api/seo';

export const mockIsSeoApiConfigured = vi.fn<typeof isSeoApiConfigured>(() => false);
export const mockFetchSeoAccount = vi.fn<typeof fetchSeoAccount>();
export const mockFetchSeoGeo = vi.fn<typeof fetchSeoGeo>();
const mockResearchKeywords = vi.fn<typeof researchKeywords>();
const mockFetchSerp = vi.fn<typeof fetchSerp>();

/** A stored DataForSEO login with money on the account. */
export function buildSeoAccount(overrides: Partial<SeoAccount> = {}): SeoAccount {
  return {
    configured: true,
    login: 'seo@example.com',
    balance_usd: 74.3,
    ...overrides,
  };
}

export {
  mockIsSeoApiConfigured as isSeoApiConfigured,
  mockFetchSeoAccount as fetchSeoAccount,
  mockFetchSeoGeo as fetchSeoGeo,
  mockResearchKeywords as researchKeywords,
  mockFetchSerp as fetchSerp,
};
