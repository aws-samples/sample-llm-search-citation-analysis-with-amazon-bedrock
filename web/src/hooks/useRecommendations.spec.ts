import {
  describe, it, expect, vi 
} from 'vitest';
import {
  renderHook, act 
} from '@testing-library/react';
import { useRecommendations } from './useRecommendations';
import {
  mockRecommendationsResponse,
  buildRecommendationStatusRow,
  renderLoadedRecommendations,
} from './useRecommendations-fixtures';
import { createMockJsonResponse } from '../test/fetchResponses';
import { describeEndpointHookContract } from '../test/endpointHookContract';
import type { RecommendationStatus } from '../types';

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

  describeEndpointHookContract({
    subject: 'recommendations',
    useHook: useRecommendations,
    fetchName: 'fetchRecommendations',
    otherFunctions: ['updateRecommendationStatus'],
    fetch: (hook, ...args: FetchRecommendationsArgs) => hook.fetchRecommendations(...args),
    defaultResponse: mockRecommendationsResponse,
    defaultArgs: [],
    // The recommendations fetch is not abortable: it passes only the URL.
    expectedRequest: (url) => [url],
    requests: [
      ['https://api.test.com/recommendations?use_llm=false', 'no arguments are given', []],
      ['https://api.test.com/recommendations?use_llm=true', 'LLM generation is requested', [true]],
    ],
    successes: [
      ['recommendations', mockRecommendationsResponse, []],
    ],
    failures: [
      ['Unable to load visibility metrics', 'request returns a non-ok status', { shouldFail: true }],
      ['Invalid visibility request', 'payload fails the type guard', { invalidResponse: true }],
    ],
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
