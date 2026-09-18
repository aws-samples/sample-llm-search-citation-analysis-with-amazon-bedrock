import {
  describe, it, expect, vi 
} from 'vitest';
import {
  renderHook, act 
} from '@testing-library/react';
import { useCompetitorRollup } from './useCompetitorRollup';
import {
  mockSingleCompetitorRollup, mockAllCompetitorsRollup 
} from './useCompetitorRollup-fixtures';
import {
  createEndpointMockFetch, type EndpointMockFetchOptions 
} from '../test/fetchResponses';
import type { CompetitorReportResponse } from '../api/reports';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

type FetchCompetitorRollupArgs = Parameters<ReturnType<typeof useCompetitorRollup>['fetchCompetitorRollup']>;

describe('useCompetitorRollup', () => {
  it('starts with no data, not loading, and no error', () => {
    const { result } = renderHook(() => useCompetitorRollup());

    expect(result.current).toStrictEqual({
      data: null,
      loading: false,
      error: null,
      fetchCompetitorRollup: expect.any(Function),
    });
  });

  it.each<[url: string, condition: string, args: FetchCompetitorRollupArgs]>([
    ['https://api.test.com/reports/competitor?keyword_limit=50&competitor=Adidas', 'a competitor is given', ['Adidas']],
    ['https://api.test.com/reports/competitor?keyword_limit=50&competitor=Brand+%26+Co', 'the competitor name has special characters', ['Brand & Co']],
    ['https://api.test.com/reports/competitor?keyword_limit=75&competitor=Adidas', 'a keyword limit is given', ['Adidas', 75]],
    ['https://api.test.com/reports/competitor?keyword_limit=50', 'no competitor is given', []],
  ])('requests %s when %s', async (url, _condition, args) => {
    mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(mockSingleCompetitorRollup));
    const { result } = renderHook(() => useCompetitorRollup());

    await act(() => result.current.fetchCompetitorRollup(...args));

    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(url, { signal: expect.any(AbortSignal) });
  });

  it.each<[payload: string, response: CompetitorReportResponse, args: FetchCompetitorRollupArgs]>([
    ['single-competitor rollup', mockSingleCompetitorRollup, ['Adidas']],
    ['all-competitors rollup', mockAllCompetitorsRollup, []],
  ])('returns and stores the %s when the response passes the competitor type guard', async (_payload, response, args) => {
    mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(response));
    const { result } = renderHook(() => useCompetitorRollup());

    const returned = await act(() => result.current.fetchCompetitorRollup(...args));

    expect(returned).toStrictEqual(response);
    expect(result.current).toStrictEqual({
      data: response,
      loading: false,
      error: null,
      fetchCompetitorRollup: expect.any(Function),
    });
  });

  it.each<[message: string, failure: string, options: EndpointMockFetchOptions<CompetitorReportResponse>]>([
    ['Invalid visibility request', 'request is rejected with a 400', {
      shouldFail: true,
      failStatus: 400,
    }],
    ['Failed to load visibility metrics', 'response is a backend {error} body', { errorResponse: { error: 'Unknown competitor' } }],
    ['Invalid visibility request', 'payload has neither rollup nor rollups', { invalidResponse: true }],
  ])('resolves null and reports "%s" when the competitor %s', async (message, _failure, options) => {
    mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(mockSingleCompetitorRollup, options));
    const { result } = renderHook(() => useCompetitorRollup());

    const returned = await act(() => result.current.fetchCompetitorRollup('Unknown'));

    expect(returned).toBeNull();
    expect(result.current).toStrictEqual({
      data: null,
      loading: false,
      error: message,
      fetchCompetitorRollup: expect.any(Function),
    });
  });
});
