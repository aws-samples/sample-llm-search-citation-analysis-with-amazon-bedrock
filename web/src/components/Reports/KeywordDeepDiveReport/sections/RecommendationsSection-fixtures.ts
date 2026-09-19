import type {
  Recommendation, RecommendationsResponse
} from '../../../../types';

export function buildRecResponse(recommendations: Recommendation[]): RecommendationsResponse {
  return {
    generated_at: '2026-05-14T00:00:00Z',
    recommendations,
    total_count: recommendations.length,
    by_priority: {
      high: recommendations.filter((recommendation) => recommendation.priority === 'high').length,
      medium: recommendations.filter((recommendation) => recommendation.priority === 'medium').length,
      low: recommendations.filter((recommendation) => recommendation.priority === 'low').length,
    },
  };
}
