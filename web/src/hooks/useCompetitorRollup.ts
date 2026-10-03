import type { CompetitorReportResponse } from '../api/reports';
import {
  apiRequestErrors, isAnalysisPayload, useAnalysisEndpoint 
} from './useAnalysisEndpoint';

function isCompetitorReportResponse(
  data: unknown,
): data is CompetitorReportResponse {
  if (!isAnalysisPayload(data)) return false;
  // Single-competitor variant has `rollup`; all-competitors has `rollups`.
  return 'rollup' in data || 'rollups' in data;
}

const competitorRollupEndpoint = {
  errorContext: 'visibility',
  logMessage: '[competitorRollup] Error:',
  isValidResponse: isCompetitorReportResponse,
  ...apiRequestErrors('Failed to fetch competitor rollup'),
  buildRequest: (competitor?: string, keywordLimit = 50) => {
    const params = new URLSearchParams({ keyword_limit: keywordLimit.toString() });
    if (competitor) params.append('competitor', competitor);
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
    data, loading, error, fetchData: fetchCompetitorRollup,
  } = useAnalysisEndpoint(competitorRollupEndpoint);

  return {
    data,
    loading,
    error,
    fetchCompetitorRollup,
  };
}
