import { ApiRequestError } from '../infrastructure';
import type { ReportsOverviewResponse } from '../api/reports';
import type { ReportScope } from '../types';
import { reportScopeParams } from '../components/ui/reportScope';
import { useAnalysisEndpoint } from './useAnalysisEndpoint';

function isReportsOverviewResponse(data: unknown): data is ReportsOverviewResponse {
  if (typeof data !== 'object' || data === null) return false;
  if ('error' in data) return false;
  return 'kpis' in data
    && 'summary' in data
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
    scope: ReportScope = { kind: 'all' },
  ) => {
    const params = new URLSearchParams({
      ...reportScopeParams(scope),
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
 * Imperative hook for the `/reports/overview` aggregator endpoint: the
 * trend view's latest KPIs and change, keywords by trend, the top movers
 * and the top recommendations. Consumed by the Executive Summary report.
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
