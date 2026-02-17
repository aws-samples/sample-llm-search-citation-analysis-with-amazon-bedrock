import {
  useState, useCallback 
} from 'react';
import {
  API_BASE_URL, authenticatedFetch, getErrorMessage 
} from '../infrastructure';
import type { VisibilityMetricsResponse } from '../types';

class VisibilityFetchError extends Error {
  constructor(message = 'Failed to fetch visibility metrics') {
    super(message);
    this.name = 'VisibilityFetchError';
  }
}

interface BackendErrorResponse {error: string;}

function isBackendErrorResponse(data: unknown): data is BackendErrorResponse {
  return typeof data === 'object' && data !== null && 'error' in data && typeof (data as BackendErrorResponse).error === 'string';
}

function isVisibilityMetricsResponse(data: unknown): data is VisibilityMetricsResponse {
  if (typeof data !== 'object' || data === null) return false;
  
  // Check for error response from backend
  if ('error' in data) return false;
  
  return 'keyword' in data && 'brands' in data;
}

export function useVisibilityMetrics() {
  const [data, setData] = useState<VisibilityMetricsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVisibilityMetrics = useCallback(async (keyword: string, brand?: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams({ keyword });
      if (brand) params.append('brand', brand);
      
      const response = await authenticatedFetch(`${API_BASE_URL}/visibility?${params}`);
      if (!response.ok) throw new VisibilityFetchError();
      
      const json: unknown = await response.json();
      if (isBackendErrorResponse(json)) {
        throw new VisibilityFetchError(json.error);
      }
      if (!isVisibilityMetricsResponse(json)) {
        throw new VisibilityFetchError('Invalid response format');
      }
      setData(json);
      return json;
    } catch (err) {
      const message = getErrorMessage(err, 'visibility');
      setError(message);
      console.error('[visibility] Error fetching metrics:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    data,
    loading,
    error,
    fetchVisibilityMetrics 
  };
}
