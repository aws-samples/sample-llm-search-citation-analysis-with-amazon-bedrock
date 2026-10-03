import type {
  ReportScope, VisibilityResponse
} from '../types';
import { isRecord } from '../types/domain/keywordDecoders';
import { reportScopeParams } from '../components/ui/reportScope';
import {
  fetchErrors, isAnalysisPayload, useAnalysisEndpoint 
} from './useAnalysisEndpoint';

class VisibilityFetchError extends Error {
  constructor(message = 'Failed to fetch visibility metrics') {
    super(message);
    this.name = 'VisibilityFetchError';
  }
}

/** The one `/visibility` shape of every scope: its scope, pooled KPIs, brand leaderboard and keyword rows. */
function isVisibilityResponse(value: unknown): value is VisibilityResponse {
  return isAnalysisPayload(value)
    && isRecord(value.scope)
    && isRecord(value.kpis)
    && Array.isArray(value.brands)
    && Array.isArray(value.keywords);
}

const visibilityMetricsEndpoint = {
  errorContext: 'visibility',
  logMessage: '[visibility] Error fetching metrics:',
  isValidResponse: isVisibilityResponse,
  ...fetchErrors(VisibilityFetchError),
  buildRequest: (scope: ReportScope, queryPromptId?: string, brand?: string) => {
    const params = new URLSearchParams(reportScopeParams(scope));
    if (brand) params.append('brand', brand);
    if (queryPromptId) params.append('query_prompt_id', queryPromptId);
    return {
      path: '/visibility',
      params,
    };
  },
};

/**
 * Visibility of a report scope (one keyword, a keyword group or every
 * keyword): every KPI over each keyword's latest run, the brand leaderboard
 * and one row per keyword — the same shape for every scope.
 */
export function useVisibilityMetrics() {
  const {
    data, loading, error, fetchData: fetchVisibilityMetrics
  } = useAnalysisEndpoint(visibilityMetricsEndpoint);

  return {
    data,
    loading,
    error,
    fetchVisibilityMetrics
  };
}
