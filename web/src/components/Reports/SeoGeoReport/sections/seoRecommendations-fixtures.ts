import { vi } from 'vitest';
import {
  buildSeoInsights, buildSeoRecommendation
} from '../../../../api/seoDomains-fixtures';
import type { SeoGeoInsightsState } from '../../../../hooks/useSeoGeoInsights';

/** A settled `useSeoGeoInsights` state with one recommendation and a spy for status changes. */
export function buildInsightsState(overrides: Partial<SeoGeoInsightsState> = {}): SeoGeoInsightsState {
  return {
    data: buildSeoInsights(),
    loading: false,
    error: null,
    notConfigured: false,
    recommendations: [buildSeoRecommendation()],
    updatingIds: [],
    statusError: null,
    updateStatus: vi.fn<SeoGeoInsightsState['updateStatus']>(),
    ...overrides,
  };
}
