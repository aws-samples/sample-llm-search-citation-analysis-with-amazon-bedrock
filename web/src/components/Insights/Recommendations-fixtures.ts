import { vi } from 'vitest';
import type { useRecommendations } from '../../hooks/useRecommendations';
import type {
  Recommendation, RecommendationsResponse 
} from '../../types';

type RecommendationsHookResult = ReturnType<typeof useRecommendations>;

/** What the Action Center sees from `useRecommendations()`: idle with nothing fetched unless overridden. */
export function buildRecommendationsHookResult(
  overrides: Partial<RecommendationsHookResult> = {}
): RecommendationsHookResult {
  return {
    data: null,
    loading: false,
    error: null,
    fetchRecommendations: vi.fn(),
    updateRecommendationStatus: vi.fn(),
    ...overrides,
  };
}

/** An answer with no recommendations; pass `recommendations` and `by_priority` to populate it. */
export function buildRecommendationsResponse(
  overrides: Partial<RecommendationsResponse> = {}
): RecommendationsResponse {
  return {
    generated_at: '2026-01-01T00:00:00Z',
    recommendations: [],
    total_count: 0,
    by_priority: {
      high: 0,
      medium: 0,
      low: 0,
    },
    ...overrides,
  };
}

export const VISIBILITY_GAP_RECOMMENDATION: Recommendation = {
  type: 'visibility_gap',
  priority: 'high',
  title: 'Improve visibility',
  description: 'Your brand needs more mentions',
  action: 'Create content',
  impact: 'High',
};
