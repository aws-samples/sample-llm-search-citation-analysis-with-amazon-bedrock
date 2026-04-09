import {
  useState, useCallback 
} from 'react';
import {
  API_BASE_URL, authenticatedFetch, getErrorMessage 
} from '../infrastructure';
import type { PersonaRankingsResponse } from '../types';

class PersonaRankingsFetchError extends Error {
  constructor(message = 'Failed to fetch persona rankings') {
    super(message);
    this.name = 'PersonaRankingsFetchError';
  }
}

interface BackendErrorResponse {error: string;}

function isBackendErrorResponse(data: unknown): data is BackendErrorResponse {
  return typeof data === 'object' && data !== null && 'error' in data && typeof (data as BackendErrorResponse).error === 'string';
}

function isPersonaRankingsResponse(data: unknown): data is PersonaRankingsResponse {
  if (typeof data !== 'object' || data === null) return false;
  if ('error' in data) return false;
  return 'keyword' in data && 'personas' in data && 'cross_persona_summary' in data;
}

export function usePersonaRankings() {
  const [data, setData] = useState<PersonaRankingsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPersonaRankings = useCallback(async (keyword: string, queryPromptId?: string) => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({ keyword });
      if (queryPromptId) params.append('query_prompt_id', queryPromptId);

      const response = await authenticatedFetch(`${API_BASE_URL}/persona-rankings?${params}`);
      if (!response.ok) throw new PersonaRankingsFetchError();

      const json: unknown = await response.json();
      if (isBackendErrorResponse(json)) {
        throw new PersonaRankingsFetchError(json.error);
      }
      if (!isPersonaRankingsResponse(json)) {
        throw new PersonaRankingsFetchError('Invalid response format');
      }
      setData(json);
      return json;
    } catch (err) {
      const message = getErrorMessage(err, 'visibility');
      setError(message);
      console.error('[persona-rankings] Error fetching rankings:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    data,
    loading,
    error,
    fetchPersonaRankings 
  };
}
