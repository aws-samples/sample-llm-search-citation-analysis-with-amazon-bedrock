import type {
  ReportScope, VisibilityResponse
} from '../types';
import { isRecord } from '../types/domain/keywordDecoders';
import { reportScopeParams } from '../components/ui/reportScope';
import {
  brandFilterParams, fetchErrors, isAnalysisPayload, useAnalysisEndpoint
} from './useAnalysisEndpoint';
import { useMarketScopedFetch } from './useMarketScopedFetch';

/**
 * Which answers a visibility view measures: those to queries that do not name
 * the brand (`neutral`), those that do (`branded`), or every answer (`all`).
 */
export type BrandedFilter = 'neutral' | 'branded' | 'all';

/** The one `/visibility` shape of every scope: its scope, pooled KPIs, brand leaderboard and keyword rows. */
function isVisibilityResponse(value: unknown): value is VisibilityResponse {
  return isAnalysisPayload(value)
    && isRecord(value.scope)
    && isRecord(value.kpis)
    && Array.isArray(value.brands)
    && typeof value.brands_total === 'number'
    && Array.isArray(value.keywords);
}

const visibilityMetricsEndpoint = {
  errorContext: 'visibility',
  logMessage: '[visibility] Error fetching metrics:',
  isValidResponse: isVisibilityResponse,
  ...fetchErrors('VisibilityFetchError', 'Failed to fetch visibility metrics'),
  buildRequest: (marketId: string | null, scope: ReportScope, queryPromptId?: string, brand?: string, branded?: BrandedFilter) => {
    const params = brandFilterParams(reportScopeParams(scope, marketId), brand, queryPromptId);
    // `all` is the API default: leaving it out keeps the request of every existing view unchanged.
    if (branded && branded !== 'all') params.append('branded', branded);
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
    data, loading, error, fetchData
  } = useAnalysisEndpoint(visibilityMetricsEndpoint);
  const fetchVisibilityMetrics = useMarketScopedFetch(fetchData);

  return {
    data,
    loading,
    error,
    fetchVisibilityMetrics
  };
}
