import {
  describe, expect, it, vi
} from 'vitest';
import {
  act, renderHook, waitFor
} from '@testing-library/react';
import { useReportInsights } from './useReportInsights';
import {
  insightsRequest, mockInsightsEndpoint, renderLoadedInsights
} from './useReportInsights-endpoint-fixtures';
import {
  FAILED_TO_LOAD_ON_NON_OK_STATUS, INVALID_REQUEST_ON_TYPE_GUARD_FAILURE
} from './useAnalysisEndpoint-failure-fixtures';
import { buildReportInsights } from '../types/domain/insights-fixtures';
import {
  ALL_SCOPE, groupScope, keywordScope
} from '../components/ui/reportScope-fixtures';
import { waitForLoaded } from '../test/loadedHook';
import { spyOnAbortAfterPendingUnmount } from '../test/abortOnUnmount';
import {
  deferAuthenticatedFetch, mockAuthenticatedFetch
} from '../test/infrastructureMock';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

const HOTEL_SOL = groupScope('hotel-sol');
const HOTEL_SOL_URL = 'https://api.test.com/reports/insights?group_id=hotel-sol&days=90';

describe('useReportInsights', () => {
  it('reports loading while the request is pending', () => {
    deferAuthenticatedFetch();

    const { result } = renderHook(() => useReportInsights(HOTEL_SOL, 90));

    expect(result.current.loading).toBe(true);
  });

  it.each([
    ['a keyword group over 90 days', HOTEL_SOL, 90, HOTEL_SOL_URL],
    ['every keyword over 30 days', ALL_SCOPE, 30, 'https://api.test.com/reports/insights?scope=all&days=30'],
    ['one keyword over 7 days', keywordScope('best hotels in paris'), 7, 'https://api.test.com/reports/insights?keyword=best+hotels+in+paris&days=7'],
  ])('requests the insights of %s', async (_scope, scope, days, url) => {
    await renderLoadedInsights(scope, days);

    expect(mockAuthenticatedFetch).toHaveBeenCalledWith(...insightsRequest(url));
  });

  it('stores the insights when the response passes the type guard', async () => {
    const { result } = await renderLoadedInsights(HOTEL_SOL, 90);

    expect(result.current.data).toStrictEqual(buildReportInsights());
    expect(result.current.error).toBeNull();
  });

  it.each([FAILED_TO_LOAD_ON_NON_OK_STATUS, INVALID_REQUEST_ON_TYPE_GUARD_FAILURE])(
    'reports "%s" without data, and logs the failure, when the %s',
    async (message, _failure, options) => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());

      const { result } = await renderLoadedInsights(HOTEL_SOL, 90, options);

      expect(result.current.error).toBe(message);
      expect(result.current.data).toBeNull();
      expect(consoleError).toHaveBeenCalledWith('[reportInsights] Error fetching insights:', expect.any(Error));
    },
  );

  it('fetches again when the scope changes', async () => {
    mockInsightsEndpoint();
    const {
      result, rerender
    } = renderHook(({ groupId }: { groupId: string }) => useReportInsights(groupScope(groupId), 90), { initialProps: { groupId: 'hotel-sol' } });
    await waitForLoaded(result);

    rerender({ groupId: 'hotel-luna' });

    await waitFor(() => {
      expect(mockAuthenticatedFetch).toHaveBeenLastCalledWith(...insightsRequest('https://api.test.com/reports/insights?group_id=hotel-luna&days=90'));
    });
  });

  it('fetches once for a scope rebuilt with the same value on every render', async () => {
    mockInsightsEndpoint();
    const {
      result, rerender
    } = renderHook(() => useReportInsights(groupScope('hotel-sol'), 90));
    await waitForLoaded(result);

    rerender();

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
  });

  it('requests the same insights again on refetch', async () => {
    const { result } = await renderLoadedInsights(HOTEL_SOL, 90);

    await act(() => result.current.refetch());

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(2);
    expect(mockAuthenticatedFetch).toHaveBeenLastCalledWith(...insightsRequest(HOTEL_SOL_URL));
  });

  it('aborts its request on unmount', () => {
    const abortSpy = spyOnAbortAfterPendingUnmount(() => renderHook(() => useReportInsights(HOTEL_SOL, 90)));

    expect(abortSpy).toHaveBeenCalledWith();
  });
});
