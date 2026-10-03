import type { SelfReflectionResponse } from '../types';
import {
  fetchErrors, isAnalysisPayload, useAnalysisEndpoint
} from './useAnalysisEndpoint';

function isSelfReflectionResponse(data: unknown): data is SelfReflectionResponse {
  if (!isAnalysisPayload(data)) return false;
  return 'keyword' in data && 'brand' in data && 'explanation' in data;
}

const SELF_REFLECTION_ERRORS = fetchErrors('SelfReflectionFetchError', 'Failed to fetch self-reflection data');

const reflectionTriggerEndpoint = {
  errorContext: 'self-reflection',
  logMessage: '[self-reflection] Error triggering reflection:',
  isValidResponse: isSelfReflectionResponse,
  ...SELF_REFLECTION_ERRORS,
  buildRequest: (keyword: string, brand: string, queryPromptId: string, forceRefresh = false) => ({
    path: '/self-reflection',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyword,
        brand,
        query_prompt_id: queryPromptId,
        force_refresh: forceRefresh,
      }),
    },
  }),
};

export function useSelfReflection() {
  const {
    data, loading, error, fetchData: triggerReflection,
  } = useAnalysisEndpoint(reflectionTriggerEndpoint);

  return {
    data,
    loading,
    error,
    triggerReflection,
  };
}
