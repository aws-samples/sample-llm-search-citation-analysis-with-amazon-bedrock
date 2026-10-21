import { renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import { answerEveryFetch } from '../test/fetchStubs';
import { createMockJsonResponse } from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import {
  buildMarketSelectionMock, marketSelectionWrapper
} from '../components/Markets/markets-fixtures';
import type {
  CitationsPage, TopUrl
} from '../types';
import {
  useMarketCitations, type CitationTableRequest
} from './useMarketCitations';

export function buildCitationsPage(overrides: Partial<CitationsPage> = {}): CitationsPage {
  return {
    provider_stats: [],
    brand_stats: [],
    top_urls: [{
      url: 'https://www.despegar.cl/vuelos',
      citation_count: 2,
    }],
    total_urls: 40,
    total_citation_count: 120,
    matched_urls: 40,
    next_token: null,
    truncated: false,
    ...overrides,
  };
}

/** The table's first view: most cited first, no filters, 25 per page. */
export const DEFAULT_TABLE_REQUEST: CitationTableRequest = {
  sort: {
    column: 'citations',
    direction: 'desc',
  },
  urlContains: '',
  minCitations: '',
  contentType: 'all',
  page: 1,
  pageSize: 25,
};

interface RenderOptions {
  /** The header's market choice (`null` = every market combined). */
  readonly market?: string | null;
  readonly request?: Partial<CitationTableRequest>;
  readonly status?: number;
  readonly body?: CitationsPage;
}

/** `useMarketCitations(request)` under a header with `market` picked; every request answers `body`. */
export function renderCitationTable({
  market = null, request = {}, status = 200, body = buildCitationsPage()
}: RenderOptions = {}) {
  vi.spyOn(console, 'error').mockImplementation(vi.fn());
  answerEveryFetch(status === 200 ? body : { error: 'unavailable' }, status);
  const wrapper = marketSelectionWrapper(buildMarketSelectionMock({ selectedMarketId: market }));
  return renderHook(() => useMarketCitations({
    ...DEFAULT_TABLE_REQUEST,
    ...request,
  }), { wrapper });
}

export const FIRST_OF_TWO: TopUrl = {
  url: 'https://a.example/primera',
  citation_count: 9,
};
export const SECOND_OF_TWO: TopUrl = {
  url: 'https://b.example/segunda',
  citation_count: 3,
};

/** Two pages: the first hands out `page-2`, the second ends the list. */
export function answerTwoCitationPages(): void {
  mockAuthenticatedFetch.mockImplementation((input) => {
    const second = new URL(String(input)).searchParams.get('next_token') === 'page-2';
    return Promise.resolve(createMockJsonResponse(buildCitationsPage({
      top_urls: [second ? SECOND_OF_TWO : FIRST_OF_TWO],
      next_token: second ? null : 'page-2',
    })));
  });
}
