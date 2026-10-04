import {
  describe, it, expect, vi 
} from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRecommendations } from './useRecommendations';
import { mockRecommendationsResponse } from './useRecommendations-fixtures';
import { describeEndpointHookContract } from '../test/endpointHookContract';
import { idleEndpointState } from '../test/idleEndpointState';
import {
  INVALID_REQUEST_ON_TYPE_GUARD_FAILURE, UNABLE_TO_LOAD_ON_NON_OK_STATUS
} from './useAnalysisEndpoint-failure-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

type FetchRecommendationsArgs = Parameters<ReturnType<typeof useRecommendations>['fetchRecommendations']>;

describe('useRecommendations', () => {
  it('starts with no data, not loading, and no error', () => {
    const { result } = renderHook(() => useRecommendations());

    expect(result.current).toStrictEqual(idleEndpointState('fetchRecommendations'));
  });

  describeEndpointHookContract({
    subject: 'recommendations',
    useHook: useRecommendations,
    fetchName: 'fetchRecommendations',
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
      UNABLE_TO_LOAD_ON_NON_OK_STATUS,
      INVALID_REQUEST_ON_TYPE_GUARD_FAILURE,
    ],
  });

});
