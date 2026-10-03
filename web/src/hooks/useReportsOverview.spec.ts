import {
  describe, it, expect, vi 
} from 'vitest';
import {
  act, renderHook
} from '@testing-library/react';
import { useReportsOverview } from './useReportsOverview';
import {
  REJECTED_OVERVIEW_BODIES, mockReportsOverview, overviewWithout
} from './useReportsOverview-fixtures';
import {
  INVALID_REQUEST_STATE, renderAnsweredWith
} from './useVisibilityMetrics-fixtures';
import { describeEndpointHookContract } from '../test/endpointHookContract';
import { idleEndpointState } from '../test/idleEndpointState';
import {
  FAILED_TO_LOAD_ON_NON_OK_STATUS, failedToLoadOnBackendError
} from './useAnalysisEndpoint-failure-fixtures';
import { createMockJsonResponse } from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import {
  groupScope, keywordScope 
} from '../components/ui/reportScope-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

type FetchReportsOverviewArgs = Parameters<ReturnType<typeof useReportsOverview>['fetchReportsOverview']>;

describe('useReportsOverview', () => {
  it('starts with no data, not loading, and no error', () => {
    const { result } = renderHook(() => useReportsOverview());

    expect(result.current).toStrictEqual(idleEndpointState('fetchReportsOverview'));
  });

  describeEndpointHookContract({
    subject: 'overview',
    useHook: useReportsOverview,
    fetchName: 'fetchReportsOverview',
    fetch: (hook, ...args: FetchReportsOverviewArgs) => hook.fetchReportsOverview(...args),
    defaultResponse: mockReportsOverview,
    defaultArgs: [],
    requests: [
      ['https://api.test.com/reports/overview?scope=all&days=30&period=day&top=3', 'no arguments are given', []],
      ['https://api.test.com/reports/overview?scope=all&days=60&period=week&top=5', 'days, period, and top are given', [60, 'week', 5]],
      ['https://api.test.com/reports/overview?group_id=grp-luxury&days=30&period=day&top=3', 'a group scope is given', [30, 'day', 3, groupScope('grp-luxury')]],
      ['https://api.test.com/reports/overview?keyword=best+hotels&days=30&period=day&top=3', 'a keyword scope is given', [30, 'day', 3, keywordScope('best hotels')]],
    ],
    successes: [
      ['overview', mockReportsOverview, []],
    ],
    failures: [
      FAILED_TO_LOAD_ON_NON_OK_STATUS,
      failedToLoadOnBackendError('No data'),
      ['Invalid visibility request', 'payload is missing the kpis field', { invalidResponse: true }],
    ],
  });

  it.each(['kpis', 'summary', 'trend_data', 'latest_brands'] as const)('reports an invalid request when the overview has no %s', async (field) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(overviewWithout(field)));
    const { result } = renderHook(() => useReportsOverview());

    await act(() => result.current.fetchReportsOverview());

    expect(result.current.error).toBe('Invalid visibility request');
    consoleError.mockRestore();
  });

  it.each(REJECTED_OVERVIEW_BODIES)('stores no overview and reports an invalid request for %s', async (_description, body) => {
    const state = await renderAnsweredWith(useReportsOverview, (hook) => hook.fetchReportsOverview(), body);

    expect(state).toStrictEqual(INVALID_REQUEST_STATE);
  });
});
