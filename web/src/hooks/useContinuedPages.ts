import {
  useCallback, useEffect, useRef, useState
} from 'react';
import { isAbortError } from '../infrastructure';
import type { CursorPage } from '../api/cursorPages';

/** Fetches the page `nextToken` points at, for the query of the first page. */
export type NextPageFetcher<T> = (nextToken: string, signal: AbortSignal) => Promise<CursorPage<T>>;

/** The later pages loaded after one first page; a new first page drops them. */
interface Continuation<T> {
  readonly first: CursorPage<T>;
  readonly later: readonly T[];
  readonly nextToken: string | null;
}

/** A request state that belongs to one first page, so a new first page clears it without an effect. */
interface ForFirst {readonly first: object;}

export interface ContinuedPages<T> {
  /** The first page's items followed by every later page loaded so far, without repeats. */
  readonly items: readonly T[];
  /** Whether the API holds more pages than the ones loaded. */
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  /** The last page request failed: `loadMore` tries it again. */
  readonly failed: boolean;
  /** Asks for the next page; does nothing while one is in flight or when there is none. */
  readonly loadMore: () => void;
}

/** `later` plus the items of `page` whose key is not in `first` or `later` yet (a page fetched twice adds nothing). */
function appendNew<T>(first: readonly T[], later: readonly T[], page: readonly T[], itemKey: (item: T) => string): T[] {
  const seen = new Set([...first, ...later].map(itemKey));
  return [...later, ...page.filter((item) => !seen.has(itemKey(item)))];
}

/** What is loaded after `first`: the stored continuation when it belongs to `first`, else none yet. */
function continuationOf<T>(loaded: Continuation<T> | null, first: CursorPage<T> | null): Continuation<T> | null {
  if (first === null) return null;
  if (loaded?.first === first) return loaded;
  return {
    first,
    later: [],
    nextToken: first.nextToken,
  };
}

function itemsOf<T>(current: Continuation<T> | null): readonly T[] {
  return current === null ? [] : [...current.first.items, ...current.later];
}

/** Whether a request state is about `first` (a state of an earlier first page reads as unset). */
function isFor(state: ForFirst | null, first: object | null): boolean {
  return first !== null && state?.first === first;
}

/**
 * A list that grows page by page after `first` (the answer of the list's
 * query, fetched by the caller): `loadMore` follows the cursor with
 * `fetchNext` and appends. Pass a new `first` object when the query changes
 * (sort, filter, scope, market): the later pages, the request in flight and a
 * failure are dropped, and a response that arrives for an older `first` is
 * ignored. `null` = nothing loaded yet. While `paused` (the caller is
 * fetching the first page of a new query, so `first` is still the old one)
 * `loadMore` appends nothing.
 */
export function useContinuedPages<T>(
  first: CursorPage<T> | null,
  fetchNext: NextPageFetcher<T>,
  itemKey: (item: T) => string,
  paused = false,
): ContinuedPages<T> {
  const [loaded, setLoaded] = useState<Continuation<T> | null>(null);
  const [pending, setPending] = useState<ForFirst | null>(null);
  const [failure, setFailure] = useState<ForFirst | null>(null);
  const latest = useRef({
    first,
    fetchNext,
    itemKey
  });
  latest.current = {
    first,
    fetchNext,
    itemKey
  };
  const inFlight = useRef<AbortController | null>(null);

  // A new first page (or unmount) aborts the request for the old one.
  useEffect(() => () => {
    inFlight.current?.abort();
    inFlight.current = null;
  }, [first]);

  const current = continuationOf(loaded, first);

  const loadMore = useCallback(() => {
    if (paused || current?.nextToken == null || inFlight.current !== null) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setPending({ first: current.first });
    setFailure(null);
    latest.current.fetchNext(current.nextToken, controller.signal).then(
      (page) => {
        if (latest.current.first !== current.first) return;
        setLoaded({
          first: current.first,
          later: appendNew(current.first.items, current.later, page.items, latest.current.itemKey),
          nextToken: page.nextToken,
        });
      },
      (loadError: unknown) => {
        if (isAbortError(loadError) || latest.current.first !== current.first) return;
        console.error('[pages] Error loading the next page:', loadError);
        setFailure({ first: current.first });
      },
    ).finally(() => {
      if (inFlight.current !== controller) return;
      inFlight.current = null;
      setPending(null);
    });
  }, [current, paused]);

  return {
    items: itemsOf(current),
    hasMore: current?.nextToken != null,
    loadingMore: isFor(pending, first),
    failed: isFor(failure, first),
    loadMore,
  };
}
