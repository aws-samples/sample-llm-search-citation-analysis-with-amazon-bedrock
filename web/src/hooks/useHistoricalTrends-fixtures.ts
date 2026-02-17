import { vi } from 'vitest';
import type { HistoricalTrendsResponse } from '../types';

export const mockSingleKeywordResponse: HistoricalTrendsResponse = {
  keyword: 'best hotels',
  period_type: 'day',
  days_analyzed: 30,
  data_points: 2,
  trend_data: [
    {
      period: '2024-01-01',
      visibility_score: 75,
      total_mentions: 10,
      provider_count: 3,
      best_rank: 1,
      analysis_runs: 1
    },
    {
      period: '2024-01-02',
      visibility_score: 78,
      total_mentions: 12,
      provider_count: 3,
      best_rank: 1,
      analysis_runs: 1
    },
  ],
  trend_direction: 'improving',
  summary: {
    current_score: 78,
    previous_score: 75,
    change: 3,
    change_percent: 4,
    average_score: 76.5,
    max_score: 78,
    min_score: 75
  }
};

export const mockAllKeywordsResponse: HistoricalTrendsResponse = {
  period_type: 'day',
  days_analyzed: 30,
  data_points: 0,
  trend_data: [],
  trend_direction: 'improving',
  summary: {
    current_score: 0,
    previous_score: 0,
    change: 0,
    change_percent: 0,
    average_score: 0,
    max_score: 0,
    min_score: 0
  },
  keywords_analyzed: 2,
  keyword_trends: [
    {
      keyword: 'best hotels',
      trend_direction: 'improving',
      current_score: 75,
      change: 3,
      change_percent: 5 
    },
    {
      keyword: 'luxury resorts',
      trend_direction: 'stable',
      current_score: 70,
      change: 0,
      change_percent: 0 
    },
  ],
  overall: {
    improving_count: 1,
    declining_count: 0,
    stable_count: 1,
    avg_score: 72.5,
  },
};

export function createMockFetch(options: {
  response?: HistoricalTrendsResponse;
  shouldFail?: boolean;
  errorResponse?: { error: string };
  invalidResponse?: boolean;
} = {}) {
  return vi.fn().mockImplementation(() => {
    if (options.shouldFail) {
      return Promise.resolve({
        ok: false,
        status: 500 
      });
    }

    if (options.errorResponse) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(options.errorResponse),
      });
    }

    if (options.invalidResponse) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ invalid: 'data' }),
      });
    }

    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(options.response ?? mockSingleKeywordResponse),
    });
  });
}
