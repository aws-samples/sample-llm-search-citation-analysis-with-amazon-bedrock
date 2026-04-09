import {
  useState, useCallback 
} from 'react';
import {
  API_BASE_URL, authenticatedFetch, getErrorMessage 
} from '../infrastructure';
import type { SelfReflectionResponse, SelfReflectionResult } from '../types';

class SelfReflectionFetchError extends Error {
  constructor(message = 'Failed to fetch self-reflection data') {
    super(message);
    this.name = 'SelfReflectionFetchError';
  }
}

interface BackendErrorResponse {error: string;}

function isBackendErrorResponse(data: unknown): data is BackendErrorResponse {
  return typeof data === 'object' && data !== null && 'error' in data && typeof (data as BackendErrorResponse).error === 'string';
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

export function useSelfReflection() {
  const [data, setData] = useState<SelfReflectionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const triggerReflection = useCallback(async (keyword: string, brand: string, queryPromptId: string, forceRefresh = false) => {
    setLoading(true);
    setError(null);

    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/self-reflection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword,
          brand,
          query_prompt_id: queryPromptId,
          force_refresh: forceRefresh,
        }),
      });
      if (!response.ok) throw new SelfReflectionFetchError();

      const json: unknown = await response.json();
      if (isBackendErrorResponse(json)) {
        throw new SelfReflectionFetchError(json.error);
      }
      if (!isSelfReflectionResponse(json)) {
        throw new SelfReflectionFetchError('Invalid response format');
      }
      setData(json);
      return json;
    } catch (err) {
      const message = getErrorMessage(err, 'self-reflection');
      setError(message);
      console.error('[self-reflection] Error triggering reflection:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchReflections = useCallback(async (keyword: string, brand?: string, queryPromptId?: string) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ keyword });
      if (brand) params.append('brand', brand);
      if (queryPromptId) params.append('query_prompt_id', queryPromptId);

      const response = await authenticatedFetch(`${API_BASE_URL}/self-reflection?${params}`);
      if (!response.ok) throw new SelfReflectionFetchError();

      const json: unknown = await response.json();
      if (isBackendErrorResponse(json)) {
        throw new SelfReflectionFetchError(json.error);
      }
      if (!isSelfReflectionListResponse(json)) {
        throw new SelfReflectionFetchError('Invalid response format');
      }
      return json.results;
    } catch (err) {
      const message = getErrorMessage(err, 'self-reflection');
      setError(message);
      console.error('[self-reflection] Error fetching reflections:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    data,
    loading,
    error,
    triggerReflection,
    fetchReflections 
  };
}
