import {
  useState, useCallback 
} from 'react';
import {
  API_BASE_URL, authenticatedFetch, getErrorMessage 
} from '../infrastructure';
import type { RecommendationsResponse } from '../types';

class RecommendationsFetchError extends Error {
  constructor(message = 'Failed to fetch recommendations') {
    super(message);
    this.name = 'RecommendationsFetchError';
  }
}

function isRecommendationsResponse(data: unknown): data is RecommendationsResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'recommendations' in data &&
    'total_count' in data
  );
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
      const response = await authenticatedFetch(`${API_BASE_URL}/recommendations?${params}`);
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

  return {
    data,
    loading,
    error,
    fetchRecommendations 
  };
}
