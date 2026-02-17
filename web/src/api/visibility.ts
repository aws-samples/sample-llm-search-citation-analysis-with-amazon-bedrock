/**
 * Visibility and insights API client functions.
 */
import { apiGet } from './client';
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
  signal?: AbortSignal;
}

/**
 * Fetches visibility metrics for a keyword.
 */
export function fetchVisibilityMetrics(
  options: FetchVisibilityOptions
): Promise<VisibilityMetricsResponse> {
  const {
    keyword, brand, signal 
  } = options;
  const params: Record<string, string> = { keyword };
  if (brand) params.brand = brand;
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
