import {
  describe, it, expect, vi 
} from 'vitest';
import {
  renderHook, act 
} from '@testing-library/react';
import { useReportsOverview } from './useReportsOverview';
import { mockReportsOverview } from './useReportsOverview-fixtures';
import {
  createEndpointMockFetch, type EndpointMockFetchOptions 
} from '../test/fetchResponses';
import {
  groupScope, keywordScope 
} from '../components/ui/reportScope-fixtures';
import type { ReportsOverviewResponse } from '../api/reports';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

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

  it.each<[url: string, condition: string, args: FetchReportsOverviewArgs]>([
    ['https://api.test.com/reports/overview?scope=all&days=30&period=day&top=3', 'no arguments are given', []],
    ['https://api.test.com/reports/overview?scope=all&days=60&period=week&top=5', 'days, period, and top are given', [60, 'week', 5]],
    ['https://api.test.com/reports/overview?group_id=grp-luxury&days=30&period=day&top=3', 'a group scope is given', [30, 'day', 3, groupScope('grp-luxury')]],
    ['https://api.test.com/reports/overview?keyword=best+hotels&days=30&period=day&top=3', 'a keyword scope is given', [30, 'day', 3, keywordScope('best hotels')]],
  ])('requests %s when %s', async (url, _condition, args) => {
    mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(mockReportsOverview));
    const { result } = renderHook(() => useReportsOverview());

    await act(() => result.current.fetchReportsOverview(...args));

    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(url, { signal: expect.any(AbortSignal) });
  });

  it('returns and stores the overview when the response passes the overview type guard', async () => {
    mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(mockReportsOverview));
    const { result } = renderHook(() => useReportsOverview());

    const returned = await act(() => result.current.fetchReportsOverview());

    expect(returned).toStrictEqual(mockReportsOverview);
    expect(result.current).toStrictEqual({
      data: mockReportsOverview,
      loading: false,
      error: null,
      fetchReportsOverview: expect.any(Function),
    });
  });

  it.each<[message: string, failure: string, options: EndpointMockFetchOptions<ReportsOverviewResponse>]>([
    ['Failed to load visibility metrics', 'request returns a non-ok status', { shouldFail: true }],
    ['Failed to load visibility metrics', 'response is a backend {error} body', { errorResponse: { error: 'No data' } }],
    ['Invalid visibility request', 'payload is missing the overall_score field', { invalidResponse: true }],
  ])('resolves null and reports "%s" when the overview %s', async (message, _failure, options) => {
    mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(mockReportsOverview, options));
    const { result } = renderHook(() => useReportsOverview());

    const returned = await act(() => result.current.fetchReportsOverview());

    expect(returned).toBeNull();
    expect(result.current).toStrictEqual({
      data: null,
      loading: false,
      error: message,
      fetchReportsOverview: expect.any(Function),
    });
  });
});
