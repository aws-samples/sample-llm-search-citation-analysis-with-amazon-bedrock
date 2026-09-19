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
