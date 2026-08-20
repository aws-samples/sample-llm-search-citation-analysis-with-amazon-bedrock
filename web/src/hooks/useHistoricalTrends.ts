import { ApiRequestError } from '../infrastructure';
import type { HistoricalTrendsResponse } from '../types';
import { useAnalysisEndpoint } from './useAnalysisEndpoint';

function isHistoricalTrendsResponse(data: unknown): data is HistoricalTrendsResponse {
  if (typeof data !== 'object' || data === null) return false;
  
  // Check for error response from backend
  if ('error' in data) return false;
  
  // Single keyword response has trend_data and trend_direction
  const hasSingleKeywordFields = 'trend_data' in data && 'trend_direction' in data;
  
  // All keywords response has keyword_trends and overall
  const hasAllKeywordsFields = 'keyword_trends' in data && 'overall' in data;
  
  return hasSingleKeywordFields || hasAllKeywordsFields;
}

const historicalTrendsEndpoint = {
  errorContext: 'visibility',
  logMessage: '[historicalTrends] Error fetching trends:',
  isValidResponse: isHistoricalTrendsResponse,
  createHttpError: (status: number) => new ApiRequestError('Failed to fetch historical trends', status),
  createResponseError: (message: string) => new ApiRequestError(message),
  buildRequest: (
    keyword?: string,
    period: 'day' | 'week' | 'month' = 'day',
    days = 30
  ) => {
    const params = new URLSearchParams({
      period,
      days: days.toString() 
    });
    if (keyword) params.append('keyword', keyword);
    return {
      path: '/trends',
      params,
    };
  },
};

/**
 * Hook for fetching historical visibility trends.
 * Provides time-series data for tracking visibility changes over time.
 * 
 * @returns Object containing:
 * - `data` - Historical trends response with time-series data
 * - `loading` - Whether data is being fetched
 * - `error` - Error message if fetch failed
 * - `fetchHistoricalTrends` - Function to fetch trends with parameters
 * 
 * @example
 * ```tsx
 * const { data, fetchHistoricalTrends } = useHistoricalTrends();
 * 
 * useEffect(() => {
 *   // Fetch 30 days of daily data for a keyword
 *   fetchHistoricalTrends('best hotels', 'day', 30);
 * }, []);
 * 
 * // data.trend_data contains the time-series points
 * // data.trend_direction indicates 'improving', 'declining', or 'stable'
 * ```
 */
export function useHistoricalTrends() {
  const {
    data, loading, error, fetchData: fetchHistoricalTrends 
  } = useAnalysisEndpoint(historicalTrendsEndpoint);

  return {
    data,
    loading,
    error,
    fetchHistoricalTrends 
  };
}
