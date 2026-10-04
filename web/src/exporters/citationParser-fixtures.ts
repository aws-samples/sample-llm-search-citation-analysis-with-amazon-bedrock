import type { SortConfig } from './citationParser';
import type { TopUrl } from '../types';

export function buildCitation(overrides: Partial<TopUrl> = {}): TopUrl {
  return {
    url: 'https://example.com/article',
    citation_count: 5,
    keywords: ['test keyword'],
    ...overrides,
  };
}

export function buildCitations(count: number): TopUrl[] {
  return Array.from({ length: count }, (_, i) => buildCitation({
    url: `https://example.com/article-${i + 1}`,
    citation_count: count - i,
    keyword_count: i + 1,
  }));
}

/** The sort orders the citation table offers, one constant per column and direction. */
export const DESC_CITATIONS = {
  column: 'citations',
  direction: 'desc' 
} satisfies SortConfig;
export const DESC_KEYWORDS = {
  column: 'keywords',
  direction: 'desc' 
} satisfies SortConfig;
export const ASC_CITATIONS = {
  column: 'citations',
  direction: 'asc' 
} satisfies SortConfig;
export const ASC_KEYWORDS = {
  column: 'keywords',
  direction: 'asc' 
} satisfies SortConfig;
export const DESC_DOMAIN = {
  column: 'domain',
  direction: 'desc' 
} satisfies SortConfig;
export const ASC_DOMAIN = {
  column: 'domain',
  direction: 'asc' 
} satisfies SortConfig;
