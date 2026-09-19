import {
  describe, it, expect, vi 
} from 'vitest';
import {
  renderHook, waitFor, act 
} from '@testing-library/react';
import { usePromptInsights } from './usePromptInsights';
import { mockPromptInsightsResponse } from './usePromptInsights-fixtures';
import {
  createDeferredResponse,
  createEndpointMockFetch,
  createMockJsonResponse,
  type EndpointMockFetchOptions,
} from '../test/fetchResponses';
import type { PromptInsightsResponse } from '../types';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

type FetchPromptInsightsArgs = Parameters<ReturnType<typeof usePromptInsights>['fetchPromptInsights']>;

describe('usePromptInsights', () => {
  it('starts with no data, not loading, and no error', () => {
    const { result } = renderHook(() => usePromptInsights());

    expect(result.current).toStrictEqual({
      data: null,
      loading: false,
      error: null,
      fetchPromptInsights: expect.any(Function),
    });
  });

  describe('fetchPromptInsights', () => {
    it('sets loading true while the prompt insights request is in flight', async () => {
      const deferred = createDeferredResponse();
      mockAuthenticatedFetch.mockReturnValue(deferred.promise);
      const { result } = renderHook(() => usePromptInsights());

      act(() => {
        result.current.fetchPromptInsights();
      });
      expect(result.current.loading).toBe(true);

      await act(async () => {
        deferred.resolve(createMockJsonResponse(mockPromptInsightsResponse));
      });
      await waitFor(() => expect(result.current.loading).toBe(false));
    });

    it.each<[url: string, condition: string, args: FetchPromptInsightsArgs]>([
      ['https://api.test.com/prompt-insights?type=all&limit=20', 'no arguments are given', []],
      ['https://api.test.com/prompt-insights?type=winning&limit=20', 'a prompt type is given', ['winning']],
      ['https://api.test.com/prompt-insights?type=all&limit=50', 'a limit is given', ['all', 50]],
    ])('requests %s when %s', async (url, _condition, args) => {
      mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(mockPromptInsightsResponse));
      const { result } = renderHook(() => usePromptInsights());

      await act(() => result.current.fetchPromptInsights(...args));

      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(url, { signal: expect.any(AbortSignal) });
    });

    it('returns and stores the prompt insights when the response passes the type guard', async () => {
      mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(mockPromptInsightsResponse));
      const { result } = renderHook(() => usePromptInsights());

      const returned = await act(() => result.current.fetchPromptInsights());

      expect(returned).toStrictEqual(mockPromptInsightsResponse);
      expect(result.current).toStrictEqual({
        data: mockPromptInsightsResponse,
        loading: false,
        error: null,
        fetchPromptInsights: expect.any(Function),
      });
    });

    it.each<[message: string, failure: string, options: EndpointMockFetchOptions<PromptInsightsResponse>]>([
      ['Unable to load visibility metrics', 'request returns a non-ok status', { shouldFail: true }],
      ['Invalid visibility request', 'payload fails the type guard', { invalidResponse: true }],
    ])('resolves null and reports "%s" when the prompt insights %s', async (message, _failure, options) => {
      mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(mockPromptInsightsResponse, options));
      const { result } = renderHook(() => usePromptInsights());

      const returned = await act(() => result.current.fetchPromptInsights());

      expect(returned).toBeNull();
      expect(result.current).toStrictEqual({
        data: null,
        loading: false,
        error: message,
        fetchPromptInsights: expect.any(Function),
      });
    });

    it('clears the previous error when a later prompt insights fetch succeeds', async () => {
      mockAuthenticatedFetch
        .mockResolvedValueOnce(createMockJsonResponse({}, 500))
        .mockResolvedValueOnce(createMockJsonResponse(mockPromptInsightsResponse));
      const { result } = renderHook(() => usePromptInsights());

      await act(() => result.current.fetchPromptInsights());
      expect(result.current.error).toBe('Unable to load visibility metrics');

      await act(() => result.current.fetchPromptInsights());
      expect(result.current.error).toBeNull();
    });
  });
});
