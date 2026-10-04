import { vi } from 'vitest';
import type { usePromptInsights } from '../../hooks/usePromptInsights';
import type {
  PromptInsight, PromptInsightsResponse 
} from '../../types';

type PromptInsightsHookResult = ReturnType<typeof usePromptInsights>;

/** What PromptInsights sees from `usePromptInsights()`: idle with nothing fetched unless overridden. */
export function buildPromptInsightsHookResult(
  overrides: Partial<PromptInsightsHookResult> = {}
): PromptInsightsHookResult {
  return {
    data: null,
    loading: false,
    error: null,
    fetchPromptInsights: vi.fn(),
    ...overrides,
  };
}

/** An answer with no prompts in any tab; pass prompt lists and `summary` to populate it. */
export function buildPromptInsightsResponse(
  overrides: Partial<PromptInsightsResponse> = {}
): PromptInsightsResponse {
  return {
    total_prompts_analyzed: 0,
    winning_prompts: [],
    losing_prompts: [],
    opportunity_prompts: [],
    summary: {
      winning_count: 0,
      losing_count: 0,
      opportunity_count: 0,
      win_rate: 0,
    },
    ...overrides,
  };
}

/** A prompt where the first party ranks first, ahead of the competitors. */
export const HOTELS_WINNING_PROMPT: PromptInsight = {
  keyword: 'hotels',
  timestamp: '2026-01-01T00:00:00Z',
  status: 'winning',
  first_party: {
    mentions: 5,
    best_rank: 1,
    provider_coverage: 100,
  },
  competitors: {
    mentions: 3,
    best_rank: 2,
    provider_coverage: 100,
  },
};
