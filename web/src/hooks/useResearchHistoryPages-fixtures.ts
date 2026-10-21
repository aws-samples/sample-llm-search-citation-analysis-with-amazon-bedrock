import type { KeywordResearchItem } from '../types';
import type { KeywordResearchHistoryPage } from '../api/keywordResearch';

export function buildResearchJob(id: string): KeywordResearchItem {
  return {
    id,
    type: 'expansion',
    status: 'completed',
    industry: 'hotels',
    keyword_count: 0,
    created_at: '2026-09-18T09:00:00Z',
  };
}

export function buildHistoryPage(ids: readonly string[], nextToken: string | null): KeywordResearchHistoryPage {
  return {
    items: ids.map(buildResearchJob),
    nextToken,
  };
}
