import type { SortConfig } from './citationParser';

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
