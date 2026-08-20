import { useCallback } from 'react';
import type {
  SelfReflectionResponse, SelfReflectionResult 
} from '../types';
import { useAnalysisEndpoint } from './useAnalysisEndpoint';

class SelfReflectionFetchError extends Error {
  constructor(message = 'Failed to fetch self-reflection data') {
    super(message);
    this.name = 'SelfReflectionFetchError';
  }
}

function isSelfReflectionResponse(data: unknown): data is SelfReflectionResponse {
  if (typeof data !== 'object' || data === null) return false;
  if ('error' in data) return false;
  return 'keyword' in data && 'brand' in data && 'explanation' in data;
}

interface SelfReflectionListResponse {
  keyword: string;
  results: SelfReflectionResult[];
  count: number;
}

function isSelfReflectionListResponse(data: unknown): data is SelfReflectionListResponse {
  return typeof data === 'object' && data !== null && 'results' in data && Array.isArray((data as SelfReflectionListResponse).results);
}

const reflectionTriggerEndpoint = {
  errorContext: 'self-reflection',
  logMessage: '[self-reflection] Error triggering reflection:',
  isValidResponse: isSelfReflectionResponse,
  createHttpError: () => new SelfReflectionFetchError(),
  createResponseError: (message: string) => new SelfReflectionFetchError(message),
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

const reflectionListContract = {
  logMessage: '[self-reflection] Error fetching reflections:',
  isValidResponse: isSelfReflectionListResponse,
  createHttpError: () => new SelfReflectionFetchError(),
  createResponseError: (message: string) => new SelfReflectionFetchError(message),
};

export function useSelfReflection() {
  const {
    data, loading, error, fetchData: triggerReflection, runRequest,
  } = useAnalysisEndpoint(reflectionTriggerEndpoint);

  const fetchReflections = useCallback(async (keyword: string, brand?: string, queryPromptId?: string): Promise<SelfReflectionResult[]> => {
    const params = new URLSearchParams({ keyword });
    if (brand) params.append('brand', brand);
    if (queryPromptId) params.append('query_prompt_id', queryPromptId);

    const json = await runRequest({
      path: '/self-reflection',
      params,
    }, reflectionListContract);
    return json ? json.results : [];
  }, [runRequest]);

  return {
    data,
    loading,
    error,
    triggerReflection,
    fetchReflections 
  };
}
