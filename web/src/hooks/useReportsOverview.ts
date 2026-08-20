import { ApiRequestError } from '../infrastructure';
import type { ReportsOverviewResponse } from '../api/reports';
import { useAnalysisEndpoint } from './useAnalysisEndpoint';

function isReportsOverviewResponse(data: unknown): data is ReportsOverviewResponse {
  if (typeof data !== 'object' || data === null) return false;
  if ('error' in data) return false;
  return 'overall_score' in data
    && 'top_improving' in data
    && 'top_declining' in data
    && 'top_recommendations' in data;
}

const reportsOverviewEndpoint = {
  errorContext: 'visibility',
  logMessage: '[reportsOverview] Error fetching overview:',
  isValidResponse: isReportsOverviewResponse,
  createHttpError: (status: number) => new ApiRequestError('Failed to fetch reports overview', status),
  createResponseError: (message: string) => new ApiRequestError(message),
  buildRequest: (
    days = 30,
    period: 'day' | 'week' | 'month' = 'day',
    top = 3,
  ) => {
    const params = new URLSearchParams({
      days: days.toString(),
      period,
      top: top.toString(),
    });
    return {
      path: '/reports/overview',
      params,
    };
  },
};

/**
 * Imperative hook for the cross-keyword reports-overview rollup. Pairs
 * with the `/reports/overview` aggregator endpoint and is consumed by
 * the Executive Summary report and (optionally) the Brand Visibility
 * all-keywords variant.
 *
 * Imperative (rather than auto-fetching) so the report component can
 * compose this slice with `useReportReady` exactly the same way as
 * other report slices, and so a refresh button can re-run the fetch
 * without unmount/remount.
 */
export function useReportsOverview() {
  const {
    data, loading, error, fetchData: fetchReportsOverview,
  } = useAnalysisEndpoint(reportsOverviewEndpoint);

  return {
    data,
    loading,
    error,
    fetchReportsOverview,
  };
}
