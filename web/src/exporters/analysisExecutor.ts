import {
  API_BASE_URL, authenticatedFetch 
} from '../infrastructure';

export interface TriggerAnalysisResponse {
  execution_arn?: string;
  execution_name?: string;
  error?: string;
}

function isTriggerAnalysisResponse(data: unknown): data is TriggerAnalysisResponse {
  return typeof data === 'object' && data !== null;
}

export async function triggerKeywordAnalysis(keywords: string[]): Promise<TriggerAnalysisResponse> {
  const response = await authenticatedFetch(`${API_BASE_URL}/trigger-keyword-analysis`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords }),
  });

  const json: unknown = await response.json();
  if (!isTriggerAnalysisResponse(json)) {
    return { error: 'Invalid response format' };
  }
  return json;
}