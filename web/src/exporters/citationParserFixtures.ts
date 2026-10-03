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

/** Most-cited first (the table's default sort). */
export const DESC_CITATIONS = {
  column: 'citations',
  direction: 'desc',
} as const;

/** Most keywords first. */
export const DESC_KEYWORDS = {
  column: 'keywords',
  direction: 'desc',
} as const;
