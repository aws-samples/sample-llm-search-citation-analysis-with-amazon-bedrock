/**
 * Dashboard API client functions.
 */
import { apiGet } from './client';
import type { CrawledContent } from '../types';

interface CrawledContentResponse {
  items: CrawledContent[];
  count: number;
}

/**
 * Fetches the 20 latest crawls of a specific URL.
 */
export async function fetchCrawlHistory(url: string): Promise<CrawledContent[]> {
  const params = new URLSearchParams({
    url,
    include_history: 'true',
    limit: '20',
  });
  const response = await apiGet<CrawledContentResponse>(`/crawled-content?${params.toString()}`);
  return response.items ?? [];
}
