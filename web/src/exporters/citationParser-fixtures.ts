import type { SortConfig } from './citationParser';
import type { TopUrl } from '../types';

/** The citation table's default order and its keyword-column order. */
export const DESC_CITATIONS = {
  column: 'citations',
  direction: 'desc' 
} satisfies SortConfig;
export const DESC_KEYWORDS = {
  column: 'keywords',
  direction: 'desc' 
} satisfies SortConfig;

export function buildCitation(overrides: Partial<TopUrl> = {}): TopUrl {
  return {
    url: 'https://example.com/article',
    citation_count: 5,
    keywords: ['test keyword'],
    ...overrides,
  };
}

/** A YouTube video, an ordinary page and a page from an API build that sent no `content_type`. */
export const MIXED_TYPE_CITATIONS = [
  buildCitation({
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    citation_count: 3,
    content_type: 'video',
  }),
  buildCitation({
    url: 'https://example.com/guide',
    citation_count: 2,
    content_type: 'page',
  }),
  buildCitation({
    url: 'https://example.com/legacy',
    citation_count: 1,
  }),
];
