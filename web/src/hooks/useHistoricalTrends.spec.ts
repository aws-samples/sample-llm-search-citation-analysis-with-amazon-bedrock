import {
  describe, it, expect, vi
} from 'vitest';
import { renderHook } from '@testing-library/react';
import { useHistoricalTrends } from './useHistoricalTrends';
import {
  REJECTED_TRENDS_BODIES, mockFirstPeriodTrendsResponse, mockGroupTrendsResponse
} from './useHistoricalTrends-fixtures';
import {
  ALL_SCOPE, groupScope, keywordScope
} from '../components/ui/reportScope-fixtures';
import { describeEndpointHookContract } from '../test/endpointHookContract';
import {
  INVALID_REQUEST_STATE, renderAnsweredWith
} from './useVisibilityMetrics-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

type FetchHistoricalTrendsArgs = Parameters<ReturnType<typeof useHistoricalTrends>['fetchHistoricalTrends']>;

describe('useHistoricalTrends', () => {
  it('starts with no data, not loading, and no error', () => {
    const { result } = renderHook(() => useHistoricalTrends());

    expect(result.current).toStrictEqual({
      data: null,
      loading: false,
      error: null,
      fetchHistoricalTrends: expect.any(Function),
    });
  });

  describeEndpointHookContract({
    subject: 'trends',
    useHook: useHistoricalTrends,
    fetchName: 'fetchHistoricalTrends',
    fetch: (hook, ...args: FetchHistoricalTrendsArgs) => hook.fetchHistoricalTrends(...args),
    defaultResponse: mockGroupTrendsResponse,
    defaultArgs: [keywordScope('test')],
    requests: [
      ['https://api.test.com/trends?keyword=best+hotels&period=day&days=30', 'only a keyword scope is given', [keywordScope('best hotels')]],
      ['https://api.test.com/trends?keyword=test&period=week&days=30', 'a period is given', [keywordScope('test'), 'week']],
      ['https://api.test.com/trends?keyword=test&period=day&days=60', 'a day count is given', [keywordScope('test'), 'day', 60]],
      ['https://api.test.com/trends?group_id=grp-luxury&period=day&days=30', 'a group scope is given', [groupScope('grp-luxury')]],
      ['https://api.test.com/trends?scope=all&period=day&days=30', 'the all-keywords scope is given', [ALL_SCOPE]],
    ],
    successes: [
      ['group trend with a change since the previous period', mockGroupTrendsResponse, [groupScope('grp-sol')]],
      ['first-period keyword trend without a change', mockFirstPeriodTrendsResponse, [keywordScope('hotel sol spa')]],
    ],
    failures: [
      ['Failed to load visibility metrics', 'request returns a non-ok status', { shouldFail: true }],
      ['Failed to load visibility metrics', 'response is a backend {error} body', { errorResponse: { error: 'No data' } }],
      ['Invalid visibility request', 'payload fails the type guard', { invalidResponse: true }],
    ],
  });

  it.each(REJECTED_TRENDS_BODIES)('stores no trends and reports an invalid request for %s', async (_description, body) => {
    const state = await renderAnsweredWith(useHistoricalTrends, (hook) => hook.fetchHistoricalTrends(ALL_SCOPE), body);

    expect(state).toStrictEqual(INVALID_REQUEST_STATE);
  });
});
