/**
 * Replacement for `api/seo` in SEO view specs:
 *
 * ```ts
 * vi.mock('../../../api/seo', () => import('../../../test/seoApiMock'));
 * ```
 *
 * `isSeoApiConfigured` is a bare mock the spec points at `true` or `false`;
 * `researchKeywords` and `fetchSerp` are bare mocks (no paid call unless a spec
 * answers one); `seoErrorMessage` shows an error's own message, as the real one
 * does for an SEO API refusal.
 */
import { vi } from 'vitest';
import type * as seoApi from '../api/seo';

export const isSeoApiConfigured = vi.fn<() => boolean>();
export const researchKeywords = vi.fn<typeof seoApi.researchKeywords>();
export const fetchSerp = vi.fn<typeof seoApi.fetchSerp>();

export function seoErrorMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}
