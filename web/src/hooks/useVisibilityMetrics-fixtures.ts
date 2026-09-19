import type { VisibilityMetricsResponse } from '../types';

export const mockVisibilityResponse: VisibilityMetricsResponse = {
  keyword: 'best hotels',
  timestamp: '2024-01-01T00:00:00Z',
  total_mentions: 18,
  brands: [
    {
      name: 'MyHotel',
      visibility_score: 85,
      provider_count: 3,
      providers: ['openai', 'perplexity', 'gemini'],
      total_mentions: 10,
      best_rank: 1,
      share_of_voice: 55.6,
      classification: 'first_party',
    },
    {
      name: 'Competitor',
      visibility_score: 70,
      provider_count: 2,
      providers: ['openai', 'claude'],
      total_mentions: 8,
      best_rank: 2,
      share_of_voice: 44.4,
      classification: 'competitor',
    },
  ],
  first_party: [],
  competitors: [],
  others: [],
  summary: {
    first_party_avg_score: 85,
    competitor_avg_score: 70,
    first_party_total_sov: 55.6,
    competitor_total_sov: 44.4,
  },
};
