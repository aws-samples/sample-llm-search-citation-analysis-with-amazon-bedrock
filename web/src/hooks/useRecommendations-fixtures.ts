import {
  act, renderHook
} from '@testing-library/react';
import type {
  Recommendation, RecommendationsResponse
} from '../types';
import { createMockJsonResponse } from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import { useRecommendations } from './useRecommendations';

export const mockRecommendationsResponse: RecommendationsResponse = {
  recommendations: [
    {
      type: 'content_gap',
      priority: 'high',
      title: 'Create content for high-traffic keyword',
      description: 'Competitors are ranking for "best hotels" but you are not mentioned.',
      action: 'Create targeted content',
      impact: 'High visibility increase',
      keywords: ['best hotels'],
      id: 'rec-001',
      status: 'new',
    },
    {
      type: 'brand_mention',
      priority: 'medium',
      title: 'Increase brand visibility',
      description: 'Your brand is mentioned less frequently than competitors.',
      action: 'Improve brand presence',
      impact: 'Medium brand awareness boost',
      id: 'rec-002',
      status: 'in_progress',
      notes: 'Owner: brand team',
    },
  ],
  total_count: 2,
  generated_at: '2024-01-01T00:00:00Z',
  by_priority: {
    high: 1,
    medium: 1,
    low: 0,
  },
};

/** The first fixture recommendation, narrowed to the tracked (id-carrying) shape `updateStatus` takes. */
export function trackedRecommendation(index: number): Recommendation & { id: string } {
  const recommendation = mockRecommendationsResponse.recommendations[index];
  return {
    ...recommendation,
    id: recommendation.id ?? `missing-id-${index}`,
  };
}

/** Renders `useRecommendations` with `mockRecommendationsResponse` already fetched. */
export async function renderFetchedRecommendations() {
  mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(mockRecommendationsResponse));
  const rendered = renderHook(() => useRecommendations());
  await act(async () => {
    await rendered.result.current.fetchRecommendations();
  });
  return rendered;
}

/** The status each fixture recommendation shows, in list order. */
export function statusesOf(response: RecommendationsResponse | null): Array<string | undefined> {
  return (response?.recommendations ?? []).map((rec) => rec.status);
}
