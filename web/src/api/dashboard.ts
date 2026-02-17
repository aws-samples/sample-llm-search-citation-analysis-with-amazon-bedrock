/**
 * Dashboard API client functions.
 */
import { apiGet } from './client';
import type {
  Stats, Citations, Search, Keyword 
} from '../types';

interface SearchesResponse {searches: Search[];}

interface KeywordsResponse {keywords: Keyword[];}

interface CrawledContentItem {
  normalized_url: string;
  title: string;
  summary: string;
  content: string;
  screenshot_url?: string;
  seo_analysis?: Record<string, unknown>;
  crawled_at: string;
  keyword: string;
  citation_count: number;
  citing_providers: string[];
  page_load_time_ms?: number;
  content_length?: number;
  status?: 'success' | 'blocked' | 'error';
  block_reason?: string;
  error_message?: string;
}

interface CrawledContentResponse {
  items: CrawledContentItem[];
  count: number;
}

/**
 * Fetches dashboard statistics.
 */
export function fetchStats(signal?: AbortSignal): Promise<Stats> {
  return apiGet<Stats>('/stats', { signal });
}

/**
 * Fetches citation data with provider stats and top URLs.
 */
export function fetchCitations(signal?: AbortSignal): Promise<Citations> {
  return apiGet<Citations>('/citations', { signal });
}

/**
 * Fetches recent searches.
 */
export async function fetchSearches(signal?: AbortSignal): Promise<Search[]> {
  const response = await apiGet<SearchesResponse>('/searches', { signal });
  return response.searches ?? [];
}

/**
 * Fetches tracked keywords.
 */
export async function fetchKeywords(signal?: AbortSignal): Promise<Keyword[]> {
  const response = await apiGet<KeywordsResponse>('/keywords', { signal });
  return response.keywords ?? [];
}

/**
 * Fetches crawl history for a specific URL.
 */
export async function fetchCrawlHistory(
  url: string,
  limit = 20,
  signal?: AbortSignal
): Promise<CrawledContentItem[]> {
  const params = new URLSearchParams({
    url,
    include_history: 'true',
    limit: limit.toString(),
  });
  const response = await apiGet<CrawledContentResponse>(
    `/crawled-content?${params.toString()}`,
    { signal }
  );
  return response.items ?? [];
}
