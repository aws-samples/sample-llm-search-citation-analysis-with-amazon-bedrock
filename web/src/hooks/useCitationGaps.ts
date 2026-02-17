import {
  useState, useCallback 
} from 'react';
import {
  API_BASE_URL,
  authenticatedFetch,
  getErrorMessage,
  ApiRequestError,
} from '../infrastructure';
import type { CitationGapsResponse } from '../types';

interface BackendErrorResponse {error: string;}

function isBackendErrorResponse(data: unknown): data is BackendErrorResponse {
  return typeof data === 'object' && data !== null && 'error' in data && typeof (data as BackendErrorResponse).error === 'string';
}

function isCitationGapsResponse(data: unknown): data is CitationGapsResponse {
  if (typeof data !== 'object' || data === null) return false;
  
  // Check for error response from backend
  if ('error' in data) return false;
  
  // Single keyword response has gaps and summary
  const hasSingleKeywordFields = 'gaps' in data && 'summary' in data;
  
  // All keywords response has top_gaps and keyword_summaries
  const hasAllKeywordsFields = 'top_gaps' in data && 'keyword_summaries' in data;
  
  return hasSingleKeywordFields || hasAllKeywordsFields;
}

/**
 * Hook for fetching citation gap analysis.
 * Identifies sources citing competitors but not first-party brands.
 * 
 * @returns Object containing:
 * - `data` - Citation gaps response data
 * - `loading` - Whether data is being fetched
 * - `error` - Error message if fetch failed
 * - `fetchCitationGaps` - Function to trigger fetch with optional keyword filter
 * 
 * @example
 * ```tsx
 * const { data, loading, fetchCitationGaps } = useCitationGaps();
 * 
 * useEffect(() => {
 *   fetchCitationGaps('best hotels', 20);
 * }, []);
 * 
 * // data.gaps contains sources to target for outreach
 * ```
 */
export function useCitationGaps() {
  const [data, setData] = useState<CitationGapsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCitationGaps = useCallback(async (keyword?: string, limit = 10): Promise<CitationGapsResponse | null> => {
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams({ limit: limit.toString() });
      if (keyword) params.append('keyword', keyword);
      
      const response = await authenticatedFetch(`${API_BASE_URL}/citation-gaps?${params}`);
      if (!response.ok) throw new ApiRequestError('Failed to fetch citation gaps', response.status);
      
      const json: unknown = await response.json();
      if (isBackendErrorResponse(json)) {
        throw new ApiRequestError(json.error);
      }
      if (!isCitationGapsResponse(json)) {
        throw new ApiRequestError('Invalid response format');
      }
      setData(json);
      return json;
    } catch (err) {
      const message = getErrorMessage(err, 'visibility');
      setError(message);
      console.error('[citationGaps] Error fetching citation gaps:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    data,
    loading,
    error,
    fetchCitationGaps 
  };
}
