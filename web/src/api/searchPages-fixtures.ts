import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import { createMockJsonResponse } from '../test/fetchResponses';
import type { Search } from '../types';

export function buildSearch(overrides: Partial<Search> = {}): Search {
  return {
    keyword: 'vuelos a cusco',
    provider: 'openai',
    timestamp: '2026-09-18T10:00:00Z',
    citations: ['https://www.despegar.cl/vuelos'],
    ...overrides,
  };
}

export const NEWER_RUN = buildSearch({ timestamp: '2026-09-18T10:00:00Z' });
export const OLDER_RUN = buildSearch({
  provider: 'gemini',
  timestamp: '2026-09-17T10:00:00Z',
});

/**
 * Answers `GET /searches` with one page per token: `pages[token]` (the
 * first page under `''`), each continuing to the token listed with it.
 */
export function answerSearchPages(pages: Readonly<Record<string, readonly [Search[], string | null]>>): void {
  mockAuthenticatedFetch.mockImplementation((input) => {
    const token = new URL(String(input)).searchParams.get('next_token') ?? '';
    const [searches, nextToken] = pages[token] ?? [[], null];
    return Promise.resolve(createMockJsonResponse({
      searches,
      next_token: nextToken,
    }));
  });
}
