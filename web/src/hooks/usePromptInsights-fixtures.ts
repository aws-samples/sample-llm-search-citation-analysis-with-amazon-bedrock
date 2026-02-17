import { vi } from 'vitest';
import type { PromptInsightsResponse } from '../types';

export const mockPromptInsightsResponse: PromptInsightsResponse = {
  total_prompts_analyzed: 50,
  winning_prompts: [
    {
      keyword: 'best hotels',
      timestamp: '2024-01-01T00:00:00Z',
      status: 'winning',
      total_providers: 4,
      first_party: {
        mentions: 10,
        best_rank: 1,
        provider_coverage: 75,
        providers: ['openai', 'claude', 'gemini']
      },
      competitors: {
        mentions: 5,
        best_rank: 3,
        provider_coverage: 50,
        providers: ['openai', 'claude']
      },
    },
  ],
  losing_prompts: [
    {
      keyword: 'luxury resorts',
      timestamp: '2024-01-01T00:00:00Z',
      status: 'losing',
      total_providers: 4,
      first_party: {
        mentions: 2,
        best_rank: 5,
        provider_coverage: 25,
        providers: ['openai']
      },
      competitors: {
        mentions: 8,
        best_rank: 1,
        provider_coverage: 75,
        providers: ['openai', 'claude', 'gemini']
      },
    },
  ],
  opportunity_prompts: [],
  summary: {
    winning_count: 1,
    losing_count: 1,
    opportunity_count: 0,
    win_rate: 50,
  },
};

export function createMockFetch(options: {
  response?: PromptInsightsResponse;
  shouldFail?: boolean;
  invalidResponse?: boolean;
} = {}) {
  return vi.fn().mockImplementation(() => {
    if (options.shouldFail) {
      return Promise.resolve({
        ok: false,
        status: 500 
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
      json: () => Promise.resolve(options.response ?? mockPromptInsightsResponse),
    });
  });
}
