import type { CompetitorRollup } from '../../../../api/reports';

type Source = CompetitorRollup['outreach_targets'][number];

export function buildSource(overrides: Partial<Source> = {}): Source {
  return {
    keyword: 'best running shoes',
    url: 'https://example.com/post',
    domain: 'example.com',
    priority: 'high',
    citation_count: 5,
    provider_count: 2,
    providers: ['openai', 'gemini'],
    lift_score: 3.4,
    ...overrides,
  };
}

export function buildRollup(targets: Source[]): CompetitorRollup {
  return {
    competitor: 'Adidas',
    outranked_keywords: [],
    exclusive_sources: [],
    outreach_targets: targets,
  };
}
