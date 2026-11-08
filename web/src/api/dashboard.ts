/**
 * Dashboard API client functions.
 */
import { apiGet } from './client';
import type { CrawledContent } from '../types';

interface CrawledContentResponse {
  items?: CrawledContent[];
  next_token?: string | null;
}

/** One page of a URL's crawl history and the token of the next (`null` on the last). */
export interface CrawlHistoryPage {
  readonly items: CrawledContent[];
  readonly nextToken: string | null;
}

/** How many crawls one history page holds. */
export const CRAWL_HISTORY_PAGE = 20;

/**
 * One page of a URL's crawls, newest first, without their page text (the history lists crawls;
 * the text of each can be several hundred KB). `nextToken` continues after the previous page.
 */
export async function fetchCrawlHistory(url: string, nextToken: string | null = null): Promise<CrawlHistoryPage> {
  const params = new URLSearchParams({
    url,
    include_history: 'true',
    limit: String(CRAWL_HISTORY_PAGE),
    include_content: 'false',
    ...(nextToken === null ? {} : { next_token: nextToken }),
  });
  const response = await apiGet<CrawledContentResponse>(`/crawled-content?${params.toString()}`);
  return {
    items: response.items ?? [],
    nextToken: response.next_token ?? null,
  };
}
