import type { VisibilityMetricsResponse } from '../types';
import { useAnalysisEndpoint } from './useAnalysisEndpoint';

class VisibilityFetchError extends Error {
  constructor(message = 'Failed to fetch visibility metrics') {
    super(message);
    this.name = 'VisibilityFetchError';
  }
}

function isVisibilityMetricsResponse(data: unknown): data is VisibilityMetricsResponse {
  if (typeof data !== 'object' || data === null) return false;
  
  // Check for error response from backend
  if ('error' in data) return false;
  
  return 'keyword' in data && 'brands' in data;
}

const visibilityMetricsEndpoint = {
  errorContext: 'visibility',
  logMessage: '[visibility] Error fetching metrics:',
  isValidResponse: isVisibilityMetricsResponse,
  createHttpError: () => new VisibilityFetchError(),
  createResponseError: (message: string) => new VisibilityFetchError(message),
  buildRequest: (keyword: string, brand?: string, queryPromptId?: string) => {
    const params = new URLSearchParams({ keyword });
    if (brand) params.append('brand', brand);
    if (queryPromptId) params.append('query_prompt_id', queryPromptId);
    return {
      path: '/visibility',
      params,
    };
  },
};

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
