import type { PersonaRankingsResponse } from '../types';
import { useAnalysisEndpoint } from './useAnalysisEndpoint';

class PersonaRankingsFetchError extends Error {
  constructor(message = 'Failed to fetch persona rankings') {
    super(message);
    this.name = 'PersonaRankingsFetchError';
  }
}

function isPersonaRankingsResponse(data: unknown): data is PersonaRankingsResponse {
  if (typeof data !== 'object' || data === null) return false;
  if ('error' in data) return false;
  return 'keyword' in data && 'personas' in data && 'cross_persona_summary' in data;
}

const personaRankingsEndpoint = {
  errorContext: 'visibility',
  logMessage: '[persona-rankings] Error fetching rankings:',
  isValidResponse: isPersonaRankingsResponse,
  createHttpError: () => new PersonaRankingsFetchError(),
  createResponseError: (message: string) => new PersonaRankingsFetchError(message),
  buildRequest: (keyword: string, queryPromptId?: string) => {
    const params = new URLSearchParams({ keyword });
    if (queryPromptId) params.append('query_prompt_id', queryPromptId);
    return {
      path: '/persona-rankings',
      params,
    };
  },
};

export function usePersonaRankings() {
  const {
    data, loading, error, fetchData: fetchPersonaRankings 
  } = useAnalysisEndpoint(personaRankingsEndpoint);

  return {
    data,
    loading,
    error,
    fetchPersonaRankings 
  };
}
