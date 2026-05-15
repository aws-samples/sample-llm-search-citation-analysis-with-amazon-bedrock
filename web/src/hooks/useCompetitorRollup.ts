import {
  useState, useCallback,
} from 'react';
import {
  API_BASE_URL,
  authenticatedFetch,
  getErrorMessage,
  ApiRequestError,
} from '../infrastructure';
import type { CompetitorReportResponse } from '../api/reports';

interface BackendErrorResponse {error: string;}

function isBackendErrorResponse(data: unknown): data is BackendErrorResponse {
  return typeof data === 'object'
    && data !== null
    && 'error' in data
    && typeof (data as BackendErrorResponse).error === 'string';
}

function isCompetitorReportResponse(
  data: unknown,
): data is CompetitorReportResponse {
  if (typeof data !== 'object' || data === null) return false;
  if ('error' in data) return false;
  // Single-competitor variant has `rollup`; all-competitors has `rollups`.
  return 'rollup' in data || 'rollups' in data;
}

/**
 * Imperative hook for the competitor rollup endpoint. Pairs with the
 * Competitor Gap report (a follow-up PR) and any ad-hoc lookups in
 * the dashboard.
 *
 * Imperative rather than auto-fetching so the caller (the report
 * component) can trigger a fresh load when the selected competitor
 * changes without re-mounting.
 */
export function useCompetitorRollup() {
  const [data, setData] = useState<CompetitorReportResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchCompetitorRollup = useCallback(async (
    competitor?: string,
    keywordLimit = 50,
  ): Promise<CompetitorReportResponse | null> => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ keyword_limit: keywordLimit.toString() });
      if (competitor) params.append('competitor', competitor);
      const response = await authenticatedFetch(
        `${API_BASE_URL}/reports/competitor?${params}`,
      );
      if (!response.ok) {
        throw new ApiRequestError(
          'Failed to fetch competitor rollup',
          response.status,
        );
      }
      const json: unknown = await response.json();
      if (isBackendErrorResponse(json)) {
        throw new ApiRequestError(json.error);
      }
      if (!isCompetitorReportResponse(json)) {
        throw new ApiRequestError('Invalid response format');
      }
      setData(json);
      return json;
    } catch (err) {
      const message = getErrorMessage(err, 'visibility');
      setError(message);
      console.error('[competitorRollup] Error:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    data,
    loading,
    error,
    fetchCompetitorRollup,
  };
}
