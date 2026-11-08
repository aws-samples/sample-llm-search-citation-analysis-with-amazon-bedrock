import {
  useCallback, useEffect, useMemo, useRef, useState
} from 'react';
import {
  fetchNextPageOrRestart, readListPage, type ListPage, type ListPaging, type ListRequest
} from '../api/scopedListPages';
import {
  getErrorMessage, isAbortError
} from '../infrastructure';

/** A paged list of a scoped view, as the view renders it. */
export interface ScopedList<T> {
  /** The rows loaded so far: the body's first page, then every page loaded after it. */
  readonly items: readonly T[];
  /** The list's total when the server sends it. */
  readonly total: number | null;
  /** Appends the next page; `undefined` once the last page is loaded. */
  readonly loadMore: (() => Promise<void>) | undefined;
  readonly loadingMore: boolean;
  readonly error: string | null;
  /** The cursor expired (a new snapshot build, or the keywords changed) and the list was read again from the start. */
  readonly restarted: boolean;
}

interface ListState<T> extends ListPage<T> {readonly restarted: boolean;}

function stateOf<T>(page: ListPage<T> | null, restarted = false): ListState<T> {
  return {
    items: page?.items ?? [],
    nextToken: page?.nextToken ?? null,
    total: page?.total ?? null,
    restarted,
  };
}

/**
 * The paged list `paging` names in a scoped `body`, extended page by page with "Load more".
 * `request` is the GET the body answered; the next pages repeat it with the cursor. A
 * `cursor_expired` answer reads the list again from its first page and says so (`restarted`).
 * A new body (another scope, a refetch) starts over from its own first page; pass the body
 * as the data hook holds it, since a new object every render would restart the list every render.
 */
export function useScopedList<T>(
  body: unknown,
  request: ListRequest | null,
  paging: ListPaging,
  isItem: (value: unknown) => value is T,
): ScopedList<T> {
  const first = useMemo(() => readListPage(body, paging, isItem), [body, paging, isItem]);
  const [state, setState] = useState<ListState<T>>(() => stateOf(first));
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState(stateOf(first));
    setLoadingMore(false);
    setError(null);
  }, [first]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const { nextToken } = state;
  const loadNext = useCallback(async (): Promise<void> => {
    if (request === null || nextToken === null) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoadingMore(true);
    setError(null);
    try {
      const {
        page, restarted
      } = await fetchNextPageOrRestart({
        request,
        paging,
        isItem,
      }, nextToken, controller.signal);
      if (!controller.signal.aborted) {
        setState((current) => (restarted
          ? stateOf(page, true)
          : {
            ...stateOf(page, current.restarted),
            items: [...current.items, ...page.items],
          }));
      }
    } catch (pageError) {
      if (!isAbortError(pageError)) setError(getErrorMessage(pageError));
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setLoadingMore(false);
      }
    }
  }, [request, nextToken, paging, isItem]);

  return {
    items: state.items,
    total: state.total,
    loadMore: request !== null && nextToken !== null ? loadNext : undefined,
    loadingMore,
    error,
    restarted: state.restarted,
  };
}
