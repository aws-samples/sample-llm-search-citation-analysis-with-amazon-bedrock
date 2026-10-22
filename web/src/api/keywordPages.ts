/**
 * Complete keyword reads over the paginated GET /keywords endpoint.
 *
 * The API returns one table-scan page per request plus an opaque
 * `next_token`; every dashboard keyword list (run and schedule pickers,
 * keyword settings, group membership) needs the whole table, so this follows
 * the token until the API reports the last page and then sorts the assembled
 * list, which the server cannot do across pages.
 */
import { apiGet } from './client';
import {
  collectCursorPages, withNextToken, type CursorPage
} from './cursorPages';
import type { Keyword } from '../types';
import { isKeywordsPage } from '../types/domain/keywordDecoders';

/** The keywords API answered with something other than a well-formed page sequence. */
export class KeywordPageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeywordPageError';
  }
}

export interface FetchAllKeywordsOptions {
  signal?: AbortSignal;
  /** Strongly consistent read of every page (post-promotion reconciliation). */
  authoritative?: boolean;
}

async function fetchKeywordPage(
  nextToken: string | null,
  options: FetchAllKeywordsOptions
): Promise<CursorPage<Keyword>> {
  const payload = await apiGet<unknown>('/keywords', {
    signal: options.signal,
    params: withNextToken(options.authoritative === true ? { authoritative: 'true' } : {}, nextToken),
  });
  if (!isKeywordsPage(payload)) {
    throw new KeywordPageError('Keywords API returned an invalid page');
  }
  return {
    items: payload.keywords,
    nextToken: payload.next_token,
  };
}

/** Newest first by `created_at`; equal timestamps keep their page order. */
function compareNewestFirst(left: Keyword, right: Keyword): number {
  if (left.created_at === right.created_at) return 0;
  return left.created_at < right.created_at ? 1 : -1;
}

/**
 * Every keyword the endpoint returns, newest first. Rejects, without a
 * partial list, when any page fails, is malformed, or repeats a token.
 */
export async function fetchAllKeywords(
  options: FetchAllKeywordsOptions = {}
): Promise<Keyword[]> {
  const keywords = await collectCursorPages(
    async (nextToken: string | null) => fetchKeywordPage(nextToken, options),
    () => new KeywordPageError('Keywords API repeated a continuation token')
  );
  return keywords.sort(compareNewestFirst);
}
