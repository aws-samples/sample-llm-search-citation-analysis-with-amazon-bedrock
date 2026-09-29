import {
  describe, it, expect, vi
} from 'vitest';
import {
  renderHook, act
} from '@testing-library/react';
import { useVisibilityMetrics } from './useVisibilityMetrics';
import {
  INVALID_REQUEST_STATE, REJECTED_VISIBILITY_BODIES, mockKeywordVisibilityResponse, mockVisibilityResponse, renderAnsweredWith
} from './useVisibilityMetrics-fixtures';
import { renderDeferredEndpoint } from './useAnalysisEndpoint-fixtures';
import { describeEndpointHookContract } from '../test/endpointHookContract';
import {
  ALL_SCOPE, groupScope, keywordScope
} from '../components/ui/reportScope-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

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

  describeEndpointHookContract({
    subject: 'visibility',
    useHook: useVisibilityMetrics,
    fetchName: 'fetchVisibilityMetrics',
    fetch: (hook, ...args: FetchVisibilityMetricsArgs) => hook.fetchVisibilityMetrics(...args),
    defaultResponse: mockVisibilityResponse,
    defaultArgs: [keywordScope('test')],
    requests: [
      ['https://api.test.com/visibility?keyword=best+hotels+in+paris', 'only a keyword scope is given', [keywordScope('best hotels in paris')]],
      ['https://api.test.com/visibility?keyword=best+hotels&brand=MyHotel', 'a brand filter is given', [keywordScope('best hotels'), undefined, 'MyHotel']],
      ['https://api.test.com/visibility?keyword=best+hotels&query_prompt_id=prompt-7', 'a query prompt id is given', [keywordScope('best hotels'), 'prompt-7']],
      ['https://api.test.com/visibility?group_id=grp-luxury', 'a group scope is given', [groupScope('grp-luxury')]],
      ['https://api.test.com/visibility?scope=all', 'the all-keywords scope is given', [ALL_SCOPE]],
    ],
    successes: [
      ['group visibility', mockVisibilityResponse, [groupScope('grp-sol')]],
      ['single-keyword visibility in the same shape', mockKeywordVisibilityResponse, [keywordScope('hotel sol spa')]],
    ],
    failures: [
      ['Unable to load visibility metrics', 'request returns a non-ok status', { shouldFail: true }],
      ['Failed to load visibility metrics', 'response is a backend {error} body', { errorResponse: { error: 'No data available' } }],
      ['Invalid visibility request', 'payload fails the type guard', { invalidResponse: true }],
    ],
  });

  it.each(REJECTED_VISIBILITY_BODIES)('stores no visibility and reports an invalid request for %s', async (_description, body) => {
    const state = await renderAnsweredWith(useVisibilityMetrics, (hook) => hook.fetchVisibilityMetrics(ALL_SCOPE), body);

    expect(state).toStrictEqual(INVALID_REQUEST_STATE);
  });

  describe('rapid refetch', () => {
    it('aborts the previous request when a newer scope fetch starts', () => {
      const {
        deferred, startRequest
      } = renderDeferredEndpoint(useVisibilityMetrics);

      startRequest((hook) => hook.fetchVisibilityMetrics(keywordScope('old keyword')));
      startRequest((hook) => hook.fetchVisibilityMetrics(groupScope('grp-sol')));

      expect(deferred.requests.map((request) => request.signal?.aborted)).toStrictEqual([true, false]);
    });

    it('keeps the newer scope data when a stale response resolves late', async () => {
      const {
        deferred, result, startRequest
      } = renderDeferredEndpoint(useVisibilityMetrics);

      startRequest((hook) => hook.fetchVisibilityMetrics(keywordScope('hotel sol spa')));
      startRequest((hook) => hook.fetchVisibilityMetrics(groupScope('grp-sol')));
      await act(async () => {
        deferred.requests[1].respond(mockVisibilityResponse);
      });
      await act(async () => {
        deferred.requests[0].respond(mockKeywordVisibilityResponse);
      });

      expect(result.current.data).toStrictEqual(mockVisibilityResponse);
      expect(result.current.error).toBeNull();
    });
  });
});
