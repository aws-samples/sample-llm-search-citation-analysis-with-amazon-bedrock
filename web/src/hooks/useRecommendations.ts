import {
  useState, useCallback,
} from 'react';
import {
  API_BASE_URL, getErrorMessage,
} from '../infrastructure';
import { saveRecommendationStatus } from '../api/recommendations';
import { fetchUntilReady } from '../api/viewJobs';
import type { ListRequest } from '../api/scopedListPages';
import type { ComputingResponse } from '../types/domain/scopeCoverage';
import { hasScopedResponseFields } from '../types/domain/scopeCoverageDecoders';
import {
  ALL_SCOPE, decodeReportScope, encodeReportScope, reportScopeParams
} from '../components/ui/reportScope';
import { useSelectedMarketId } from '../components/Markets/marketSelectionContext';
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
    && hasScopedResponseFields({ ...data })
  );
}

/** One GET of the recommendations, repeated while a view job computes it (`awaitViewJob`). */
async function readRecommendations(
  url: string,
  onComputing: (computing: ComputingResponse) => void,
): Promise<RecommendationsResponse> {
  const json = await fetchUntilReady(url, {}, () => new RecommendationsFetchError(), { onComputing });
  if (!isRecommendationsResponse(json)) {
    throw new RecommendationsFetchError('Invalid response format');
  }
  return json;
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
  const [computing, setComputing] = useState<ComputingResponse | null>(null);
  /** Statuses saved since the list loaded, by id: they apply to rows of later pages too. */
  const [savedStatuses, setSavedStatuses] = useState<Readonly<Record<string, RecommendationStatus>>>({});
  const [request, setRequest] = useState<ListRequest | null>(null);
  // Keyed on the encoded scope so a caller rebuilding the object each render keeps the same fetch.
  const scopeKey = encodeReportScope(scope);
  const marketId = useSelectedMarketId();

  const fetchRecommendations = useCallback(async (useLlm = false) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        ...reportScopeParams(decodeReportScope(scopeKey), marketId),
        use_llm: useLlm.toString(),
      });
      const json = await readRecommendations(`${API_BASE_URL}/recommendations?${params}`, setComputing);
      setData(json);
      setRequest({
        path: '/recommendations',
        params,
      });
      return json;
    } catch (err) {
      const message = getErrorMessage(err, 'visibility');
      setError(message);
      console.error('[recommendations] Error fetching recommendations:', err);
      return null;
    } finally {
      setLoading(false);
      setComputing(null);
    }
  }, [scopeKey, marketId]);

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
      setSavedStatuses((current) => ({
        ...current,
        [id]: saved,
      }));
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
    /** The view job of a `202` answer the fetch waits for; `null` otherwise. */
    computing,
    /** The request `data` answered: the list loads its next pages with it (2.45.0). */
    request,
    savedStatuses,
    fetchRecommendations,
    updateStatus,
    updatingIds,
    statusError,
  };
}
