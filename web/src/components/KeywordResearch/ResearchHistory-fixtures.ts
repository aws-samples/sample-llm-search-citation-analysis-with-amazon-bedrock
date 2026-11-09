import type { KeywordResearchItem } from '../../types';

export function buildHistoryItem(overrides: Partial<KeywordResearchItem> = {}): KeywordResearchItem {
  return {
    id: 'item-1',
    type: 'expansion',
    seed_keyword: 'hotels',
    industry: 'hospitality',
    keyword_count: 2,
    created_at: '2024-01-15T10:30:00Z',
    keywords: [
      {
        keyword: 'luxury hotels',
        intent: 'transactional',
        competition: 'high',
        relevance: 0.9
      },
      {
        keyword: 'beach resorts',
        intent: 'transactional',
        competition: 'medium',
        relevance: 0.8
      },
    ],
    ...overrides,
  };
}

/** An ISO timestamp `days` before `now`, for runs on either side of the stale-failure cut-off. */
export function isoDaysAgo(days: number, now: number = Date.now()): string {
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
}

/** A run the backend marked failed, created `days` ago. */
export function buildFailedRun(id: string, days: number, overrides: Partial<KeywordResearchItem> = {}): KeywordResearchItem {
  return buildHistoryItem({
    id,
    status: 'failed',
    keywords: [],
    created_at: isoDaysAgo(days),
    ...overrides,
  });
}
