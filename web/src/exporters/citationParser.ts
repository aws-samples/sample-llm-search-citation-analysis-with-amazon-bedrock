/**
 * API response parsing utilities.
 */

import {
  API_BASE_URL, authenticatedFetch 
} from '../infrastructure';
import { getDomain } from '../formatting/urlFormatter';
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

/** The Type cell of the citation export. */
function citationTypeLabel(citation: TopUrl): 'Video' | 'Page' {
  return isVideoCitation(citation) ? 'Video' : 'Page';
}

/** Column widths of the citation export, one per `citationExportRows` column, in order. */
export const CITATION_EXPORT_COLUMNS = [
  { wch: 8 }, { wch: 80 }, { wch: 30 }, { wch: 8 }, { wch: 10 }, { wch: 15 }, { wch: 60 },
];

/** The rows of the citation Excel export, ranked in the order given. */
export function citationExportRows(citations: TopUrl[]) {
  return citations.map((citation, idx) => ({
    Rank: idx + 1,
    URL: citation.url,
    Domain: getDomain(citation.url),
    Type: citationTypeLabel(citation),
    Keywords: citation.keyword_count ?? 0,
    'Citation Count': citation.citation_count,
    'Keyword List': (citation.keywords ?? []).join(', '),
  }));
}

function matchesContentType(citation: TopUrl, contentType: ContentTypeFilter): boolean {
  if (contentType === 'all') return true;
  return (contentType === 'video') === isVideoCitation(citation);
}

/**
 * Filter and sort citations based on search criteria.
 */
export function filterAndSortCitations(
  citations: TopUrl[],
  searchQuery: string,
  minCitations: number | '',
  sort: SortConfig,
  contentType: ContentTypeFilter = 'all',
): TopUrl[] {
  const filtered = citations.filter((citation) => {
    const matchesSearch = searchQuery === '' || 
      citation.url.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesMin = minCitations === '' || 
      citation.citation_count >= minCitations;
    return matchesSearch && matchesMin && matchesContentType(citation, contentType);
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
