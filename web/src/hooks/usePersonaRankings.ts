import type { PersonaRankingsResponse } from '../types';
import {
  fetchErrors, isAnalysisPayload, useAnalysisEndpoint 
} from './useAnalysisEndpoint';

function isPersonaRankingsResponse(data: unknown): data is PersonaRankingsResponse {
  if (!isAnalysisPayload(data)) return false;
  return 'keyword' in data && 'personas' in data && 'cross_persona_summary' in data;
}

const personaRankingsEndpoint = {
  errorContext: 'visibility',
  logMessage: '[persona-rankings] Error fetching rankings:',
  isValidResponse: isPersonaRankingsResponse,
  ...fetchErrors('PersonaRankingsFetchError', 'Failed to fetch persona rankings'),
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
