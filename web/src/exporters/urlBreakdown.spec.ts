import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import { createMockJsonResponse } from '../test/fetchResponses';
import { fetchBreakdownData } from './citationParser';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

const FIRST = {
  keyword: 'hotels madrid',
  provider: 'openai',
  timestamp: '2026-11-01',
};
const SECOND = {
  keyword: 'hotels sevilla',
  provider: 'gemini',
  timestamp: '2026-11-02',
};

describe('fetchBreakdownData', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
  });

  it('follows next_token to the last page', async () => {
    mockAuthenticatedFetch
      .mockResolvedValueOnce(createMockJsonResponse({
        breakdown: [FIRST],
        next_token: 'tok-2',
      }))
      .mockResolvedValueOnce(createMockJsonResponse({
        breakdown: [SECOND],
        next_token: null,
      }));

    await expect(fetchBreakdownData('https://a.example/x')).resolves.toStrictEqual([FIRST, SECOND]);
  });

  it('asks for the header market and the next page token', async () => {
    mockAuthenticatedFetch
      .mockResolvedValueOnce(createMockJsonResponse({
        breakdown: [FIRST],
        next_token: 'tok-2',
      }))
      .mockResolvedValueOnce(createMockJsonResponse({ breakdown: [] }));

    await fetchBreakdownData('https://a.example/x', 'es-es');

    expect(mockAuthenticatedFetch.mock.calls.map(([url]) => String(url))).toStrictEqual([
      'https://api.test.com/url-breakdown?url=https%3A%2F%2Fa.example%2Fx&market_id=es-es',
      'https://api.test.com/url-breakdown?url=https%3A%2F%2Fa.example%2Fx&market_id=es-es&next_token=tok-2',
    ]);
  });

  it('is empty when a page cannot be read', async () => {
    mockAuthenticatedFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(fetchBreakdownData('https://a.example/x')).resolves.toStrictEqual([]);
  });
});
