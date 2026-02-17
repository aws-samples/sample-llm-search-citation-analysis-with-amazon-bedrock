import {
  useState, useCallback 
} from 'react';
import {
  API_BASE_URL,
  authenticatedFetch,
  getErrorMessage,
  ApiRequestError,
} from '../infrastructure';
import type { HistoricalTrendsResponse } from '../types';

interface BackendErrorResponse {error: string;}

function isBackendErrorResponse(data: unknown): data is BackendErrorResponse {
  return typeof data === 'object' && data !== null && 'error' in data && typeof (data as BackendErrorResponse).error === 'string';
}

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
  const [data, setData] = useState<HistoricalTrendsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistoricalTrends = useCallback(async (
    keyword?: string,
    period: 'day' | 'week' | 'month' = 'day',
    days = 30
  ): Promise<HistoricalTrendsResponse | null> => {
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams({
        period,
        days: days.toString() 
      });
      if (keyword) params.append('keyword', keyword);
      
      const response = await authenticatedFetch(`${API_BASE_URL}/trends?${params}`);
      if (!response.ok) throw new ApiRequestError('Failed to fetch historical trends', response.status);
      
      const json: unknown = await response.json();
      if (isBackendErrorResponse(json)) {
        throw new ApiRequestError(json.error);
      }
      if (!isHistoricalTrendsResponse(json)) {
        throw new ApiRequestError('Invalid response format');
      }
      setData(json);
      return json;
    } catch (err) {
      const message = getErrorMessage(err, 'visibility');
      setError(message);
      console.error('[historicalTrends] Error fetching trends:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    data,
    loading,
    error,
    fetchHistoricalTrends 
  };
}
