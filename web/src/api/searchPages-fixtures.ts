import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import { createMockJsonResponse } from '../test/fetchResponses';
import { buildSearch } from '../formatting/searchSummary-fixtures';
import type { Search } from '../types';

const CUSCO_FLIGHTS = {
  keyword: 'vuelos a cusco',
  citations: ['https://www.despegar.cl/vuelos'],
};

export const NEWER_RUN = buildSearch({
  ...CUSCO_FLIGHTS,
  timestamp: '2026-09-18T10:00:00Z',
});
export const OLDER_RUN = buildSearch({
  ...CUSCO_FLIGHTS,
  provider: 'gemini',
  timestamp: '2026-09-17T10:00:00Z',
});

type SearchPages = Readonly<Record<string, readonly [Search[], string | null]>>;

/** Two pages: `NEWER_RUN` first, continuing to `OLDER_RUN` on the last page. */
export const TWO_SEARCH_PAGES: SearchPages = {
  '': [[NEWER_RUN], 'older'],
  older: [[OLDER_RUN], null],
};

/**
 * Answers `GET /searches` with one page per token: `pages[token]` (the
 * first page under `''`), each continuing to the token listed with it.
 */
export function answerSearchPages(pages: SearchPages): void {
  mockAuthenticatedFetch.mockImplementation((input) => {
    const token = new URL(String(input)).searchParams.get('next_token') ?? '';
    const [searches, nextToken] = pages[token] ?? [[], null];
    return Promise.resolve(createMockJsonResponse({
      searches,
      next_token: nextToken,
    }));
  });
}
