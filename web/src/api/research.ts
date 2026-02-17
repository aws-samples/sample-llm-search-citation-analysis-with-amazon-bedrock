/**
 * Keyword research API client functions.
 */
import {
  apiGet, apiPost, apiDelete 
} from './client';
import type {
  KeywordExpansionResult,
  CompetitorAnalysisResult,
  KeywordResearchItem,
} from '../types';

interface ExpandKeywordsOptions {
  seedKeyword: string;
  industry: string;
  count?: number;
  signal?: AbortSignal;
}

/**
 * Expands a seed keyword into related keywords.
 */
export function expandKeywords(
  options: ExpandKeywordsOptions
): Promise<KeywordExpansionResult> {
  const {
    seedKeyword, industry, count = 20, signal 
  } = options;
  return apiPost<KeywordExpansionResult>(
    '/keyword-research/expand',
    {
      seed_keyword: seedKeyword,
      industry,
      count,
    },
    { signal }
  );
}

interface AnalyzeCompetitorOptions {
  url: string;
  industry: string;
  signal?: AbortSignal;
}

/**
 * Analyzes a competitor URL for keywords.
 */
export function analyzeCompetitor(
  options: AnalyzeCompetitorOptions
): Promise<CompetitorAnalysisResult> {
  const {
    url, industry, signal 
  } = options;
  return apiPost<CompetitorAnalysisResult>(
    '/keyword-research/competitor',
    {
      url,
      industry 
    },
    { signal }
  );
}

interface FetchResearchHistoryOptions {
  type?: 'expansion' | 'competitor';
  limit?: number;
  signal?: AbortSignal;
}

interface ResearchHistoryResponse {items: KeywordResearchItem[];}

/**
 * Fetches keyword research history.
 */
export async function fetchResearchHistory(
  options: FetchResearchHistoryOptions = {}
): Promise<KeywordResearchItem[]> {
  const {
    type, limit = 50, signal 
  } = options;
  const params: Record<string, string> = { limit: limit.toString() };
  if (type) params.type = type;
  const response = await apiGet<ResearchHistoryResponse>('/keyword-research/history', {
    params,
    signal,
  });
  return response.items ?? [];
}

/**
 * Deletes a keyword research item.
 */
export function deleteResearchItem(id: string): Promise<{ message: string }> {
  return apiDelete<{ message: string }>(`/keyword-research/${id}`);
}
