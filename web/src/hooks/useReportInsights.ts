import {
  useCallback, useEffect
} from 'react';
import type { ReportScope } from '../types';
import { isReportInsightsResponse } from '../types/domain/insightsDecoders';
import {
  decodeReportScope, encodeReportScope, reportScopeParams
} from '../components/ui/reportScope';
import {
  apiRequestErrors, useAnalysisEndpoint
} from './useAnalysisEndpoint';
import { useSelectedMarketId } from '../components/Markets/marketSelectionContext';

const reportInsightsEndpoint = {
  errorContext: 'visibility',
  logMessage: '[reportInsights] Error fetching insights:',
  isValidResponse: isReportInsightsResponse,
  ...apiRequestErrors('Failed to fetch the insights'),
  buildRequest: (scope: ReportScope, marketId: string | null, days: number) => {
    const params = new URLSearchParams(reportScopeParams(scope, marketId));
    params.set('days', String(days));
    return {
      path: '/reports/insights',
      params,
    };
  },
};

/**
 * The insights of a report scope (`GET /reports/insights`): the play per AI
 * engine, the first-party brand portfolio and, for a keyword group, how far
 * each keyword swings over the runs of the last `days` days. Fetched on mount
 * and again whenever the scope or the period changes; `refetch` re-runs the
 * current request.
 */
export function useReportInsights(scope: ReportScope, days: number) {
  const {
    data, loading, error, fetchData
  } = useAnalysisEndpoint(reportInsightsEndpoint);
  // The scope object is rebuilt by callers on every render; key the request on
  // its encoded form so a same-value scope does not refetch.
  const scopeKey = encodeReportScope(scope);
  const marketId = useSelectedMarketId();

  const refetch = useCallback(
    () => fetchData(decodeReportScope(scopeKey), marketId, days),
    [fetchData, scopeKey, marketId, days],
  );

  useEffect(() => {
    refetch();
  }, [refetch]);

  return {
    data,
    loading,
    error,
    refetch,
  };
}
