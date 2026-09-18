import type {
  ReportScope, VisibilityResponse
} from '../types';
import { reportScopeParams } from '../components/ui/reportScope';
import { useAnalysisEndpoint } from './useAnalysisEndpoint';

class VisibilityFetchError extends Error {
  constructor(message = 'Failed to fetch visibility metrics') {
    super(message);
    this.name = 'VisibilityFetchError';
  }
}

function isVisibilityResponse(data: unknown): data is VisibilityResponse {
  if (typeof data !== 'object' || data === null) return false;

  // Check for error response from backend
  if ('error' in data) return false;

  // Single keyword answers carry `keyword`; group / all answers carry `scope`
  // plus the per-keyword rows. Both carry the brand ranking.
  return 'brands' in data && ('keyword' in data || ('scope' in data && 'keywords' in data));
}

const visibilityMetricsEndpoint = {
  errorContext: 'visibility',
  logMessage: '[visibility] Error fetching metrics:',
  isValidResponse: isVisibilityResponse,
  createHttpError: () => new VisibilityFetchError(),
  createResponseError: (message: string) => new VisibilityFetchError(message),
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
 * Visibility metrics for a report scope: one keyword (the classic payload) or
 * a keyword group / every keyword (a group summary with per-keyword rows).
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
