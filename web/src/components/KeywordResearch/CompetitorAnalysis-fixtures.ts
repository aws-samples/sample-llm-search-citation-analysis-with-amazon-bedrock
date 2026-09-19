import type { CompetitorAnalysisResult } from '../../types';

export function buildResult(overrides: Partial<CompetitorAnalysisResult> = {}): CompetitorAnalysisResult {
  return {
    id: 'test-id',
    url: 'https://competitor.com',
    domain: 'competitor.com',
    industry: 'hospitality',
    primary_keywords: [{
      keyword: 'hotel',
      intent: 'transactional',
      competition: 'high',
      relevance: 0.9
    }, {
      keyword: 'resort',
      intent: 'transactional',
      competition: 'medium',
      relevance: 0.8
    }],
    secondary_keywords: [{
      keyword: 'vacation',
      intent: 'informational',
      competition: 'low',
      relevance: 0.7
    }, {
      keyword: 'travel',
      intent: 'informational',
      competition: 'low',
      relevance: 0.6
    }],
    longtail_keywords: [{
      keyword: 'luxury beach resort',
      intent: 'transactional',
      competition: 'low',
      relevance: 0.85
    }],
    content_gaps: [],
    keyword_count: 5,
    ...overrides,
  };
}
