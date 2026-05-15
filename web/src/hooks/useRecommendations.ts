import {
  useState, useCallback,
} from 'react';
import {
  API_BASE_URL, authenticatedFetch, getErrorMessage,
} from '../infrastructure';
import type {
  Recommendation,
  RecommendationsResponse,
  RecommendationStatus,
} from '../types';

class RecommendationsFetchError extends Error {
  constructor(message = 'Failed to fetch recommendations') {
    super(message);
    this.name = 'RecommendationsFetchError';
  }
}

class RecommendationStatusError extends Error {
  constructor(message = 'Failed to update recommendation status') {
    super(message);
    this.name = 'RecommendationStatusError';
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

interface UpdateStatusInput {
  readonly status: RecommendationStatus;
  readonly notes?: string;
  readonly relatedKeyword?: string;
  readonly relatedContentId?: string;
}

interface RecommendationStatusRow {
  readonly recommendation_id: string;
  readonly status: RecommendationStatus;
  readonly updated_at: string;
  readonly completed_at?: string;
  readonly notes?: string;
  readonly related_keyword?: string;
  readonly related_content_id?: string;
}

export function useRecommendations() {
  const [data, setData] = useState<RecommendationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchRecommendations = useCallback(async (useLlm = false) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ use_llm: useLlm.toString() });
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
  }, []);

  /**
   * Persist a status update for a single recommendation. Optimistically
   * mirrors the new status into local state so the UI doesn't have to
   * re-fetch the full list to show the change. If the server call
   * fails the optimistic update is rolled back.
   */
  const updateRecommendationStatus = useCallback(async (
    id: string,
    input: UpdateStatusInput,
  ): Promise<RecommendationStatusRow | null> => {
    if (!id) return null;

    const previousStatusRef: { current: RecommendationStatus | undefined } = {current: undefined,};
    setData((current) => {
      if (current === null) return current;
      const updated = current.recommendations.map((rec) => {
        if (rec.id !== id) return rec;
        previousStatusRef.current = rec.status;
        return {
          ...rec,
          status: input.status,
          notes: input.notes ?? rec.notes,
        };
      });
      return {
        ...current,
        recommendations: updated,
      };
    });

    try {
      const body = {
        status: input.status,
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        ...(input.relatedKeyword === undefined
          ? {}
          : { related_keyword: input.relatedKeyword }),
        ...(input.relatedContentId === undefined
          ? {}
          : { related_content_id: input.relatedContentId }),
      };
      const response = await authenticatedFetch(
        `${API_BASE_URL}/recommendations/${encodeURIComponent(id)}/status`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) throw new RecommendationStatusError();
      const row = (await response.json()) as RecommendationStatusRow;
      return row;
    } catch (err) {
      // Roll back the optimistic update so the UI doesn't lie to the
      // user about the persisted state. Read the captured previous
      // status from the ref *inside* the setData callback so the read
      // happens after React has flushed the optimistic update.
      setData((current) => {
        const rollback = previousStatusRef.current;
        if (current === null || rollback === undefined) return current;
        const reverted = current.recommendations.map((rec): Recommendation => (
          rec.id === id ? {
            ...rec,
            status: rollback,
          } : rec
        ));
        return {
          ...current,
          recommendations: reverted,
        };
      });
      const message = getErrorMessage(err, 'visibility');
      setError(message);
      console.error('[recommendations] Error updating status:', err);
      return null;
    }
  }, []);

  return {
    data,
    loading,
    error,
    fetchRecommendations,
    updateRecommendationStatus,
  };
}
