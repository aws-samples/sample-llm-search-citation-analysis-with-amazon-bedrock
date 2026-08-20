import { ApiRequestError } from '../infrastructure';
import type { CitationGapsResponse } from '../types';
import { useAnalysisEndpoint } from './useAnalysisEndpoint';

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

const citationGapsEndpoint = {
  errorContext: 'visibility',
  logMessage: '[citationGaps] Error fetching citation gaps:',
  isValidResponse: isCitationGapsResponse,
  createHttpError: (status: number) => new ApiRequestError('Failed to fetch citation gaps', status),
  createResponseError: (message: string) => new ApiRequestError(message),
  buildRequest: (keyword?: string, limit = 10) => {
    const params = new URLSearchParams({ limit: limit.toString() });
    if (keyword) params.append('keyword', keyword);
    return {
      path: '/citation-gaps',
      params,
    };
  },
};

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
  const {
    data, loading, error, fetchData: fetchCitationGaps 
  } = useAnalysisEndpoint(citationGapsEndpoint);

  return {
    data,
    loading,
    error,
    fetchCitationGaps 
  };
}
