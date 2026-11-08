/**
 * Reads of the cursor-paginated GET /searches endpoint.
 *
 * The API returns one budget-bounded page of runs, newest first, plus an
 * opaque `next_token`. List rows carry no answer text unless
 * `include_response=true` is asked for (the keyword detail renders answers).
 */
import { apiGet } from './client';
import { withNextToken } from './cursorPages';
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


/** A batch of a keyword's runs and the token to continue after it (`null` once every run is read). */
export interface KeywordSearchBatch {
  readonly searches: Search[];
  readonly nextToken: string | null;
}

async function collectUpTo(
  params: Readonly<Record<string, string>>,
  maxRows: number,
  nextToken: string | null,
  collected: Search[],
  seenTokens: Set<string>
): Promise<KeywordSearchBatch> {
  const page = await fetchSearchesPage(withNextToken(params, nextToken) ?? params);
  collected.push(...page.searches);
  if (page.next_token === null || collected.length >= maxRows) return {
    searches: collected,
    nextToken: page.next_token,
  };
  if (seenTokens.has(page.next_token)) throw new SearchPageError('Searches API repeated a continuation token');
  seenTokens.add(page.next_token);
  return collectUpTo(params, maxRows, page.next_token, collected, seenTokens);
}

/**
 * The next batch of `keyword`'s runs with their answer text, newest first: whole pages from
 * `nextToken` until the batch holds at least `maxRows` runs or the last page is read. The
 * keyword detail shows the first batch and loads the older ones on demand.
 */
export async function fetchKeywordSearches(
  keyword: string,
  nextToken: string | null = null,
  maxRows: number = KEYWORD_DETAIL_MAX_RUNS
): Promise<KeywordSearchBatch> {
  const params = {
    keyword,
    include_response: 'true',
    limit: String(Math.min(maxRows, MAX_SEARCHES_PAGE)),
  };
  return collectUpTo(params, maxRows, nextToken, [], new Set<string>());
}
