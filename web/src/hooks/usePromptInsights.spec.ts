import {
  describe, it, expect, vi 
} from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePromptInsights } from './usePromptInsights';
import { mockPromptInsightsResponse } from './usePromptInsights-fixtures';
import { describeEndpointHookContract } from '../test/endpointHookContract';
import { idleEndpointState } from '../test/idleEndpointState';
import {
  INVALID_REQUEST_ON_TYPE_GUARD_FAILURE, UNABLE_TO_LOAD_ON_NON_OK_STATUS
} from './useAnalysisEndpoint-failure-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

type FetchPromptInsightsArgs = Parameters<ReturnType<typeof usePromptInsights>['fetchPromptInsights']>;

describe('usePromptInsights', () => {
  it('starts with no data, not loading, and no error', () => {
    const { result } = renderHook(() => usePromptInsights());

    expect(result.current).toStrictEqual(idleEndpointState('fetchPromptInsights'));
  });

  describeEndpointHookContract({
    subject: 'prompt insights',
    useHook: usePromptInsights,
    fetchName: 'fetchPromptInsights',
    fetch: (hook, ...args: FetchPromptInsightsArgs) => hook.fetchPromptInsights(...args),
    defaultResponse: mockPromptInsightsResponse,
    defaultArgs: [],
    requests: [
      ['https://api.test.com/prompt-insights?type=all&limit=20', 'no arguments are given', []],
      ['https://api.test.com/prompt-insights?type=winning&limit=20', 'a prompt type is given', ['winning']],
      ['https://api.test.com/prompt-insights?type=all&limit=50', 'a limit is given', ['all', 50]],
    ],
    successes: [
      ['prompt insights', mockPromptInsightsResponse, []],
    ],
    failures: [
      UNABLE_TO_LOAD_ON_NON_OK_STATUS,
      INVALID_REQUEST_ON_TYPE_GUARD_FAILURE,
    ],
    loggedHttpError: {
      logMessage: '[promptInsights] Error fetching prompt insights:',
      name: 'PromptInsightsFetchError',
      message: 'Failed to fetch prompt insights',
    },
  });
});
