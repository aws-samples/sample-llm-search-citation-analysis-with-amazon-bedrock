import {
  describe, it, expect, vi 
} from 'vitest';
import {
  renderHook, waitFor, act 
} from '@testing-library/react';
import { useCitationGaps } from './useCitationGaps';
import {
  mockCitationGapsResponse, mockAllKeywordsResponse 
} from './useCitationGaps-fixtures';
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
import type { CitationGapsResponse } from '../types';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

type FetchCitationGapsArgs = Parameters<ReturnType<typeof useCitationGaps>['fetchCitationGaps']>;

describe('useCitationGaps', () => {
  it('starts with no data, not loading, and no error', () => {
    const { result } = renderHook(() => useCitationGaps());

    expect(result.current).toStrictEqual({
      data: null,
      loading: false,
      error: null,
      fetchCitationGaps: expect.any(Function),
    });
  });

  describe('fetchCitationGaps', () => {
    it('sets loading true while the citation gaps request is in flight', async () => {
      const deferred = createDeferredResponse();
      mockAuthenticatedFetch.mockReturnValue(deferred.promise);
      const { result } = renderHook(() => useCitationGaps());

      act(() => {
        result.current.fetchCitationGaps(keywordScope('test'));
      });
      expect(result.current.loading).toBe(true);

      await act(async () => {
        deferred.resolve(createMockJsonResponse(mockCitationGapsResponse));
      });
      await waitFor(() => expect(result.current.loading).toBe(false));
    });

    it.each<[url: string, condition: string, args: FetchCitationGapsArgs]>([
      ['https://api.test.com/citation-gaps?keyword=best+hotels&limit=10', 'a keyword scope is given', [keywordScope('best hotels')]],
      ['https://api.test.com/citation-gaps?keyword=test&limit=20', 'a limit is given', [keywordScope('test'), 20]],
      ['https://api.test.com/citation-gaps?group_id=grp-luxury&limit=10', 'a group scope is given', [groupScope('grp-luxury')]],
      ['https://api.test.com/citation-gaps?scope=all&limit=10', 'the all-keywords scope is given', [ALL_SCOPE]],
    ])('requests %s when %s', async (url, _condition, args) => {
      mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(mockCitationGapsResponse));
      const { result } = renderHook(() => useCitationGaps());

      await act(() => result.current.fetchCitationGaps(...args));

      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(url, { signal: expect.any(AbortSignal) });
    });

    it.each<[payload: string, response: CitationGapsResponse, args: FetchCitationGapsArgs]>([
      ['single-keyword citation gaps', mockCitationGapsResponse, [keywordScope('best hotels')]],
      ['all-keywords citation gap rollup', mockAllKeywordsResponse, [ALL_SCOPE]],
    ])('returns and stores the %s when the response passes the citation gaps type guard', async (_payload, response, args) => {
      mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(response));
      const { result } = renderHook(() => useCitationGaps());

      const returned = await act(() => result.current.fetchCitationGaps(...args));

      expect(returned).toStrictEqual(response);
      expect(result.current).toStrictEqual({
        data: response,
        loading: false,
        error: null,
        fetchCitationGaps: expect.any(Function),
      });
    });

    it.each<[message: string, failure: string, options: EndpointMockFetchOptions<CitationGapsResponse>]>([
      ['Failed to load visibility metrics', 'request returns a non-ok status', { shouldFail: true }],
      ['Failed to load visibility metrics', 'response is a backend {error} body', { errorResponse: { error: 'No brand config found' } }],
      ['Invalid visibility request', 'payload fails the type guard', { invalidResponse: true }],
    ])('resolves null and reports "%s" when the citation gaps %s', async (message, _failure, options) => {
      mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(mockCitationGapsResponse, options));
      const { result } = renderHook(() => useCitationGaps());

      const returned = await act(() => result.current.fetchCitationGaps(keywordScope('test')));

      expect(returned).toBeNull();
      expect(result.current).toStrictEqual({
        data: null,
        loading: false,
        error: message,
        fetchCitationGaps: expect.any(Function),
      });
    });

    it('clears the previous error when a later citation gaps fetch succeeds', async () => {
      mockAuthenticatedFetch
        .mockResolvedValueOnce(createMockJsonResponse({}, 500))
        .mockResolvedValueOnce(createMockJsonResponse(mockCitationGapsResponse));
      const { result } = renderHook(() => useCitationGaps());

      await act(() => result.current.fetchCitationGaps(keywordScope('test')));
      expect(result.current.error).toBe('Failed to load visibility metrics');

      await act(() => result.current.fetchCitationGaps(keywordScope('test')));
      expect(result.current.error).toBeNull();
    });
  });
});
