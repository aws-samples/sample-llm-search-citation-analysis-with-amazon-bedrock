import type {
  CompetitorExclusiveSource, CompetitorOutrankedKeyword, CompetitorRollup
} from '../../../../api/reports';
import type { RollupSectionProps } from './rollupSection';

/**
 * Adidas's rollup for the Competitor Gap section specs: nothing outranked,
 * no exclusive sources and no outreach targets unless overridden.
 */

/** A keyword Adidas ranks #1 on and we rank #3 on, in OpenAI's answers, unless overridden. */
export function buildOutrankedKeyword(overrides: Partial<CompetitorOutrankedKeyword> = {}): CompetitorOutrankedKeyword {
  return {
    keyword: 'kw',
    their_best_rank: 1,
    our_best_rank: 3,
    rank_delta: 2,
    providers: ['openai'],
    ...overrides,
  };
}

/** A high-priority source citing Adidas but not us, unless overridden. */
export function buildSource(overrides: Partial<CompetitorExclusiveSource> = {}): CompetitorExclusiveSource {
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

export function buildRollup(overrides: Partial<CompetitorRollup> = {}): CompetitorRollup {
  return {
    competitor: 'Adidas',
    outranked_keywords: [],
    exclusive_sources: [],
    outreach_targets: [],
    ...overrides,
  };
}

/** The props of a rollup section that has loaded `rollup`. */
export function loadedRollup(overrides: Partial<CompetitorRollup> = {}): RollupSectionProps {
  return {
    rollup: buildRollup(overrides),
    loading: false,
    error: null,
  };
}
