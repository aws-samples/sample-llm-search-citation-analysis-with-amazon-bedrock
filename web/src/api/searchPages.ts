/**
 * Reads of the cursor-paginated GET /searches endpoint.
 *
 * The API returns one budget-bounded page of runs, newest first, plus an
 * opaque `next_token`. List rows carry no answer text unless
 * `include_response=true` is asked for (the keyword detail renders answers).
 */
import { apiGet } from './client';
import {
  collectCursorPages, withNextToken, type CursorPage
} from './cursorPages';
import type { Search } from '../types';
import { isRecord } from '../types/domain/keywordDecoders';

/** The largest page the API serves (`limit` max). */
export const MAX_SEARCHES_PAGE = 500;

/** Runs of one keyword the detail charts: the newest 500, as before pagination. */
export const KEYWORD_DETAIL_MAX_RUNS = 500;

/** The searches API answered with something other than a well-formed page. */
export class SearchPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SearchPageError';
  }
}

export interface SearchesPage {
  readonly searches: Search[];
  readonly next_token: string | null;
}

/** Whether `value` is a `GET /searches` page. */
export function isSearchesPage(value: unknown): value is SearchesPage {
  return isRecord(value)
    && Array.isArray(value.searches)
    && (value.next_token === null || typeof value.next_token === 'string');
}

/** One page of `GET /searches` with `params`; rejects with `SearchPageError` when it is malformed. */
export async function fetchSearchesPage(
  params: Readonly<Record<string, string>>,
  signal?: AbortSignal
): Promise<SearchesPage> {
  const payload = await apiGet<unknown>('/searches', {
    signal,
    params: { ...params },
  });
  if (!isSearchesPage(payload)) {
    throw new SearchPageError('Searches API returned an invalid page');
  }
  return payload;
}

/** Every run `params` selects, over every page, newest first (the Recent Searches export). */
export async function fetchAllSearches(params: Readonly<Record<string, string>> = {}): Promise<Search[]> {
  const pageParams = {
    ...params,
    limit: String(MAX_SEARCHES_PAGE),
  };
  return collectCursorPages(
    async (nextToken: string | null): Promise<CursorPage<Search>> => {
      const page = await fetchSearchesPage(withNextToken(pageParams, nextToken) ?? pageParams);
      return {
        items: page.searches,
        nextToken: page.next_token,
      };
    },
    () => new SearchPageError('Searches API repeated a continuation token')
  );
}

async function collectUpTo(
  params: Readonly<Record<string, string>>,
  maxRows: number,
  nextToken: string | null,
  collected: Search[],
  seenTokens: Set<string>
): Promise<Search[]> {
  const page = await fetchSearchesPage(withNextToken(params, nextToken) ?? params);
  collected.push(...page.searches);
  if (page.next_token === null || collected.length >= maxRows) return collected.slice(0, maxRows);
  if (seenTokens.has(page.next_token)) throw new SearchPageError('Searches API repeated a continuation token');
  seenTokens.add(page.next_token);
  return collectUpTo(params, maxRows, page.next_token, collected, seenTokens);
}

/**
 * The newest `maxRows` runs of `keyword` with their answer text, read page by
 * page (a page of whole rows is cut to the API's page budget).
 */
export async function fetchKeywordSearches(
  keyword: string,
  maxRows: number = KEYWORD_DETAIL_MAX_RUNS
): Promise<Search[]> {
  const params = {
    keyword,
    include_response: 'true',
    limit: String(Math.min(maxRows, MAX_SEARCHES_PAGE)),
  };
  return collectUpTo(params, maxRows, null, [], new Set<string>());
}
