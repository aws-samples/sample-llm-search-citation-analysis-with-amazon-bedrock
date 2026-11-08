import { useCallback } from 'react';
import type { CompetitorReportResponse } from '../api/reports';
import type { ReportScope } from '../types';
import {
  ALL_SCOPE, reportScopeParams
} from '../components/ui/reportScope';
import { useSelectedMarketId } from '../components/Markets/marketSelectionContext';
import {
  apiRequestErrors, isAnalysisPayload, useAnalysisEndpoint 
} from './useAnalysisEndpoint';

function isCompetitorReportResponse(
  data: unknown,
): data is CompetitorReportResponse {
  if (!isAnalysisPayload(data)) return false;
  return 'rollup' in data;
}

const competitorRollupEndpoint = {
  errorContext: 'visibility',
  logMessage: '[competitorRollup] Error:',
  isValidResponse: isCompetitorReportResponse,
  ...apiRequestErrors('Failed to fetch competitor rollup'),
  // 2.45.0: the rollup honours the scope, and `limit` is the page size of `outranked_keywords`.
  buildRequest: (marketId: string | null, competitor: string, scope: ReportScope, limit: number) => {
    const params = new URLSearchParams({
      ...reportScopeParams(scope, marketId),
      competitor,
      limit: limit.toString(),
    });
    return {
      path: '/reports/competitor',
      params,
    };
  },
};

/**
 * Imperative hook for the competitor rollup endpoint. Pairs with the
 * Competitor Gap report (a follow-up PR) and any ad-hoc lookups in
 * the dashboard.
 *
 * Imperative rather than auto-fetching so the caller (the report
 * component) can trigger a fresh load when the selected competitor
 * changes without re-mounting.
 */
export function useCompetitorRollup() {
  const {
    data, loading, error, computing, request, fetchData
  } = useAnalysisEndpoint(competitorRollupEndpoint);
  const marketId = useSelectedMarketId();
  /** The rollup of `competitor` over `scope` (every keyword by default), `limit` outranked keywords a page. */
  const fetchCompetitorRollup = useCallback(
    (competitor: string, scope: ReportScope = ALL_SCOPE, limit = 100) => fetchData(marketId, competitor, scope, limit),
    [fetchData, marketId],
  );

  return {
    computing,
    request,
    data,
    loading,
    error,
    fetchCompetitorRollup,
  };
}
