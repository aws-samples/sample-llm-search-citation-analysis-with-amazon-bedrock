/**
 * Reads of the server-paged GET /citations endpoint.
 *
 * The API sorts and filters a scope's distinct URLs and returns one page plus
 * scope-wide totals; the Citations table asks for the page it shows, and the
 * Excel export follows `next_token` over every page of the same order and
 * filters, with each URL's keyword texts.
 */
import { apiGet } from './client';
import {
  collectCursorPages, withNextToken, type CursorPage
} from './cursorPages';
import type {
  CitationsPage, TopUrl
} from '../types';
import { isRecord } from '../types/domain/keywordDecoders';
import type {
  ContentTypeFilter, SortConfig
} from '../exporters/citationParser';

/** The dashboard's first page: enough for its charts and counts, no more. */
export const DASHBOARD_CITATIONS_LIMIT = 25;

/** The largest page the API serves (`limit` max). */
export const MAX_CITATIONS_PAGE = 1000;

/** The citations API answered with something other than a well-formed page. */
export class CitationPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CitationPageError';
  }
}

/** The table's order and filters, as the user set them. */
export interface CitationListQuery {
  readonly sort: SortConfig;
  readonly urlContains: string;
  readonly minCitations: number | '';
  readonly contentType: ContentTypeFilter;
  /** The header's market (`null` = every market combined). */
  readonly marketId: string | null;
}

function isNumberField(record: Record<string, unknown>, name: string): boolean {
  return typeof record[name] === 'number';
}

/** Whether `value` is a `GET /citations` page with its totals. */
export function isCitationsPage(value: unknown): value is CitationsPage {
  if (!isRecord(value)) return false;
  return Array.isArray(value.top_urls)
    && Array.isArray(value.provider_stats)
    && Array.isArray(value.brand_stats)
    && ['total_urls', 'total_citation_count', 'matched_urls'].every((name) => isNumberField(value, name))
    && (value.next_token === null || typeof value.next_token === 'string')
    && typeof value.truncated === 'boolean';
}

/** The query string of `query`: only the parameters that differ from the API defaults. */
export function citationListParams(query: CitationListQuery): Record<string, string> {
  return {
    ...(query.sort.column === 'citations' ? {} : { sort: query.sort.column }),
    ...(query.sort.direction === 'desc' ? {} : { order: query.sort.direction }),
    ...(query.urlContains === '' ? {} : { url_contains: query.urlContains }),
    ...(query.minCitations === '' ? {} : { min_citations: String(query.minCitations) }),
    ...(query.contentType === 'all' ? {} : { content_type: query.contentType }),
    ...(query.marketId === null ? {} : { market_id: query.marketId }),
  };
}

/** One page of `GET /citations` with `params`; rejects with `CitationPageError` when it is malformed. */
export async function fetchCitationsPage(
  params: Readonly<Record<string, string>>,
  signal?: AbortSignal
): Promise<CitationsPage> {
  const payload = await apiGet<unknown>('/citations', {
    signal,
    params: { ...params },
  });
  if (!isCitationsPage(payload)) {
    throw new CitationPageError('Citations API returned an invalid page');
  }
  return payload;
}

/**
 * Every URL `query` selects, in its order, each with its keyword texts:
 * what the Excel export writes. Rejects, without a partial list, when a page
 * fails, is malformed or repeats a token.
 */
export async function fetchAllCitationUrls(
  query: CitationListQuery,
  options: {
    readonly includeKeywords?: boolean;
    readonly signal?: AbortSignal 
  } = {}
): Promise<TopUrl[]> {
  const params = {
    ...citationListParams(query),
    limit: String(MAX_CITATIONS_PAGE),
    ...(options.includeKeywords === true ? { include_keywords: 'true' } : {}),
  };
  return collectCursorPages(
    async (nextToken: string | null): Promise<CursorPage<TopUrl>> => {
      const page = await fetchCitationsPage(withNextToken(params, nextToken) ?? {}, options.signal);
      return {
        items: page.top_urls,
        nextToken: page.next_token,
      };
    },
    () => new CitationPageError('Citations API repeated a continuation token')
  );
}
