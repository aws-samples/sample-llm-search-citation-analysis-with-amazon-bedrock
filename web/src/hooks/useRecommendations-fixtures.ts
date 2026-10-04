import type { RecommendationsResponse } from '../types';

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
    },
    {
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
