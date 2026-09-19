import {
  expect, vi 
} from 'vitest';
import {
  act, renderHook, waitFor 
} from '@testing-library/react';
import { createMockJsonResponse } from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import type { Keyword } from '../types';
import { useDashboardData } from './useDashboardData';

export const MOCK_API_BASE_URL = 'https://api.test.com';
export const MOCK_KEYWORDS_URL = `${MOCK_API_BASE_URL}/keywords`;
export const MOCK_AUTHORITATIVE_KEYWORDS_URL = `${MOCK_KEYWORDS_URL}?authoritative=true`;

export const mockStats = {
  total_searches: 100,
  total_citations: 500,
  total_crawled: 250,
  unique_keywords: 25,
};

export const mockCitations = {
  provider_stats: [{
    provider: 'openai',
    citation_count: 100,
  }],
  brand_stats: [{
    brand: 'TestBrand',
    mention_count: 50,
  }],
  top_urls: [{
    url: 'https://example.com',
    citation_count: 10,
    keyword_count: 5,
  }],
};

export const mockSearches = [
  {
    keyword: 'test',
    provider: 'openai',
    timestamp: '2024-01-01',
  },
];

export const mockKeywords = [
  {
    id: 'keyword-1',
    keyword: 'test keyword',
    created_at: '2024-01-01',
    status: 'active',
  },
] satisfies Keyword[];

export function createMockKeywords(count: number, namePrefix = 'keyword'): Keyword[] {
  return Array.from({ length: count }, (_unusedValue, keywordIndex) => ({
    id: `${namePrefix}-${keywordIndex + 1}`,
    keyword: `${namePrefix} ${keywordIndex + 1}`,
    created_at: '2024-01-01',
    status: 'active',
  }));
}

export function createMockAuthoritativeKeywordsResponse(
  keywords: Keyword[],
  count = keywords.length,
  complete = true
) {
  return {
    keywords,
    count,
    complete,
  };
}

export const mockAuthoritativeKeywordsResponse =
  createMockAuthoritativeKeywordsResponse(mockKeywords);

export function createMockDelayedJsonResponse(
  responsePayload: unknown,
  delayMilliseconds: number
): Promise<Response> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(createMockJsonResponse(responsePayload)), delayMilliseconds);
  });
}

interface MockFetchOverrides {
  stats?: unknown;
  citations?: unknown;
  searches?: unknown;
  keywords?: unknown;
  authoritativeResponse?: unknown;
  shouldFail?: boolean;
  failStatus?: number;
}

export function createMockFetch(overrides: MockFetchOverrides = {}) {
  return vi.fn((url: string): Promise<Response> => {
    if (overrides.shouldFail) {
      return Promise.resolve(createMockJsonResponse({}, overrides.failStatus ?? 500));
    }

    if (url === `${MOCK_API_BASE_URL}/stats`) {
      return Promise.resolve(createMockJsonResponse(overrides.stats ?? mockStats));
    }
    if (url === `${MOCK_API_BASE_URL}/citations`) {
      return Promise.resolve(createMockJsonResponse(overrides.citations ?? mockCitations));
    }
    if (url === `${MOCK_API_BASE_URL}/searches`) {
      return Promise.resolve(createMockJsonResponse({ searches: overrides.searches ?? mockSearches }));
    }
    if (url === MOCK_AUTHORITATIVE_KEYWORDS_URL) {
      return Promise.resolve(createMockJsonResponse(
        overrides.authoritativeResponse ?? mockAuthoritativeKeywordsResponse
      ));
    }
    if (url === MOCK_KEYWORDS_URL) {
      return Promise.resolve(createMockJsonResponse({ keywords: overrides.keywords ?? mockKeywords }));
    }
    return Promise.resolve(createMockJsonResponse({}));
  });
}

/**
 * Points the mocked network layer at `createMockFetch(overrides)`, renders the
 * hook and waits for the initial dashboard load to finish.
 */
export async function renderLoadedDashboard(overrides: MockFetchOverrides = {}) {
  mockAuthenticatedFetch.mockImplementation(createMockFetch(overrides));
  const rendered = renderHook(() => useDashboardData());
  await waitFor(() => expect(rendered.result.current.loading).toBe(false));
  return rendered;
}

/**
 * Switches the network layer to a fetch that never settles and starts a
 * keyword reconciliation, so its authoritative request stays in flight.
 * Returns that request's abort signal.
 */
export function startPendingKeywordReconciliation(
  result: { current: ReturnType<typeof useDashboardData> }
): AbortSignal | undefined {
  mockAuthenticatedFetch.mockImplementation(() => new Promise<Response>(vi.fn()));
  act(() => {
    void result.current.reconcileKeywords();
  });
  return mockAuthenticatedFetch.mock.lastCall?.[1]?.signal ?? undefined;
}
