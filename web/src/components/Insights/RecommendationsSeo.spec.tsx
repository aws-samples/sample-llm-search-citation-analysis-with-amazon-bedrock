import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  screen, within
} from '@testing-library/react';
import { useRecommendations } from '../../hooks/useRecommendations';
import { buildSeoRecommendation } from '../../api/seoDomains-fixtures';
import {
  TRACKED_RECOMMENDATION, buildRecommendationsHookResult, buildRecommendationsResponse
} from './Recommendations-fixtures';
import {
  chooseStatusOf, renderActionCenterWithSeo
} from './RecommendationsSeo-fixtures';
import { mockCorunaKeywordGroups } from './useScopeSelection-fixtures';

vi.mock('../../hooks/useRecommendations', () => ({ useRecommendations: vi.fn() }));
vi.mock('../../hooks/useSeoGeoInsights', () => ({ useSeoGeoInsights: vi.fn() }));
vi.mock('../../hooks/useKeywordGroups');

const SEO_RECOMMENDATION = buildSeoRecommendation({
  id: 'seo-gap-1',
  priority: 'high',
  title: 'AI answers name you but Google does not rank you',
});

const GEO_HOOK = buildRecommendationsHookResult({
  data: buildRecommendationsResponse({
    recommendations: [TRACKED_RECOMMENDATION],
    by_priority: {
      high: 1,
      medium: 0,
      low: 0,
    },
  }),
});

beforeEach(() => {
  vi.mocked(useRecommendations).mockReturnValue(GEO_HOOK);
  mockCorunaKeywordGroups();
});

describe('Action Center SEO recommendations', () => {
  it('lists the SEO recommendation with an SEO badge next to the answer-based one', () => {
    renderActionCenterWithSeo({ recommendations: [SEO_RECOMMENDATION] });

    const heading = screen.getByRole('heading', { name: /AI answers name you but Google does not rank you/ });
    expect(within(heading).getByText('SEO')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Improve visibility' })).toBeInTheDocument();
  });

  it('shows no SEO badge on an answer-based recommendation', () => {
    renderActionCenterWithSeo({ recommendations: [SEO_RECOMMENDATION] });

    expect(within(screen.getByRole('heading', { name: 'Improve visibility' })).queryByText('SEO')).not.toBeInTheDocument();
  });

  it('counts the SEO recommendation in the priority summary', () => {
    renderActionCenterWithSeo({ recommendations: [SEO_RECOMMENDATION] });

    expect(screen.getByText('High Priority').nextElementSibling).toHaveTextContent('2');
  });

  it('keeps the answer-based recommendations when the SEO request fails', () => {
    renderActionCenterWithSeo({ error: 'The SEO API is unavailable.' });

    expect(screen.getByRole('heading', { name: 'Improve visibility' })).toBeInTheDocument();
    expect(screen.getByText('SEO recommendations are unavailable: The SEO API is unavailable.')).toBeInTheDocument();
  });

  it('saves an SEO recommendation status through the SEO hook', async () => {
    const seoHook = renderActionCenterWithSeo({ recommendations: [SEO_RECOMMENDATION] });

    await chooseStatusOf(SEO_RECOMMENDATION.title, 'done');

    expect(seoHook.updateStatus).toHaveBeenCalledWith(SEO_RECOMMENDATION, 'done');
  });

  it('saves an answer-based status through the recommendations hook unchanged', async () => {
    renderActionCenterWithSeo({ recommendations: [SEO_RECOMMENDATION] });

    await chooseStatusOf(TRACKED_RECOMMENDATION.title, 'wontfix');

    expect(GEO_HOOK.updateStatus).toHaveBeenCalledWith(TRACKED_RECOMMENDATION, 'wontfix');
  });

  it('shows the SEO save failure in the status alert', () => {
    renderActionCenterWithSeo({
      recommendations: [SEO_RECOMMENDATION],
      statusError: 'Network down',
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Status not saved: Network down');
  });
});
