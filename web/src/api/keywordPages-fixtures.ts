import { createMockJsonResponse } from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import type { Keyword } from '../types';

export const KEYWORDS_PAGE_URL = 'https://api.test.com/keywords';

/** One GET /keywords page as the API serializes it. */
export function buildKeywordsPage(
  keywords: Keyword[],
  nextToken: string | null = null,
  count = keywords.length
) {
  return {
    keywords,
    count,
    next_token: nextToken,
  };
}

export function buildKeyword(id: string, createdAt: string): Keyword {
  return {
    id,
    keyword: `${id} text`,
    created_at: createdAt,
    status: 'active',
  };
}

export interface StubbedKeywordPage {
  url: string;
  payload: unknown;
  status?: number;
}

/**
 * Serves each stubbed page at its exact URL (404 for anything else) from the
 * mocked `authenticatedFetch`.
 */
export function stubKeywordPages(pages: readonly StubbedKeywordPage[]): void {
  mockAuthenticatedFetch.mockImplementation((url) => {
    const page = pages.find((candidate) => candidate.url === url);
    const response = page === undefined
      ? createMockJsonResponse({}, 404)
      : createMockJsonResponse(page.payload, page.status ?? 200);
    return Promise.resolve(response);
  });
}
