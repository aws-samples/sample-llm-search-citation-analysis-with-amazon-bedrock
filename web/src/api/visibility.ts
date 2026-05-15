/**
 * Visibility and insights API client functions.
 */
import {
  apiGet, apiPost 
} from './client';
import type {
  VisibilityMetricsResponse,
  PromptInsightsResponse,
  CitationGapsResponse,
  RecommendationsResponse,
  HistoricalTrendsResponse,
} from '../types';

interface FetchVisibilityOptions {
  keyword: string;
  brand?: string;
  queryPromptId?: string;
  signal?: AbortSignal;
}

/**
 * Fetches visibility metrics for a keyword.
 */
export function fetchVisibilityMetrics(
  options: FetchVisibilityOptions
): Promise<VisibilityMetricsResponse> {
  const {
    keyword, brand, queryPromptId, signal 
  } = options;
  const params: Record<string, string> = { keyword };
  if (brand) params.brand = brand;
  if (queryPromptId) params.query_prompt_id = queryPromptId;
  return apiGet<VisibilityMetricsResponse>('/visibility', {
    params,
    signal 
  });
}

interface FetchPromptInsightsOptions {
  limit?: number;
  signal?: AbortSignal;
}

/**
 * Fetches prompt insights across all keywords.
 */
export function fetchPromptInsights(
  options: FetchPromptInsightsOptions = {}
): Promise<PromptInsightsResponse> {
  const {
    limit = 50, signal 
  } = options;
  return apiGet<PromptInsightsResponse>('/prompt-insights', {
    params: { limit: limit.toString() },
    signal,
  });
}

interface FetchCitationGapsOptions {
  keyword?: string;
  signal?: AbortSignal;
}

/**
 * Fetches citation gaps for a keyword or all keywords.
 */
export function fetchCitationGaps(
  options: FetchCitationGapsOptions = {}
): Promise<CitationGapsResponse> {
  const {
    keyword, signal 
  } = options;
  const params: Record<string, string> = {};
  if (keyword) params.keyword = keyword;
  return apiGet<CitationGapsResponse>('/citation-gaps', {
    params,
    signal 
  });
}

interface FetchRecommendationsOptions {
  useLlm?: boolean;
  signal?: AbortSignal;
}

/**
 * Fetches recommendations for improving brand visibility.
 */
export function fetchRecommendations(
  options: FetchRecommendationsOptions = {}
): Promise<RecommendationsResponse> {
  const {
    useLlm = false, signal 
  } = options;
  return apiGet<RecommendationsResponse>('/recommendations', {
    params: { use_llm: useLlm.toString() },
    signal,
  });
}

interface SetRecommendationStatusBody {
  readonly status: 'new' | 'in_progress' | 'done' | 'wontfix';
  readonly notes?: string;
  readonly related_keyword?: string;
  readonly related_content_id?: string;
}

interface RecommendationStatusRow {
  recommendation_id: string;
  status: 'new' | 'in_progress' | 'done' | 'wontfix';
  updated_at: string;
  completed_at?: string;
  notes?: string;
  related_keyword?: string;
  related_content_id?: string;
  ttl?: number;
}

/**
 * Sets the action-tracking status for a single recommendation.
 *
 * The `id` is the deterministic hash returned on each recommendation in
 * `RecommendationsResponse.recommendations[].id`. Same id across list
 * regenerations, so the status persists even when the underlying list
 * is recomputed.
 */
export function setRecommendationStatus(
  id: string,
  body: SetRecommendationStatusBody,
  signal?: AbortSignal,
): Promise<RecommendationStatusRow> {
  return apiPost<RecommendationStatusRow>(
    `/recommendations/${encodeURIComponent(id)}/status`,
    body,
    { signal },
  );
}

interface FetchHistoricalTrendsOptions {
  keyword?: string;
  days?: number;
  signal?: AbortSignal;
}

/**
 * Fetches historical trend data for visibility metrics.
 */
export function fetchHistoricalTrends(
  options: FetchHistoricalTrendsOptions = {}
): Promise<HistoricalTrendsResponse> {
  const {
    keyword, days = 30, signal 
  } = options;
  const params: Record<string, string> = { days: days.toString() };
  if (keyword) params.keyword = keyword;
  return apiGet<HistoricalTrendsResponse>('/trends', {
    params,
    signal 
  });
}
