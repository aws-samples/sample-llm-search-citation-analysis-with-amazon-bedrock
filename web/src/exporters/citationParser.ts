/**
 * API response parsing utilities.
 */

import {
  API_BASE_URL, authenticatedFetch 
} from '../infrastructure';
import { getDomain } from '../formatting/urlFormatter';
import type { TopUrl } from '../types';

interface UrlBreakdown {
  keyword: string;
  provider: string;
  timestamp: string;
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
export type SortDirection = 'asc' | 'desc';

export interface SortConfig {
  column: SortColumn;
  direction: SortDirection;
}

/**
 * Filter and sort citations based on search criteria.
 */
export function filterAndSortCitations(
  citations: TopUrl[],
  searchQuery: string,
  minCitations: number | '',
  sort: SortConfig
): TopUrl[] {
  const filtered = citations.filter((citation) => {
    const matchesSearch = searchQuery === '' || 
      citation.url.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesMin = minCitations === '' || 
      citation.citation_count >= minCitations;
    return matchesSearch && matchesMin;
  });

  const dir = sort.direction === 'asc' ? 1 : -1;

  return [...filtered].sort((a, b) => {
    if (sort.column === 'keywords') {
      return ((a.keyword_count ?? 0) - (b.keyword_count ?? 0)) * dir;
    }
    if (sort.column === 'domain') {
      return getDomain(a.url).localeCompare(getDomain(b.url)) * dir;
    }
    return (a.citation_count - b.citation_count) * dir;
  });
}

/**
 * Fetch breakdown data for a URL.
 */
export async function fetchBreakdownData(url: string): Promise<UrlBreakdown[]> {
  try {
    const response = await authenticatedFetch(
      `${API_BASE_URL}/url-breakdown?url=${encodeURIComponent(url)}`
    );
    const json = await response.json() as { breakdown?: UrlBreakdown[] };
    return json.breakdown ?? [];
  } catch {
    return [];
  }
}
