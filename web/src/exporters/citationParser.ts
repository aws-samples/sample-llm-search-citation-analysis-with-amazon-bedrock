/**
 * API response parsing utilities.
 */

import {
  API_BASE_URL, authenticatedFetch 
} from '../infrastructure';
import {
  collectCursorPages, type CursorPage
} from '../api/cursorPages';
import type { TopUrl } from '../types';

/** One keyword/provider pair that cited a URL (`GET /api/url-breakdown`). */
export interface UrlBreakdown {
  keyword: string;
  provider: string;
}

interface ApiResponse<T> {
  items?: T[];
  data?: T[];
}

/**
 * Safely parse JSON from a fetch response.
 */
export async function safeJsonParse<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

/**
 * Parse API response to extract items array.
 */
export function parseApiResponse<T>(data: unknown): ApiResponse<T> {
  if (typeof data !== 'object' || data === null) {
    return { items: [] };
  }
  const obj = data as Record<string, unknown>;
  if (Array.isArray(obj.items)) {
    return { items: obj.items as T[] };
  }
  if (Array.isArray(obj.data)) {
    return { items: obj.data as T[] };
  }
  return { items: [] };
}

export type SortColumn = 'citations' | 'keywords' | 'domain';
type SortDirection = 'asc' | 'desc';

export interface SortConfig {
  column: SortColumn;
  direction: SortDirection;
}

/** The Type filter of the citation table: every citation, or one content type. */
export type ContentTypeFilter = 'all' | 'video' | 'page';

/** Whether the API tagged `citation` as a YouTube video; any other or missing value is a page. */
export function isVideoCitation(citation: TopUrl): boolean {
  return citation.content_type === 'video';
}

/** One page of `GET /url-breakdown` for `url` (and the market), after `nextToken`. */
async function fetchBreakdownPage(url: string, marketId: string | null, nextToken: string | null): Promise<CursorPage<UrlBreakdown>> {
  const params = new URLSearchParams({
    url,
    ...(marketId === null ? {} : { market_id: marketId }),
    ...(nextToken === null ? {} : { next_token: nextToken }),
  });
  const response = await authenticatedFetch(`${API_BASE_URL}/url-breakdown?${params.toString()}`);
  const json = await response.json() as {
    breakdown?: UrlBreakdown[];
    next_token?: string | null
  };
  return {
    items: json.breakdown ?? [],
    nextToken: json.next_token ?? null,
  };
}

/**
 * Every keyword × engine row of one cited URL (`GET /url-breakdown`), in the header's market
 * when one is picked, following `next_token` to the API's last page; empty when a page fails.
 */
export async function fetchBreakdownData(url: string, marketId: string | null = null): Promise<UrlBreakdown[]> {
  try {
    return await collectCursorPages((nextToken) => fetchBreakdownPage(url, marketId, nextToken));
  } catch {
    return [];
  }
}
