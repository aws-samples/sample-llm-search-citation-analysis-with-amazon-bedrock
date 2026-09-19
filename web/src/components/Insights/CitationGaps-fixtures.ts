import type { ComponentProps } from 'react';
import { vi } from 'vitest';
import type { useCitationGaps } from '../../hooks/useCitationGaps';
import type {
  CitationGap, CitationGapsResponse 
} from '../../types';
import { SCOPE_KEYWORDS } from '../ui/useKeywordScopeOptions-fixtures';
import type { CitationGaps } from './CitationGaps';

type CitationGapsHookResult = ReturnType<typeof useCitationGaps>;

/** Props for the view: the two scope keywords unless overridden. */
export function buildProps(
  overrides: Partial<ComponentProps<typeof CitationGaps>> = {}
): ComponentProps<typeof CitationGaps> {
  return {
    keywords: SCOPE_KEYWORDS,
    ...overrides,
  };
}

/** What CitationGaps sees from `useCitationGaps()`: idle with nothing fetched unless overridden. */
export function buildCitationGapsHookResult(
  overrides: Partial<CitationGapsHookResult> = {}
): CitationGapsHookResult {
  return {
    data: null,
    loading: false,
    error: null,
    fetchCitationGaps: vi.fn(),
    ...overrides,
  };
}

/** A single-keyword gaps answer with full coverage; override `gaps` or `summary` to show gaps. */
export function buildCitationGapsResponse(
  overrides: Partial<CitationGapsResponse> = {}
): CitationGapsResponse {
  return {
    gaps: [],
    covered_sources: [],
    domain_summary: [],
    summary: {
      gap_count: 0,
      covered_count: 0,
      high_priority_gaps: 0,
      coverage_rate: 100,
    },
    ...overrides,
  };
}

/** A high-priority gap: an article Marriott is cited from and the first party is not. */
export const MARRIOTT_ARTICLE_GAP: CitationGap = {
  url: 'https://example.com/article',
  title: 'Test Article',
  priority: 'high',
  domain: 'example.com',
  citation_count: 1,
  provider_count: 1,
  first_party_brands: [],
  competitor_brands: ['Marriott'],
  providers: ['openai'],
};
