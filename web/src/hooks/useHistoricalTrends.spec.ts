import {
  describe, it, expect, vi 
} from 'vitest';
import {
  renderHook, waitFor, act 
} from '@testing-library/react';
import { useHistoricalTrends } from './useHistoricalTrends';
import {
  mockSingleKeywordResponse, mockAllKeywordsResponse 
} from './useHistoricalTrends-fixtures';
import {
  createDeferredResponse,
  createEndpointMockFetch,
  createMockJsonResponse,
  type EndpointMockFetchOptions,
} from '../test/fetchResponses';
import { ALL_SCOPE } from '../components/ui/reportScope';
import {
  groupScope, keywordScope 
} from '../components/ui/reportScope-fixtures';
import type { HistoricalTrendsResponse } from '../types';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

type FetchHistoricalTrendsArgs = Parameters<ReturnType<typeof useHistoricalTrends>['fetchHistoricalTrends']>;

describe('useHistoricalTrends', () => {
  it('starts with no data, not loading, and no error', () => {
    const { result } = renderHook(() => useHistoricalTrends());

    expect(result.current).toStrictEqual({
      data: null,
      loading: false,
      error: null,
      fetchHistoricalTrends: expect.any(Function),
    });
  });

  describe('fetchHistoricalTrends', () => {
    it('sets loading true while the trends request is in flight', async () => {
      const deferred = createDeferredResponse();
      mockAuthenticatedFetch.mockReturnValue(deferred.promise);
      const { result } = renderHook(() => useHistoricalTrends());

      act(() => {
        result.current.fetchHistoricalTrends(keywordScope('test'));
      });
      expect(result.current.loading).toBe(true);

      await act(async () => {
        deferred.resolve(createMockJsonResponse(mockSingleKeywordResponse));
      });
      await waitFor(() => expect(result.current.loading).toBe(false));
    });

    it.each<[url: string, condition: string, args: FetchHistoricalTrendsArgs]>([
      ['https://api.test.com/trends?keyword=best+hotels&period=day&days=30', 'only a keyword scope is given', [keywordScope('best hotels')]],
      ['https://api.test.com/trends?keyword=test&period=week&days=30', 'a period is given', [keywordScope('test'), 'week']],
      ['https://api.test.com/trends?keyword=test&period=day&days=60', 'a day count is given', [keywordScope('test'), 'day', 60]],
      ['https://api.test.com/trends?group_id=grp-luxury&period=day&days=30', 'a group scope is given', [groupScope('grp-luxury')]],
      ['https://api.test.com/trends?scope=all&period=day&days=30', 'the all-keywords scope is given', [ALL_SCOPE]],
    ])('requests %s when %s', async (url, _condition, args) => {
      mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(mockSingleKeywordResponse));
      const { result } = renderHook(() => useHistoricalTrends());

      await act(() => result.current.fetchHistoricalTrends(...args));

      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(url, { signal: expect.any(AbortSignal) });
    });

    it.each<[payload: string, response: HistoricalTrendsResponse, args: FetchHistoricalTrendsArgs]>([
      ['single-keyword trend', mockSingleKeywordResponse, [keywordScope('best hotels')]],
      ['all-keywords trend rollup', mockAllKeywordsResponse, [ALL_SCOPE]],
    ])('returns and stores the %s when the response passes the trends type guard', async (_payload, response, args) => {
      mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(response));
      const { result } = renderHook(() => useHistoricalTrends());

      const returned = await act(() => result.current.fetchHistoricalTrends(...args));

      expect(returned).toStrictEqual(response);
      expect(result.current).toStrictEqual({
        data: response,
        loading: false,
        error: null,
        fetchHistoricalTrends: expect.any(Function),
      });
    });

    it.each<[message: string, failure: string, options: EndpointMockFetchOptions<HistoricalTrendsResponse>]>([
      ['Failed to load visibility metrics', 'request returns a non-ok status', { shouldFail: true }],
      ['Failed to load visibility metrics', 'response is a backend {error} body', { errorResponse: { error: 'No data' } }],
      ['Invalid visibility request', 'payload fails the type guard', { invalidResponse: true }],
    ])('resolves null and reports "%s" when the trends %s', async (message, _failure, options) => {
      mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(mockSingleKeywordResponse, options));
      const { result } = renderHook(() => useHistoricalTrends());

      const returned = await act(() => result.current.fetchHistoricalTrends(keywordScope('test')));

      expect(returned).toBeNull();
      expect(result.current).toStrictEqual({
        data: null,
        loading: false,
        error: message,
        fetchHistoricalTrends: expect.any(Function),
      });
    });

    it('clears the previous error when a later trends fetch succeeds', async () => {
      mockAuthenticatedFetch
        .mockResolvedValueOnce(createMockJsonResponse({}, 500))
        .mockResolvedValueOnce(createMockJsonResponse(mockSingleKeywordResponse));
      const { result } = renderHook(() => useHistoricalTrends());

      await act(() => result.current.fetchHistoricalTrends(keywordScope('test')));
      expect(result.current.error).toBe('Failed to load visibility metrics');

      await act(() => result.current.fetchHistoricalTrends(keywordScope('test')));
      expect(result.current.error).toBeNull();
    });
  });
});
