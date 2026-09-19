import {
  describe, it, expect, vi 
} from 'vitest';
import {
  renderHook, waitFor, act 
} from '@testing-library/react';
import { useRecommendations } from './useRecommendations';
import {
  mockRecommendationsResponse,
  buildRecommendationStatusRow,
  renderLoadedRecommendations,
} from './useRecommendations-fixtures';
import {
  createDeferredResponse,
  createEndpointMockFetch,
  createMockJsonResponse,
  type EndpointMockFetchOptions,
} from '../test/fetchResponses';
import type {
  RecommendationsResponse, RecommendationStatus 
} from '../types';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

type FetchRecommendationsArgs = Parameters<ReturnType<typeof useRecommendations>['fetchRecommendations']>;

describe('useRecommendations', () => {
  it('starts with no data, not loading, and no error', () => {
    const { result } = renderHook(() => useRecommendations());

    expect(result.current).toStrictEqual({
      data: null,
      loading: false,
      error: null,
      fetchRecommendations: expect.any(Function),
      updateRecommendationStatus: expect.any(Function),
    });
  });

  describe('fetchRecommendations', () => {
    it('sets loading true while the recommendations request is in flight', async () => {
      const deferred = createDeferredResponse();
      mockAuthenticatedFetch.mockReturnValue(deferred.promise);
      const { result } = renderHook(() => useRecommendations());

      act(() => {
        result.current.fetchRecommendations();
      });
      expect(result.current.loading).toBe(true);

      await act(async () => {
        deferred.resolve(createMockJsonResponse(mockRecommendationsResponse));
      });
      await waitFor(() => expect(result.current.loading).toBe(false));
    });

    it.each<[url: string, condition: string, args: FetchRecommendationsArgs]>([
      ['https://api.test.com/recommendations?use_llm=false', 'no arguments are given', []],
      ['https://api.test.com/recommendations?use_llm=true', 'LLM generation is requested', [true]],
    ])('requests %s when %s', async (url, _condition, args) => {
      mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(mockRecommendationsResponse));
      const { result } = renderHook(() => useRecommendations());

      await act(() => result.current.fetchRecommendations(...args));

      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(url);
    });

    it('returns and stores the recommendations when the response passes the type guard', async () => {
      mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(mockRecommendationsResponse));
      const { result } = renderHook(() => useRecommendations());

      const returned = await act(() => result.current.fetchRecommendations());

      expect(returned).toStrictEqual(mockRecommendationsResponse);
      expect(result.current).toStrictEqual({
        data: mockRecommendationsResponse,
        loading: false,
        error: null,
        fetchRecommendations: expect.any(Function),
        updateRecommendationStatus: expect.any(Function),
      });
    });

    it.each<[message: string, failure: string, options: EndpointMockFetchOptions<RecommendationsResponse>]>([
      ['Unable to load visibility metrics', 'request returns a non-ok status', { shouldFail: true }],
      ['Invalid visibility request', 'payload fails the type guard', { invalidResponse: true }],
    ])('resolves null and reports "%s" when the recommendations %s', async (message, _failure, options) => {
      mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(mockRecommendationsResponse, options));
      const { result } = renderHook(() => useRecommendations());

      const returned = await act(() => result.current.fetchRecommendations());

      expect(returned).toBeNull();
      expect(result.current).toStrictEqual({
        data: null,
        loading: false,
        error: message,
        fetchRecommendations: expect.any(Function),
        updateRecommendationStatus: expect.any(Function),
      });
    });

    it('clears the previous error when a later recommendations fetch succeeds', async () => {
      mockAuthenticatedFetch
        .mockResolvedValueOnce(createMockJsonResponse({}, 500))
        .mockResolvedValueOnce(createMockJsonResponse(mockRecommendationsResponse));
      const { result } = renderHook(() => useRecommendations());

      await act(() => result.current.fetchRecommendations());
      expect(result.current.error).toBe('Unable to load visibility metrics');

      await act(() => result.current.fetchRecommendations());
      expect(result.current.error).toBeNull();
    });
  });

  describe('updateRecommendationStatus', () => {
    it('posts the new status to /recommendations/{id}/status', async () => {
      const { result } = await renderLoadedRecommendations(
        createMockJsonResponse(buildRecommendationStatusRow('in_progress')),
      );

      await act(() => result.current.updateRecommendationStatus('rec-001', { status: 'in_progress' }));

      expect(mockAuthenticatedFetch).toHaveBeenLastCalledWith(
        'https://api.test.com/recommendations/rec-001/status',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'in_progress' }),
        },
      );
    });

    it('serialises notes and relationship pointers in the request body', async () => {
      const { result } = await renderLoadedRecommendations(
        createMockJsonResponse(buildRecommendationStatusRow('done')),
      );

      await act(() => result.current.updateRecommendationStatus('rec-001', {
        status: 'done',
        notes: 'pitched outdoor pubs',
        relatedKeyword: 'best running shoes',
        relatedContentId: 'content-42',
      }));

      const statusRequest = mockAuthenticatedFetch.mock.calls[1][1];
      expect(JSON.parse(String(statusRequest?.body))).toStrictEqual({
        status: 'done',
        notes: 'pitched outdoor pubs',
        related_keyword: 'best running shoes',
        related_content_id: 'content-42',
      });
    });

    it.each<[status: RecommendationStatus, server: string, statusResponse: Response]>([
      ['done', 'accepts the update', createMockJsonResponse(buildRecommendationStatusRow('done'))],
      ['new', 'rejects the update', createMockJsonResponse({}, 500)],
    ])('shows status "%s" for the recommendation when the server %s', async (status, _server, statusResponse) => {
      const { result } = await renderLoadedRecommendations(statusResponse);

      await act(() => result.current.updateRecommendationStatus('rec-001', { status: 'done' }));

      const updated = result.current.data?.recommendations.find((rec) => rec.id === 'rec-001');
      expect(updated?.status).toBe(status);
    });

    it('returns null and skips the fetch when id is empty', async () => {
      const { result } = renderHook(() => useRecommendations());

      const ret = await act(
        () => result.current.updateRecommendationStatus('', { status: 'done' }),
      );

      expect(ret).toBeNull();
      expect(mockAuthenticatedFetch).not.toHaveBeenCalled();
    });
  });
});
