/**
 * Complete reads over a cursor-paginated endpoint.
 *
 * Paginated routes answer one bounded page plus an opaque `next_token`
 * (`lambda/shared/cursors.py`); a view that needs the whole collection (an
 * Excel export, a picker over every item) follows the token until the server
 * reports the last page. No single response then approaches the Lambda
 * payload cap, however large the collection grows.
 */

/** One decoded page: its items and the token of the next page (`null` on the last). */
export interface CursorPage<T> {
  readonly items: readonly T[];
  readonly nextToken: string | null;
}

/** Fetches the page `nextToken` points at (`null` for the first page). */
export type CursorPageFetcher<T> = (nextToken: string | null) => Promise<CursorPage<T>>;

/** The endpoint handed back a token it had already issued, which would loop forever. */
export class RepeatedCursorError extends Error {
  constructor(message = 'The API repeated a continuation token') {
    super(message);
    this.name = 'RepeatedCursorError';
  }
}

async function collectFrom<T>(
  fetchPage: CursorPageFetcher<T>,
  nextToken: string | null,
  seenTokens: Set<string>,
  collected: T[],
  repeatedTokenError: () => Error
): Promise<T[]> {
  const page = await fetchPage(nextToken);
  collected.push(...page.items);
  if (page.nextToken === null) return collected;
  if (seenTokens.has(page.nextToken)) throw repeatedTokenError();
  seenTokens.add(page.nextToken);
  return collectFrom(fetchPage, page.nextToken, seenTokens, collected, repeatedTokenError);
}

/**
 * Every item of every page, in page order. Rejects, without a partial list,
 * when a page fails or the endpoint repeats a token.
 */
export async function collectCursorPages<T>(
  fetchPage: CursorPageFetcher<T>,
  repeatedTokenError: () => Error = () => new RepeatedCursorError()
): Promise<T[]> {
  return collectFrom(fetchPage, null, new Set<string>(), [], repeatedTokenError);
}

/** `params` plus `next_token` when there is one; `undefined` when nothing is left to send. */
export function withNextToken(
  params: Readonly<Record<string, string>>,
  nextToken: string | null
): Record<string, string> | undefined {
  const merged: Record<string, string> = {
    ...params,
    ...(nextToken === null ? {} : { next_token: nextToken }),
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}
