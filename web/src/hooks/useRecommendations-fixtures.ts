import {
  renderHook, act 
} from '@testing-library/react';
import type {
  RecommendationsResponse, RecommendationStatus 
} from '../types';
import { createMockJsonResponse } from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import { useRecommendations } from './useRecommendations';

export const mockRecommendationsResponse: RecommendationsResponse = {
  recommendations: [
    {
      id: 'rec-001',
      status: 'new',
      type: 'content_gap',
      priority: 'high',
      title: 'Create content for high-traffic keyword',
      description: 'Competitors are ranking for "best hotels" but you are not mentioned.',
      action: 'Create targeted content',
      impact: 'High visibility increase',
      keywords: ['best hotels'],
    },
    {
      id: 'rec-002',
      status: 'new',
      type: 'brand_mention',
      priority: 'medium',
      title: 'Increase brand visibility',
      description: 'Your brand is mentioned less frequently than competitors.',
      action: 'Improve brand presence',
      impact: 'Medium brand awareness boost',
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

/** The row the status endpoint returns after persisting `status` for rec-001. */
export function buildRecommendationStatusRow(status: RecommendationStatus) {
  return {
    recommendation_id: 'rec-001',
    status,
    updated_at: '2026-05-15T10:00:00Z',
  };
}

/**
 * Renders the hook with the recommendations already fetched, so a status
 * update has local state to mutate. The next request (the status POST)
 * receives `statusResponse`.
 */
export async function renderLoadedRecommendations(statusResponse: Response) {
  mockAuthenticatedFetch
    .mockResolvedValueOnce(createMockJsonResponse(mockRecommendationsResponse))
    .mockResolvedValueOnce(statusResponse);
  const rendered = renderHook(() => useRecommendations());
  await act(() => rendered.result.current.fetchRecommendations());
  return rendered;
}
