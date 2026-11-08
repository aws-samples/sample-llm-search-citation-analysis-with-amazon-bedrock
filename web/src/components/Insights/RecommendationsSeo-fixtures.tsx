/**
 * Support for the Action Center's SEO specs. The spec mocks
 * `useSeoGeoInsights`; these helpers point it at a result and drive the view.
 */
import { vi } from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSeoGeoInsights } from '../../hooks/useSeoGeoInsights';
import type { RecommendationStatus } from '../../types';
import { SCOPE_KEYWORDS } from '../ui/useKeywordScopeOptions-fixtures';
import { Recommendations } from './Recommendations';

type SeoInsightsHookResult = ReturnType<typeof useSeoGeoInsights>;

/** What the Action Center sees from `useSeoGeoInsights()`: the SEO stack deployed, nothing fetched unless overridden. */
function buildSeoInsightsHookResult(overrides: Partial<SeoInsightsHookResult>): SeoInsightsHookResult {
  return {
    data: null,
    loading: false,
    error: null,
    notConfigured: false,
    recommendations: [],
    updatingIds: [],
    statusError: null,
    updateStatus: vi.fn(),
    ...overrides,
  };
}

/** Renders the Action Center with the (mocked) SEO hook answering `overrides`; returns that hook result. */
export function renderActionCenterWithSeo(overrides: Partial<SeoInsightsHookResult>): SeoInsightsHookResult {
  const seoHook = buildSeoInsightsHookResult(overrides);
  vi.mocked(useSeoGeoInsights).mockReturnValue(seoHook);
  render(<Recommendations keywords={SCOPE_KEYWORDS} />);
  return seoHook;
}

/** Picks `status` in the status menu of the recommendation titled `title`. */
export async function chooseStatusOf(title: string, status: RecommendationStatus): Promise<void> {
  await userEvent.selectOptions(screen.getByRole('combobox', { name: `Status of ${title}` }), status);
}
