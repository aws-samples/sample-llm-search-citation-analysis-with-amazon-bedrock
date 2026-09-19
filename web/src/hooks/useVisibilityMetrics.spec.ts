import {
  describe, it, expect, vi 
} from 'vitest';
import {
  renderHook, waitFor, act 
} from '@testing-library/react';
import { useVisibilityMetrics } from './useVisibilityMetrics';
import { mockVisibilityResponse } from './useVisibilityMetrics-fixtures';
import { renderDeferredEndpoint } from './useAnalysisEndpoint-fixtures';
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
import type { VisibilityMetricsResponse } from '../types';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

type FetchVisibilityMetricsArgs = Parameters<ReturnType<typeof useVisibilityMetrics>['fetchVisibilityMetrics']>;

describe('useVisibilityMetrics', () => {
  it('starts with no data, not loading, and no error', () => {
    const { result } = renderHook(() => useVisibilityMetrics());

    expect(result.current).toStrictEqual({
      data: null,
      loading: false,
      error: null,
      fetchVisibilityMetrics: expect.any(Function),
    });
  });

  describe('fetchVisibilityMetrics', () => {
    it('sets loading true while the visibility request is in flight', async () => {
      const deferred = createDeferredResponse();
      mockAuthenticatedFetch.mockReturnValue(deferred.promise);
      const { result } = renderHook(() => useVisibilityMetrics());

      act(() => {
        result.current.fetchVisibilityMetrics(keywordScope('test keyword'));
      });
      expect(result.current.loading).toBe(true);

      await act(async () => {
        deferred.resolve(createMockJsonResponse(mockVisibilityResponse));
      });
      await waitFor(() => expect(result.current.loading).toBe(false));
    });

    it.each<[url: string, condition: string, args: FetchVisibilityMetricsArgs]>([
      ['https://api.test.com/visibility?keyword=best+hotels+in+paris', 'only a keyword scope is given', [keywordScope('best hotels in paris')]],
      ['https://api.test.com/visibility?keyword=best+hotels&brand=MyHotel', 'a brand filter is given', [keywordScope('best hotels'), undefined, 'MyHotel']],
      ['https://api.test.com/visibility?keyword=best+hotels&query_prompt_id=prompt-7', 'a query prompt id is given', [keywordScope('best hotels'), 'prompt-7']],
      ['https://api.test.com/visibility?group_id=grp-luxury', 'a group scope is given', [groupScope('grp-luxury')]],
      ['https://api.test.com/visibility?scope=all', 'the all-keywords scope is given', [ALL_SCOPE]],
    ])('requests %s when %s', async (url, _condition, args) => {
      mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(mockVisibilityResponse));
      const { result } = renderHook(() => useVisibilityMetrics());

      await act(() => result.current.fetchVisibilityMetrics(...args));

      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(url, { signal: expect.any(AbortSignal) });
    });

    it('returns and stores the visibility metrics when the response passes the type guard', async () => {
      mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(mockVisibilityResponse));
      const { result } = renderHook(() => useVisibilityMetrics());

      const returned = await act(() => result.current.fetchVisibilityMetrics(keywordScope('best hotels')));

      expect(returned).toStrictEqual(mockVisibilityResponse);
      expect(result.current).toStrictEqual({
        data: mockVisibilityResponse,
        loading: false,
        error: null,
        fetchVisibilityMetrics: expect.any(Function),
      });
    });

    it.each<[message: string, failure: string, options: EndpointMockFetchOptions<VisibilityMetricsResponse>]>([
      ['Unable to load visibility metrics', 'request returns a non-ok status', { shouldFail: true }],
      ['Failed to load visibility metrics', 'response is a backend {error} body', { errorResponse: { error: 'No data available' } }],
      ['Invalid visibility request', 'payload fails the type guard', { invalidResponse: true }],
    ])('resolves null and reports "%s" when the visibility %s', async (message, _failure, options) => {
      mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(mockVisibilityResponse, options));
      const { result } = renderHook(() => useVisibilityMetrics());

      const returned = await act(() => result.current.fetchVisibilityMetrics(keywordScope('test')));

      expect(returned).toBeNull();
      expect(result.current).toStrictEqual({
        data: null,
        loading: false,
        error: message,
        fetchVisibilityMetrics: expect.any(Function),
      });
    });

    it('clears the previous error when a later visibility fetch succeeds', async () => {
      mockAuthenticatedFetch
        .mockResolvedValueOnce(createMockJsonResponse({}, 500))
        .mockResolvedValueOnce(createMockJsonResponse(mockVisibilityResponse));
      const { result } = renderHook(() => useVisibilityMetrics());

      await act(() => result.current.fetchVisibilityMetrics(keywordScope('test')));
      expect(result.current.error).toBe('Unable to load visibility metrics');

      await act(() => result.current.fetchVisibilityMetrics(keywordScope('test')));
      expect(result.current.error).toBeNull();
    });
  });

  describe('rapid refetch', () => {
    it('aborts the previous request when a newer keyword fetch starts', () => {
      const {
        deferred, startRequest 
      } = renderDeferredEndpoint(useVisibilityMetrics);

      startRequest((hook) => hook.fetchVisibilityMetrics(keywordScope('old keyword')));
      startRequest((hook) => hook.fetchVisibilityMetrics(keywordScope('new keyword')));

      expect(deferred.requests[0].signal?.aborted).toBe(true);
      expect(deferred.requests[1].signal?.aborted).toBe(false);
    });

    it('keeps the newer keyword data when a stale response resolves late', async () => {
      const {
        deferred, result, startRequest 
      } = renderDeferredEndpoint(useVisibilityMetrics);

      startRequest((hook) => hook.fetchVisibilityMetrics(keywordScope('old keyword')));
      startRequest((hook) => hook.fetchVisibilityMetrics(keywordScope('best hotels')));
      await act(async () => {
        deferred.requests[1].respond(mockVisibilityResponse);
      });
      await act(async () => {
        deferred.requests[0].respond({
          ...mockVisibilityResponse,
          keyword: 'old keyword',
        });
      });

      expect(result.current.data).toStrictEqual(mockVisibilityResponse);
      expect(result.current.error).toBeNull();
    });
  });
});
