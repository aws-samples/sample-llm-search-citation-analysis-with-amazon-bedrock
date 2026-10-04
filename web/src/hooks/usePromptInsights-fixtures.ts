import type {
  PromptInsight, PromptInsightsResponse
} from '../types';

/** "best hotels": the brand leads (rank 1 on 75% of engines) ahead of competitors (rank 3 on 50%). */
export const winningPrompt: PromptInsight = {
  keyword: 'best hotels',
  timestamp: '2024-01-01T00:00:00Z',
  status: 'winning',
  first_party: {
    mentions: 10,
    best_rank: 1,
    provider_coverage: 75,
  },
  competitors: {
    mentions: 5,
    best_rank: 3,
    provider_coverage: 50,
  },
};

export const mockPromptInsightsResponse: PromptInsightsResponse = {
  total_prompts_analyzed: 50,
  winning_prompts: [winningPrompt],
  losing_prompts: [
    {
      keyword: 'luxury resorts',
      timestamp: '2024-01-01T00:00:00Z',
      status: 'losing',
      first_party: {
        mentions: 2,
        best_rank: 5,
        provider_coverage: 25,
      },
      competitors: {
        mentions: 8,
        best_rank: 1,
        provider_coverage: 75,
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
