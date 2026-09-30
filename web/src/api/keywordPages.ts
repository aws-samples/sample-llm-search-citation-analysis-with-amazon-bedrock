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
import type { Keyword } from '../types';
import {
  isKeywordsPage, type KeywordsPage
} from '../types/domain/keywordDecoders';

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

function keywordPageParams(
  nextToken: string | null,
  authoritative: boolean
): Record<string, string> | undefined {
  const params: Record<string, string> = {
    ...(authoritative ? { authoritative: 'true' } : {}),
    ...(nextToken === null ? {} : { next_token: nextToken }),
  };
  return Object.keys(params).length > 0 ? params : undefined;
}

async function fetchKeywordPage(
  nextToken: string | null,
  options: FetchAllKeywordsOptions
): Promise<KeywordsPage> {
  const payload = await apiGet<unknown>('/keywords', {
    signal: options.signal,
    params: keywordPageParams(nextToken, options.authoritative === true),
  });
  if (!isKeywordsPage(payload)) {
    throw new KeywordPageError('Keywords API returned an invalid page');
  }
  return payload;
}

async function collectKeywordPages(
  nextToken: string | null,
  seenTokens: Set<string>,
  collected: Keyword[],
  options: FetchAllKeywordsOptions
): Promise<Keyword[]> {
  const page = await fetchKeywordPage(nextToken, options);
  collected.push(...page.keywords);
  if (page.next_token === null) return collected;
  // A server that hands back a token it already issued would loop forever.
  if (seenTokens.has(page.next_token)) {
    throw new KeywordPageError('Keywords API repeated a continuation token');
  }
  seenTokens.add(page.next_token);
  return collectKeywordPages(page.next_token, seenTokens, collected, options);
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
  const keywords = await collectKeywordPages(null, new Set<string>(), [], options);
  return keywords.sort(compareNewestFirst);
}
