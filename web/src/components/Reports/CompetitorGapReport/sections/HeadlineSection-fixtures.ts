import type { CompetitorRollup } from '../../../../api/reports';

export function buildSource(priority: 'high' | 'medium' | 'low'): CompetitorRollup['exclusive_sources'][number] {
  return {
    keyword: 'kw',
    url: `https://${priority}.com`,
    domain: `${priority}.com`,
    priority,
    citation_count: 5,
    provider_count: 2,
    providers: ['openai', 'g'],
    lift_score: 3.4,
  };
}

export function buildRollup(overrides: Partial<CompetitorRollup> = {}): CompetitorRollup {
  return {
    competitor: 'Adidas',
    outranked_keywords: [],
    exclusive_sources: [],
    outreach_targets: [],
    ...overrides,
  };
}
