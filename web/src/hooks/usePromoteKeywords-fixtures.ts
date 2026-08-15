import type { ResearchKeyword } from '../types';

export const availableKeywordFixtures = [{
  keyword: 'alpha',
  intent: 'commercial',
  competition: 'high',
  relevance: 90,
}] satisfies ResearchKeyword[];

export const replacementAvailableKeywordFixtures = [{
  keyword: 'beta',
  intent: 'informational',
  competition: 'low',
  relevance: 70,
}] satisfies ResearchKeyword[];

export const createdKeywordItemFixture = {
  id: 'keyword-1',
  keyword: 'alpha',
  status: 'active',
  created_at: '2024-01-15T10:30:00Z',
  updated_at: '2024-01-15T10:30:00Z',
  region: 'global',
  language: 'en',
  category: '',
  priority: 'normal',
  notes: 'intent: commercial; competition: high',
};

export const successfulPromotionResponseFixture = {
  created: 1,
  skipped: 0,
  created_keywords: [createdKeywordItemFixture],
  skipped_keywords: [],
};

interface PromotionRequestResolution { resolve: ((response: typeof successfulPromotionResponseFixture) => void) | null; }

export function createMockPromotionRequest() {
  const requestResolution: PromotionRequestResolution = { resolve: null };
  const promise = new Promise<typeof successfulPromotionResponseFixture>((resolve) => {
    requestResolution.resolve = resolve;
  });

  return {
    promise,
    resolve: (response = successfulPromotionResponseFixture): void => {
      requestResolution.resolve?.(response);
    },
  };
}
