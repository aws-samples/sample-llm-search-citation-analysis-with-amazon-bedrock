/**
 * The paged lists of 2.45.0 scoped views (`test-fixtures/scope-snapshots/*.json` `paging`).
 *
 * A scoped body carries the first page of a list plus `<list>_next_token` and `<list>_total`.
 * When the route has a page view (`view=<list>`), the next page is the same GET with `view` and
 * `next_token` and answers `<list>`, `<list>_total` and `next_token`; otherwise the next page is
 * the same GET with `next_token` and answers the same keys as the first. A cursor whose snapshot
 * build is gone, or whose keyword set changed, answers `400 cursor_expired`: the list restarts.
 */
import { ApiRequestError } from '../infrastructure';
import { isRecord } from '../types/domain/keywordDecoders';
import { isCursorExpiredBody } from '../types/domain/scopeCoverageDecoders';
import { apiGet } from './client';

/** Where a route keeps its list, cursor and total; dotted keys reach into a nested object (`rollup.outranked_keywords`). */
export interface ListPaging {
  readonly list: string;
  readonly token: string;
  readonly total: string;
  /** The `view` parameter of the page request; `null` when the next page is the same GET with a token. */
  readonly view: string | null;
}

/** The GET a scoped view was read with: its path and query. */
export interface ListRequest {
  readonly path: string;
  readonly params?: URLSearchParams;
}

/** One page: its items, the cursor of the next page (`null` on the last) and the list's total when known. */
export interface ListPage<T> {
  readonly items: readonly T[];
  readonly nextToken: string | null;
  readonly total: number | null;
}

/** Where a list's pages come from: the view's GET, where its list sits, and the guard of one item. */
export interface ListSource<T> {
  readonly request: ListRequest;
  readonly paging: ListPaging;
  readonly isItem: (value: unknown) => value is T;
}

/** A list cursor the server no longer honours (`400 cursor_expired`): read the list again from the start. */
export class CursorExpiredError extends Error {
  constructor(message = 'The list changed while it was being read') {
    super(message);
    this.name = 'CursorExpiredError';
  }
}

function readPath(body: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((value, key) => (isRecord(value) ? value[key] : undefined), body);
}

function prefixOf(dotted: string): string {
  const cut = dotted.lastIndexOf('.');
  return cut < 0 ? '' : dotted.slice(0, cut + 1);
}

/**
 * The list page a body holds; `null` when its list is missing or holds an item `isItem` rejects.
 * `page`: the body answers a `view=<list>` page request, whose cursor is `next_token`.
 */
export function readListPage<T>(
  body: unknown,
  paging: ListPaging,
  isItem: (value: unknown) => value is T,
  page = false,
): ListPage<T> | null {
  const items = readPath(body, paging.list);
  if (!Array.isArray(items) || !items.every(isItem)) return null;
  const tokenKey = page && paging.view !== null ? `${prefixOf(paging.list)}next_token` : paging.token;
  const token = readPath(body, tokenKey);
  const total = readPath(body, paging.total);
  return {
    items,
    nextToken: typeof token === 'string' && token !== '' ? token : null,
    total: typeof total === 'number' ? total : null,
  };
}

/**
 * The query of the page `nextToken` points at: the view's GET with `view` (when the route has a
 * page view) and the cursor. `null` asks for the first page, which is the view's own GET: its body
 * holds the first page and the cursor of the second (a page view without a cursor is ambiguous on
 * some routes, e.g. `/reports/group-kpis?view=keywords` is also the per-keyword runs view).
 */
export function listPageParams(request: ListRequest, paging: ListPaging, nextToken: string | null): Record<string, string> {
  const params = Object.fromEntries(new URLSearchParams(request.params ?? '').entries());
  delete params.next_token;
  if (nextToken === null) return params;
  if (paging.view !== null) params.view = paging.view;
  params.next_token = nextToken;
  return params;
}

/**
 * Reads one page of the list. Throws `CursorExpiredError` on `400 cursor_expired`, an
 * `ApiRequestError` on any other `400` or an undecodable page.
 */
export async function fetchListPage<T>(
  {
    request, paging, isItem
  }: ListSource<T>,
  nextToken: string | null,
  signal?: AbortSignal,
): Promise<ListPage<T>> {
  const body = await apiGet<unknown>(request.path, {
    params: listPageParams(request, paging, nextToken),
    acceptedJsonStatuses: [400],
    signal,
  });
  if (isCursorExpiredBody(body)) throw new CursorExpiredError();
  if (isRecord(body) && typeof body.error === 'string') throw new ApiRequestError(body.error, { statusCode: 400 });
  const page = readListPage(body, paging, isItem, nextToken !== null);
  if (page === null) throw new ApiRequestError('Invalid list page');
  return page;
}

/** The page after `nextToken`, or the list's first page again when the cursor expired. */
export async function fetchNextPageOrRestart<T>(
  source: ListSource<T>,
  nextToken: string,
  signal: AbortSignal,
): Promise<{
  page: ListPage<T>;
  restarted: boolean 
}> {
  try {
    return {
      page: await fetchListPage(source, nextToken, signal),
      restarted: false,
    };
  } catch (error) {
    if (!(error instanceof CursorExpiredError)) throw error;
    return {
      page: await fetchListPage(source, null, signal),
      restarted: true,
    };
  }
}
