/**
 * Dashboard API client functions.
 */
import { apiGet } from './client';
import type { CrawledContent } from '../types';

interface CrawledContentResponse {items: CrawledContent[];}

/**
 * Fetches the 20 latest crawls of a specific URL, without their page text
 * (the history lists crawls; the text of each can be several hundred KB).
 */
export async function fetchCrawlHistory(url: string): Promise<CrawledContent[]> {
  const params = new URLSearchParams({
    url,
    include_history: 'true',
    limit: '20',
    include_content: 'false',
  });
  const response = await apiGet<CrawledContentResponse>(`/crawled-content?${params.toString()}`);
  return response.items ?? [];
}
