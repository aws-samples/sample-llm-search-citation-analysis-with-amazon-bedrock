import {
  useState, useCallback,
} from 'react';
import {
  API_BASE_URL, authenticatedFetch, getErrorMessage,
} from '../infrastructure';
import { saveRecommendationStatus } from '../api/recommendations';
import {
  ALL_SCOPE, decodeReportScope, encodeReportScope, reportScopeParams
} from '../components/ui/reportScope';
import type {
  Recommendation, RecommendationStatus, RecommendationsResponse, ReportScope
} from '../types';

class RecommendationsFetchError extends Error {
  constructor(message = 'Failed to fetch recommendations') {
    super(message);
    this.name = 'RecommendationsFetchError';
  }
}

function isRecommendationsResponse(data: unknown): data is RecommendationsResponse {
  return (
    typeof data === 'object'
    && data !== null
    && 'recommendations' in data
    && 'total_count' in data
  );
}

function withStatus(
  response: RecommendationsResponse,
  id: string,
  status: RecommendationStatus
): RecommendationsResponse {
  return {
    ...response,
    recommendations: response.recommendations.map((rec) => (rec.id === id ? {
      ...rec,
      status 
    } : rec)),
  };
}

/**
 * Recommendations for a report scope (one keyword, a keyword group or, by
 * default, every keyword), optionally LLM-enhanced, plus the status tracking
 * of each recommendation the API identifies. `fetchRecommendations` is
 * rebuilt when the scope changes, so an effect listing it refetches per scope.
 */
export function useRecommendations(scope: ReportScope = ALL_SCOPE) {
  const [data, setData] = useState<RecommendationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatingIds, setUpdatingIds] = useState<readonly string[]>([]);
  const [statusError, setStatusError] = useState<string | null>(null);
  // Keyed on the encoded scope so a caller rebuilding the object each render keeps the same fetch.
  const scopeKey = encodeReportScope(scope);

  const fetchRecommendations = useCallback(async (useLlm = false) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        ...reportScopeParams(decodeReportScope(scopeKey)),
        use_llm: useLlm.toString(),
      });
      const response = await authenticatedFetch(
        `${API_BASE_URL}/recommendations?${params}`,
      );
      if (!response.ok) throw new RecommendationsFetchError();

      const json: unknown = await response.json();
      if (!isRecommendationsResponse(json)) {
        throw new RecommendationsFetchError('Invalid response format');
      }
      setData(json);
      return json;
    } catch (err) {
      const message = getErrorMessage(err, 'visibility');
      setError(message);
      console.error('[recommendations] Error fetching recommendations:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [scopeKey]);

  /** Saves `status` for `recommendation`; the list shows it once the API has stored it. */
  const updateStatus = useCallback(async (
    recommendation: Recommendation & { id: string },
    status: RecommendationStatus
  ): Promise<boolean> => {
    const { id } = recommendation;
    setStatusError(null);
    setUpdatingIds((current) => [...current, id]);
    try {
      const saved = await saveRecommendationStatus(recommendation, status);
      setData((current) => (current === null ? current : withStatus(current, id, saved)));
      return true;
    } catch (err) {
      setStatusError(getErrorMessage(err));
      console.error('[recommendations] Error updating status:', err);
      return false;
    } finally {
      setUpdatingIds((current) => current.filter((updatingId) => updatingId !== id));
    }
  }, []);

  return {
    data,
    loading,
    error,
    fetchRecommendations,
    updateStatus,
    updatingIds,
    statusError,
  };
}
