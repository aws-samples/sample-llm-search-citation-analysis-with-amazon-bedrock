/**
 * Stand-ins for `api/seoLocal` and `api/seo` in the local SEO specs:
 *
 * ```ts
 * vi.mock('../../../api/seoLocal', () => import('./localSeoApi-fixtures'));
 * vi.mock('../../../api/seo', () => import('./localSeoApi-fixtures'));
 * ```
 *
 * `setupLocalSeoApi()` (in `beforeEach`) gives every call a successful default answer.
 */
import { vi } from 'vitest';
import type * as localApi from '../../../api/seoLocal';
import {
  buildGridJob, buildLocalSerpResponse, buildProfileResponse, buildQuestionsResponse, buildSearchResponse,
  buildStartJobResponse
} from '../../../api/seoLocal-fixtures';

export const isSeoApiConfigured = vi.fn<() => boolean>();
export const fetchBusinessCategories = vi.fn<typeof localApi.fetchBusinessCategories>();
export const searchBusinesses = vi.fn<typeof localApi.searchBusinesses>();
export const fetchBusinessProfile = vi.fn<typeof localApi.fetchBusinessProfile>();
export const fetchBusinessQuestions = vi.fn<typeof localApi.fetchBusinessQuestions>();
export const fetchLocalSerp = vi.fn<typeof localApi.fetchLocalSerp>();
export const startLocalJob = vi.fn<typeof localApi.startLocalJob>();
export const fetchLocalJob = vi.fn<typeof localApi.fetchLocalJob>();

export function seoErrorMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : 'failed';
}

/** Every paid call that the page can make, for "nothing was bought" assertions. */
export const PAID_CALLS = [searchBusinesses, fetchBusinessProfile, fetchBusinessQuestions, fetchLocalSerp, startLocalJob];

/** How often each of `PAID_CALLS` was made, in that order. */
export function paidCallCounts(): number[] {
  return PAID_CALLS.map((call) => call.mock.calls.length);
}

export function setupLocalSeoApi(): void {
  isSeoApiConfigured.mockReturnValue(true);
  fetchBusinessCategories.mockResolvedValue({
    categories: [],
    total: 0 
  });
  searchBusinesses.mockResolvedValue(buildSearchResponse());
  fetchBusinessProfile.mockResolvedValue(buildProfileResponse());
  fetchBusinessQuestions.mockResolvedValue(buildQuestionsResponse());
  fetchLocalSerp.mockResolvedValue(buildLocalSerpResponse());
  startLocalJob.mockResolvedValue(buildStartJobResponse());
  fetchLocalJob.mockResolvedValue(buildGridJob());
}
