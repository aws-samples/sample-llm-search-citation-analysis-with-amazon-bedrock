import type { PromptInsightsResponse } from '../types';
import { useAnalysisEndpoint } from './useAnalysisEndpoint';

class PromptInsightsFetchError extends Error {
  constructor(message = 'Failed to fetch prompt insights') {
    super(message);
    this.name = 'PromptInsightsFetchError';
  }
}

function isPromptInsightsResponse(data: unknown): data is PromptInsightsResponse {
  return typeof data === 'object' && data !== null && 'total_prompts_analyzed' in data;
}

const promptInsightsEndpoint = {
  errorContext: 'visibility',
  logMessage: '[promptInsights] Error fetching prompt insights:',
  isValidResponse: isPromptInsightsResponse,
  createHttpError: () => new PromptInsightsFetchError(),
  createResponseError: (message: string) => new PromptInsightsFetchError(message),
  // This endpoint never checked for `{error}` bodies; its type guard
  // rejects them as an invalid format instead. Kept as-is to preserve
  // the hook's observable error messages.
  rejectBackendErrorBody: false,
  buildRequest: (
    type: 'all' | 'winning' | 'losing' | 'opportunities' = 'all',
    limit = 20
  ) => {
    const params = new URLSearchParams({
      type,
      limit: limit.toString(),
    });
    return {
      path: '/prompt-insights',
      params,
    };
  },
};

export function usePromptInsights() {
  const {
    data, loading, error, fetchData: fetchPromptInsights,
  } = useAnalysisEndpoint(promptInsightsEndpoint);

  return {
    data,
    loading,
    error,
    fetchPromptInsights,
  };
}
