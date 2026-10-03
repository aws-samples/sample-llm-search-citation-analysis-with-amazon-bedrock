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
 * Fetches crawl history for a specific URL.
 */
export async function fetchCrawlHistory(
  url: string,
  limit = 20,
  signal?: AbortSignal
): Promise<CrawledContent[]> {
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
