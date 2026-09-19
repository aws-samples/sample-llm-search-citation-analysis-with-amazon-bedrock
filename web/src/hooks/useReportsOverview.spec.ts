import {
  describe, it, expect, vi 
} from 'vitest';
import { renderHook } from '@testing-library/react';
import { useReportsOverview } from './useReportsOverview';
import { mockReportsOverview } from './useReportsOverview-fixtures';
import { describeEndpointHookContract } from '../test/endpointHookContract';
import {
  groupScope, keywordScope 
} from '../components/ui/reportScope-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

type FetchReportsOverviewArgs = Parameters<ReturnType<typeof useReportsOverview>['fetchReportsOverview']>;

describe('useReportsOverview', () => {
  it('starts with no data, not loading, and no error', () => {
    const { result } = renderHook(() => useReportsOverview());

    expect(result.current).toStrictEqual({
      data: null,
      loading: false,
      error: null,
      fetchReportsOverview: expect.any(Function),
    });
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
      ['Failed to load visibility metrics', 'request returns a non-ok status', { shouldFail: true }],
      ['Failed to load visibility metrics', 'response is a backend {error} body', { errorResponse: { error: 'No data' } }],
      ['Invalid visibility request', 'payload is missing the overall_score field', { invalidResponse: true }],
    ],
  });
});
