import {
  useState, useCallback 
} from 'react';
import {
  API_BASE_URL, authenticatedFetch, getErrorMessage 
} from '../infrastructure';
import type { PromptInsightsResponse } from '../types';

class PromptInsightsFetchError extends Error {
  constructor(message = 'Failed to fetch prompt insights') {
    super(message);
    this.name = 'PromptInsightsFetchError';
  }
}

function isPromptInsightsResponse(data: unknown): data is PromptInsightsResponse {
  return typeof data === 'object' && data !== null && 'total_prompts_analyzed' in data;
}

export function usePromptInsights() {
  const [data, setData] = useState<PromptInsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPromptInsights = useCallback(async (
    type: 'all' | 'winning' | 'losing' | 'opportunities' = 'all',
    limit = 20
  ) => {
    setLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams({
        type,
        limit: limit.toString(),
      });
      const response = await authenticatedFetch(`${API_BASE_URL}/prompt-insights?${params}`);
      if (!response.ok) throw new PromptInsightsFetchError();
      
      const json: unknown = await response.json();
      if (!isPromptInsightsResponse(json)) {
        throw new PromptInsightsFetchError('Invalid response format');
      }
      setData(json);
      return json;
    } catch (err) {
      const message = getErrorMessage(err, 'visibility');
      setError(message);
      console.error('[promptInsights] Error fetching prompt insights:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    data,
    loading,
    error,
    fetchPromptInsights,
  };
}
